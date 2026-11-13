import { randomUUID } from "crypto";
import { prisma } from "../../configs/db/index.js";
import { cartRedisRepository } from "../cart/cart.redis.repository.js";
import { couponService } from "../coupon/coupon.service.js";
import { paymentService } from "../payment/payment.service.js";
import { userPrismaRepository } from "../user/user.prisma.repository.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import { orderPrismaRepository } from "./order.prisma.repository.js";
import { CHECKOUT_TIMEOUT_MS, recoverCheckout } from "./checkout.recovery.js";
import { logger } from "../../shared/utils/logger.js";
import { Product } from "../../models/product.model.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "../../shared/errors/app.error.js";

const SHIPPING_FEE = Number(process.env.SHIPPING_FEE) || 30_000;

const resolveCheckoutCart = async (cartHash) => {
  const variantIds = Object.keys(cartHash);

  const products = await Product.find(
    { isActive: true, deletedAt: null, "variants._id": { $in: variantIds } },
    {
      name: 1,
      slug: 1,
      images: { $slice: 1 },
      variants: 1,
      categoryId: 1,
      brandId: 1,
    },
  ).lean();

  const variantMap = new Map();
  for (const p of products) {
    for (const v of p.variants) {
      variantMap.set(String(v._id), { product: p, variant: v });
    }
  }

  const items = [];
  for (const variantId of variantIds) {
    const entry = variantMap.get(variantId);
    if (!entry || !entry.variant.isActive || entry.variant.deletedAt) {
      throw new BadRequestError(
        "Some items are no longer available. Please update your cart.",
      );
    }
    const { product, variant } = entry;
    items.push({
      productId: String(product._id),
      variantId,
      productName: product.name,
      variantName: variant.name,
      variantSku: variant.sku,
      // why: variant's own photo (e.g. color) takes priority — falling back to the product's
      // default image would show the same picture for every color/variant
      image: variant.images?.[0]?.url ?? product.images?.[0]?.url ?? null,
      categoryId: product.categoryId,
      brandId: product.brandId ?? null,
      price: variant.salePrice ?? variant.price,
      stock: variant.stock,
      quantity: parseInt(cartHash[variantId], 10),
    });
  }
  return items;
};

// why: each deduction records its order atomically so crash recovery restores
// only successful deductions. Sequential work stops early on sold-out items.
const deductStock = async (items, orderId) => {
  for (const { variantId, quantity } of items) {
    const result = await Product.findOneAndUpdate(
      {
        isActive: true,
        deletedAt: null,
        variants: {
          $elemMatch: {
            _id: variantId,
            isActive: true,
            deletedAt: null,
            stock: { $gte: quantity },
            stockDeductionKeys: { $ne: orderId },
            stockRestoreKeys: { $ne: orderId },
          },
        },
      },
      {
        $inc: { "variants.$.stock": -quantity },
        $addToSet: { "variants.$.stockDeductionKeys": orderId },
      },
      { projection: { _id: 1 } },
    );
    if (!result) {
      throw new BadRequestError(
        "Some items ran out of stock. Please refresh your cart and try again.",
      );
    }
  }
};

export const orderCheckoutService = {
  checkout: async ({ userId, addressId, couponCode, note, idempotencyKey }) => {
    if (idempotencyKey) {
      const existing = await orderPrismaRepository.findByIdempotencyKey(
        userId,
        idempotencyKey,
      );
      if (existing) {
        if (existing.status === "PENDING") {
          throw new ConflictError(
            "Checkout is still processing. Retry shortly with the same key.",
          );
        }
        if (existing.status === "CANCELLED") {
          throw new BadRequestError(
            "The previous checkout failed. Start a new checkout.",
          );
        }
        const { qrCodeUrl, transferContent, bank } = paymentService.buildBankQr(
          { orderId: existing.id },
        );
        return { orderId: existing.id, qrCodeUrl, transferContent, bank };
      }
    }

    // why: cart (Redis + Mongo), address ownership, and the user's verification status
    // are independent stores/reads — run concurrently
    const [cartItems, address, user] = await Promise.all([
      cartRedisRepository.getAll(userId).then((cartHash) => {
        if (!cartHash || !Object.keys(cartHash).length)
          throw new BadRequestError("Your cart is empty");
        return resolveCheckoutCart(cartHash);
      }),
      prisma.address.findFirst({ where: { id: addressId, userId } }),
      userPrismaRepository.findById(userId),
    ]);
    if (!cartItems.length) throw new BadRequestError("No valid items in cart");
    if (!address) throw new NotFoundError("Address");
    if (!user?.emailVerifiedAt)
      throw new ForbiddenError("Please verify your email before checking out");

    // why: cheap snapshot check to fail fast — deductStock below re-validates atomically
    // against live stock, so this doesn't need to be race-proof itself
    for (const item of cartItems) {
      if (item.stock < item.quantity)
        throw new BadRequestError(
          `"${item.productName}" only has ${item.stock} item(s) left`,
        );
    }

    // why: pass the already-resolved cart so couponService doesn't re-fetch it from Redis+Mongo
    let couponResult = null;
    if (couponCode) {
      couponResult = await couponService.validate({
        userId,
        code: couponCode,
        cartItems: cartItems.map((i) => ({
          variantId: i.variantId,
          productId: i.productId,
          categoryId: i.categoryId,
          brandId: i.brandId,
          price: i.price,
          quantity: i.quantity,
        })),
      });
    }

    const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const isFreeShipping = couponResult?.coupon?.isFreeShipping ?? false;
    const shippingFee = isFreeShipping ? 0 : SHIPPING_FEE;
    const discountAmount = couponResult?.discountAmount ?? 0;
    const total = Math.max(
      0,
      Math.round((subtotal + shippingFee - discountAmount) * 100) / 100,
    );

    // why: generated upfront (pure, no I/O) so the payment row can carry transferContent
    // from the very first insert instead of a follow-up UPDATE
    const orderId = randomUUID();
    const { qrCodeUrl, transferContent, bank } = paymentService.buildBankQr({
      orderId,
    });

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const createdOrder = await orderPrismaRepository.create(
          {
            id: orderId,
            userId,
            idempotencyKey,
            addressId,
            shippingFullName: address.fullName,
            shippingPhone: address.phone,
            shippingStreet: address.street,
            shippingWard: address.ward,
            shippingDistrict: address.district,
            shippingCity: address.city,
            shippingPostalCode: address.postalCode,
            shippingCountryCode: address.countryCode,
            subtotal: subtotal.toFixed(2),
            shippingFee: shippingFee.toString(),
            discountAmount: discountAmount.toString(),
            total: total.toFixed(2),
            // why: the order is not payable until stock and coupon work have both
            // succeeded; the final transition below publishes order.created atomically.
            status: "PENDING",
            note,
            couponId: couponResult?.coupon?.id ?? null,
            couponCode: couponResult?.coupon?.code ?? null,
            items: cartItems.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              productName: i.productName,
              variantName: i.variantName,
              variantSku: i.variantSku,
              image: i.image,
              price: i.price.toString(),
              quantity: i.quantity,
              subtotal: (i.price * i.quantity).toFixed(2),
            })),
            paymentMethod: "BANK_TRANSFER",
            paymentStatus: "PENDING",
            transferContent,
          },
          tx,
        );

        const recoveryEvent = await outboxRepository.enqueue(tx, {
          eventType: "order.checkout.recover",
          payload: { orderId },
          availableAt: new Date(Date.now() + CHECKOUT_TIMEOUT_MS),
        });
        return { ...createdOrder, recoveryEventId: recoveryEvent.id };
      });
    } catch (err) {
      if (idempotencyKey && err?.code === "P2002") {
        const existing = await orderPrismaRepository.findByIdempotencyKey(
          userId,
          idempotencyKey,
        );
        if (existing) {
          if (existing.status === "PENDING") {
            throw new ConflictError(
              "Checkout is still processing. Retry shortly with the same key.",
            );
          }
          if (existing.status === "CANCELLED") {
            throw new BadRequestError(
              "The previous checkout failed. Start a new checkout.",
            );
          }
          const response = paymentService.buildBankQr({ orderId: existing.id });
          return { orderId: existing.id, ...response };
        }
      }
      throw err;
    }
    const { order } = created;

    try {
      await deductStock(cartItems, order.id);
      await prisma.$transaction(async (tx) => {
        // why: claim the transition before applying the coupon; recovery competes
        // on the same row, so an expired checkout cannot publish or consume usage.
        const published = await tx.order.updateMany({
          where: { id: order.id, status: "PENDING" },
          data: { status: "AWAITING_PAYMENT", statusChangedAt: new Date() },
        });
        if (!published.count) {
          throw new ConflictError("Checkout expired. Start a new checkout.");
        }
        if (couponResult?.coupon?.id) {
          await couponService.apply(
            {
              userId,
              couponId: couponResult.coupon.id,
              orderId: order.id,
              discountAmount: discountAmount.toString(),
            },
            tx,
          );
        }
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: "PENDING",
            toStatus: "AWAITING_PAYMENT",
          },
        });
        await outboxRepository.enqueue(tx, {
          eventType: "order.created",
          payload: {
            orderId: order.id,
            userId,
            total: total.toFixed(2),
            variantIds: cartItems.map((item) => item.variantId),
          },
        });
        await tx.outboxEvent.update({
          where: { id: created.recoveryEventId },
          data: { processedAt: new Date() },
        });
      });
    } catch (error) {
      try {
        await recoverCheckout(order.id);
      } catch (recoveryError) {
        // why: the recovery event was committed before stock work and remains
        // pending. Return the original failure while recording the retry backlog.
        logger.error(
          { err: recoveryError, orderId: order.id },
          "Checkout recovery deferred to outbox",
        );
      }
      throw error;
    }

    // why: not awaited — this schedules a demo-only timer, the response shouldn't wait on it
    paymentService.scheduleAutoConfirm(order.id);

    return { orderId: order.id, qrCodeUrl, transferContent, bank };
  },
};
