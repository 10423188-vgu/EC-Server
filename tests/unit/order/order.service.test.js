import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverCheckout } from "../../../src/modules/order/checkout.recovery.js";
import { orderService } from "../../../src/modules/order/order.service.js";
import { orderPrismaRepository } from "../../../src/modules/order/order.prisma.repository.js";
import { userPrismaRepository } from "../../../src/modules/user/user.prisma.repository.js";
import { notificationPrismaRepository } from "../../../src/modules/notification/notification.prisma.repository.js";
import { notificationService } from "../../../src/modules/notification/notification.service.js";
import { cartRedisRepository } from "../../../src/modules/cart/cart.redis.repository.js";
import { couponService } from "../../../src/modules/coupon/coupon.service.js";
import { paymentService } from "../../../src/modules/payment/payment.service.js";
import { prisma } from "../../../src/configs/db/index.js";
import { Product } from "../../../src/models/product.model.js";
import { outboxRepository } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/order/order.prisma.repository.js", () => ({
  orderPrismaRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdAndUser: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    findByUser: vi.fn(),
    findAll: vi.fn(),
    findAdminExportBatch: vi.fn(),
    updateShipping: vi.fn(),
    findAdminById: vi.fn(),
    getAdminMetrics: vi.fn(),
    countSelected: vi.fn(),
    findSelected: vi.fn(),
  },
}));

vi.mock("../../../src/modules/user/user.prisma.repository.js", () => ({
  userPrismaRepository: { findById: vi.fn() },
}));

vi.mock(
  "../../../src/modules/notification/notification.prisma.repository.js",
  () => ({
    notificationPrismaRepository: { create: vi.fn() },
  }),
);

vi.mock("../../../src/modules/cart/cart.redis.repository.js", () => ({
  cartRedisRepository: {
    getAll: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/modules/coupon/coupon.service.js", () => ({
  couponService: {
    validate: vi.fn(),
    apply: vi.fn(),
  },
}));

vi.mock("../../../src/modules/payment/payment.service.js", () => ({
  paymentService: {
    buildBankQr: vi.fn(),
    scheduleAutoConfirm: vi.fn(),
  },
}));

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    address: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg) => {
      if (typeof arg === "function") {
        const tx = {
          order: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ status: "AWAITING_PAYMENT", userId: "u1" }),
            update: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
          outboxEvent: {
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return arg(tx);
      }
      return Promise.all(arg);
    }),
  },
}));

vi.mock("../../../src/shared/outbox/outbox.prisma.repository.js", () => ({
  outboxRepository: {
    enqueue: vi.fn(),
  },
}));

vi.mock("../../../src/models/product.model.js", () => ({
  Product: {
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
    bulkWrite: vi.fn(),
  },
}));

vi.mock(
  "../../../src/modules/order/checkout.recovery.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    recoverCheckout: vi.fn(),
  }),
);

const ADDRESS = { id: "addr-1", userId: "u1" };

// Builds a cart + matching Mongo product/variant fixtures for resolveCheckoutCart.
const mockCartWithItems = (items) => {
  const cartHash = {};
  const productMap = new Map();
  const products = [];

  for (const it of items) {
    cartHash[it.variantId] = String(it.quantity);
    if (!productMap.has(it.productId)) {
      // why: images is an array of { url, altText, position } sub-docs in the real schema, not
      // plain strings — resolveCheckoutCart must read .url off it, so the fixture mirrors that shape
      const product = {
        _id: it.productId,
        name: it.productName ?? "Product",
        slug: "slug",
        images: [{ url: "img.jpg", altText: null, position: 0 }],
        variants: [],
      };
      productMap.set(it.productId, product);
      products.push(product);
    }
    productMap.get(it.productId).variants.push({
      _id: it.variantId,
      name: it.variantName ?? "Variant",
      sku: it.sku ?? "SKU1",
      salePrice: it.salePrice ?? null,
      price: it.price,
      stock: it.stock ?? it.quantity,
      isActive: it.isActive ?? true,
    });
  }

  cartRedisRepository.getAll.mockResolvedValue(cartHash);
  Product.find.mockReturnValue({ lean: () => Promise.resolve(products) });
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.address.findFirst.mockResolvedValue(ADDRESS);
  // why: default to an already-verified user so existing checkout tests, which don't care
  // about verification, don't all need to stub this explicitly
  userPrismaRepository.findById.mockResolvedValue({
    emailVerifiedAt: new Date(),
  });
  outboxRepository.enqueue.mockResolvedValue({ id: "recovery-event" });
  recoverCheckout.mockResolvedValue();
  paymentService.buildBankQr.mockReturnValue({
    qrCodeUrl: "https://img.vietqr.io/image/mock",
    transferContent: "DHMOCK",
    bank: { name: "Mock Bank", accountNo: "123", accountName: "TEST" },
  });
});

describe("orderService.checkout — pre-flight validation", () => {
  it("replays an existing checkout for the same idempotency key without reading the cart again", async () => {
    orderPrismaRepository.findByIdempotencyKey.mockResolvedValue({
      id: "existing-order",
    });

    const result = await orderService.checkout({
      userId: "u1",
      addressId: "addr-1",
      idempotencyKey: "checkout-key-1",
    });

    expect(cartRedisRepository.getAll).not.toHaveBeenCalled();
    expect(orderPrismaRepository.create).not.toHaveBeenCalled();
    expect(paymentService.buildBankQr).toHaveBeenCalledWith({
      orderId: "existing-order",
    });
    expect(result.orderId).toBe("existing-order");
  });

  it("throws BadRequestError when cart is empty", async () => {
    cartRedisRepository.getAll.mockResolvedValue({});

    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow("Your cart is empty");
  });

  it("throws BadRequestError when cart has only inactive variants", async () => {
    mockCartWithItems([
      {
        variantId: "v1",
        productId: "p1",
        price: 100,
        quantity: 1,
        isActive: false,
      },
    ]);

    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow("Some items are no longer available");
  });

  it("throws NotFoundError when address does not belong to user", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 100, quantity: 1, stock: 10 },
    ]);
    prisma.address.findFirst.mockResolvedValue(null);

    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when requested quantity exceeds snapshot stock", async () => {
    mockCartWithItems([
      {
        variantId: "v1",
        productId: "p1",
        productName: "Shoe",
        price: 100,
        quantity: 5,
        stock: 2,
      },
    ]);

    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow(/only has 2 item\(s\) left/);
  });

  it("throws ForbiddenError when the user has not verified their email", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 100, quantity: 1, stock: 10 },
    ]);
    userPrismaRepository.findById.mockResolvedValue({ emailVerifiedAt: null });

    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("orderService.checkout — bank transfer happy path", () => {
  it("creates a pending order, then publishes it after stock succeeds and returns the bank QR", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 100, quantity: 2, stock: 10 },
    ]);
    orderPrismaRepository.create.mockResolvedValue({
      order: { id: "order-1" },
    });
    Product.findOneAndUpdate.mockResolvedValue({ _id: "p1" }); // stock deduction succeeds

    const result = await orderService.checkout({
      userId: "u1",
      addressId: "addr-1",
    });

    // why: the order id is generated with randomUUID() before the DB call, specifically so
    // buildBankQr and orderPrismaRepository.create can agree on the same id in one insert —
    // assert both actually got the same value instead of two independent "any string" checks
    const qrCallArg = paymentService.buildBankQr.mock.calls[0][0];
    expect(typeof qrCallArg.orderId).toBe("string");

    expect(orderPrismaRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: qrCallArg.orderId,
        status: "PENDING",
        paymentMethod: "BANK_TRANSFER",
        paymentStatus: "PENDING",
        transferContent: "DHMOCK",
        // why: regression guard — image must be flattened to the .url string; Prisma's OrderItem.image
        // column is String? and rejects the raw { url, altText, position } sub-document
        items: [expect.objectContaining({ image: "img.jpg" })],
      }),
      expect.anything(),
    );
    expect(Product.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(couponService.apply).not.toHaveBeenCalled();
    expect(paymentService.scheduleAutoConfirm).toHaveBeenCalledWith("order-1");
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "order.created",
        payload: expect.objectContaining({ userId: "u1" }),
      }),
    );
    expect(result).toEqual({
      orderId: "order-1",
      qrCodeUrl: "https://img.vietqr.io/image/mock",
      transferContent: "DHMOCK",
      bank: { name: "Mock Bank", accountNo: "123", accountName: "TEST" },
    });
  });

  it("applies coupon discount/free-shipping and records usage after stock succeeds", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 200, quantity: 1, stock: 10 },
    ]);
    orderPrismaRepository.create.mockResolvedValue({
      order: { id: "order-2" },
    });
    Product.findOneAndUpdate.mockResolvedValue({ _id: "p1" });
    couponService.validate.mockResolvedValue({
      coupon: { id: "coupon-1", code: "FREESHIP", isFreeShipping: true },
      discountAmount: 20,
    });

    await orderService.checkout({
      userId: "u1",
      addressId: "addr-1",
      couponCode: "FREESHIP",
    });

    expect(orderPrismaRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingFee: "0",
        discountAmount: "20",
        total: "180.00",
      }),
      expect.anything(),
    );
    expect(couponService.apply).toHaveBeenCalledWith(
      {
        userId: "u1",
        couponId: "coupon-1",
        orderId: "order-2",
        discountAmount: "20",
      },
      expect.anything(),
    );
  });
});

describe("orderService.checkout — stock deduction failure", () => {
  it("recovers stock when coupon application fails inside publication", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 100, quantity: 1, stock: 5 },
    ]);
    orderPrismaRepository.create.mockResolvedValue({
      order: { id: "order-failed" },
    });
    Product.findOneAndUpdate.mockResolvedValue({ _id: "p1" });
    couponService.validate.mockResolvedValue({
      coupon: { id: "c1", code: "SALE" },
      discountAmount: 10,
    });
    couponService.apply.mockRejectedValueOnce(new Error("Coupon exhausted"));
    await expect(
      orderService.checkout({
        userId: "u1",
        addressId: "addr-1",
        couponCode: "SALE",
      }),
    ).rejects.toThrow("Coupon exhausted");
    expect(recoverCheckout).toHaveBeenCalledWith("order-failed");
    expect(paymentService.scheduleAutoConfirm).not.toHaveBeenCalled();
  });

  it("keeps a durable recovery event when immediate rollback fails", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 100, quantity: 1, stock: 5 },
    ]);
    orderPrismaRepository.create.mockResolvedValue({
      order: { id: "order-failed" },
    });
    Product.findOneAndUpdate.mockRejectedValueOnce(
      new Error("Stock connection lost"),
    );
    recoverCheckout.mockRejectedValueOnce(new Error("Postgres down"));
    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow("Stock connection lost");
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "order.checkout.recover",
        availableAt: expect.any(Date),
      }),
    );
  });
  it("restores only already-deducted items, cancels order/payment, and rethrows", async () => {
    mockCartWithItems([
      { variantId: "v1", productId: "p1", price: 50, quantity: 1, stock: 10 },
      { variantId: "v2", productId: "p1", price: 50, quantity: 1, stock: 10 },
    ]);
    orderPrismaRepository.create.mockResolvedValue({
      order: { id: "order-3" },
    });
    // First variant deducts fine, second is out of stock (findOneAndUpdate returns null).
    Product.findOneAndUpdate
      .mockResolvedValueOnce({ _id: "p1" })
      .mockResolvedValueOnce(null);
    Product.bulkWrite.mockResolvedValue({});

    await expect(
      orderService.checkout({ userId: "u1", addressId: "addr-1" }),
    ).rejects.toThrow(/ran out of stock/);

    expect(recoverCheckout).toHaveBeenCalledWith("order-3");
    // why: buildBankQr now runs before order creation (so its id can be written in the same
    // insert) — it always fires once per checkout attempt, even ones that fail on stock; that's
    // fine since it's pure/synchronous with zero I/O, unlike the old MoMo network call would've been
    expect(paymentService.buildBankQr).toHaveBeenCalledTimes(1);
    // why: the auto-confirm timer must never be scheduled for an order that failed to commit
    expect(paymentService.scheduleAutoConfirm).not.toHaveBeenCalled();
  });
});

describe("orderService.getOrderById", () => {
  it("throws NotFoundError when order does not exist for user", async () => {
    orderPrismaRepository.findByIdAndUser.mockResolvedValue(null);

    await expect(orderService.getOrderById("missing", "u1")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rebuilds a pending bank QR from the customer's saved payment note", async () => {
    orderPrismaRepository.findByIdAndUser.mockResolvedValue({
      id: "order-1",
      status: "AWAITING_PAYMENT",
      payment: {
        method: "BANK_TRANSFER",
        status: "PENDING",
        transferContent: "DHSAVEDNOTE",
      },
    });

    const result = await orderService.getOrderById("order-1", "u1");

    expect(orderPrismaRepository.findByIdAndUser).toHaveBeenCalledWith(
      "order-1",
      "u1",
    );
    expect(paymentService.buildBankQr).toHaveBeenCalledWith({
      orderId: "order-1",
      transferContent: "DHSAVEDNOTE",
    });
    expect(result.paymentQr).toEqual({
      qrCodeUrl: "https://img.vietqr.io/image/mock",
      transferContent: "DHMOCK",
      bank: { name: "Mock Bank", accountNo: "123", accountName: "TEST" },
    });
  });

  it.each(["PAID", "CANCELLED"])(
    "does not return a QR for a %s order",
    async (status) => {
      orderPrismaRepository.findByIdAndUser.mockResolvedValue({
        id: "order-1",
        status,
        payment: { method: "BANK_TRANSFER", status: "COMPLETED" },
      });

      const result = await orderService.getOrderById("order-1", "u1");

      expect(result.paymentQr).toBeNull();
      expect(paymentService.buildBankQr).not.toHaveBeenCalled();
    },
  );
});

describe("orderService admin order tools", () => {
  it("validates selected orders before starting a CSV response", async () => {
    orderPrismaRepository.countSelected.mockResolvedValue(1);
    await expect(
      orderService.adminValidateSelected(["one", "missing"]),
    ).rejects.toThrow(ConflictError);
    await expect(
      orderService.adminValidateSelected(["one"]),
    ).resolves.toBeUndefined();
  });
  it("streams selected summaries sequentially in selection order with bounded memory", async () => {
    const ids = Array.from({ length: 1201 }, (_, index) => `order-${index}`);
    orderPrismaRepository.findSelected.mockImplementation(async (batch) =>
      batch.map((id) => ({
        id,
        createdAt: new Date("2026-10-15T00:00:00Z"),
        user: {},
      })),
    );
    const stream = orderService.adminExportSelectedCsv(ids);
    expect((await stream.next()).value).toContain("Customer");
    expect(orderPrismaRepository.findSelected).not.toHaveBeenCalled();
    expect((await stream.next()).value).toContain('"order-0"');
    expect(orderPrismaRepository.findSelected).toHaveBeenCalledTimes(1);
    const rows = [];
    for await (const row of stream) rows.push(row);
    expect(rows).toHaveLength(1200);
    expect(rows.at(-1)).toContain('"order-1200"');
    expect(
      orderPrismaRepository.findSelected.mock.calls.map(
        ([batch]) => batch.length,
      ),
    ).toEqual([500, 500, 201]);
  });
  it("stops reading selected batches when a download is closed", async () => {
    orderPrismaRepository.findSelected.mockResolvedValue([{ id: "one" }]);
    const stream = orderService.adminExportSelectedCsv([
      "one",
      ...Array(500).fill("next"),
    ]);
    await stream.next();
    await stream.return();
    expect(orderPrismaRepository.findSelected).not.toHaveBeenCalled();
  });
  it("caps admin navigation while retaining the real matching count", async () => {
    orderPrismaRepository.findAll.mockResolvedValue([[], 100000]);
    expect(
      (await orderService.adminListOrders({ page: 1, limit: 10 })).pagination,
    ).toEqual({
      page: 1,
      limit: 10,
      total: 100000,
      totalPages: 1001,
      isLimited: true,
    });
  });
  it("streams filtered CSV in bounded batches and protects formula cells", async () => {
    orderPrismaRepository.findAdminExportBatch.mockReset();
    const row = {
      id: "=cmd",
      createdAt: new Date("2026-10-12T12:00:00.000Z"),
      status: "DELIVERED",
      user: { name: 'Customer "One"', email: "one@example.com" },
      payment: {
        method: "BANK_TRANSFER",
        status: "COMPLETED",
        refundedAmount: 0,
      },
      _count: { items: 2 },
      subtotal: 100,
      shippingFee: 10,
      discountAmount: 0,
      total: 110,
      shippingCarrier: "Carrier",
      trackingNumber: "AB-1",
      trackingUrl: "https://carrier.example/AB-1",
    };
    orderPrismaRepository.findAdminExportBatch
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([]);

    const chunks = [];
    for await (const chunk of orderService.adminExportCsv({
      status: "DELIVERED",
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toContain("Order ID");
    expect(chunks[1]).toContain('"\'=cmd"');
    expect(chunks[1]).toContain('Customer ""One""');
    expect(orderPrismaRepository.findAdminExportBatch).toHaveBeenNthCalledWith(
      1,
      { status: "DELIVERED" },
      undefined,
      500,
    );
    expect(orderPrismaRepository.findAdminExportBatch).toHaveBeenCalledTimes(1);
  });

  it("continues CSV export from the last order ID when a batch is full", async () => {
    orderPrismaRepository.findAdminExportBatch.mockReset();
    const orders = Array.from({ length: 500 }, (_, index) => ({
      id: `order-${index}`,
      createdAt: new Date("2026-10-12T12:00:00.000Z"),
      user: {},
      _count: { items: 0 },
    }));
    orderPrismaRepository.findAdminExportBatch
      .mockResolvedValueOnce(orders)
      .mockResolvedValueOnce([]);

    for await (const _chunk of orderService.adminExportCsv({
      status: "DELIVERED",
    })) {
      // Consume each streamed row to exercise cursor progression.
    }

    expect(orderPrismaRepository.findAdminExportBatch).toHaveBeenNthCalledWith(
      2,
      { status: "DELIVERED" },
      "order-499",
      500,
    );
  });

  it("updates shipping information and returns the refreshed admin order", async () => {
    orderPrismaRepository.findById.mockResolvedValue({ id: "o1" });
    orderPrismaRepository.findAdminById.mockResolvedValue({
      id: "o1",
      status: "SHIPPED",
      shippingCarrier: "Carrier",
      trackingNumber: "AB-1",
      trackingUrl: "https://carrier.example/AB-1",
      payment: { amount: 100, refundedAmount: 0 },
      returnRequests: [],
    });
    const data = {
      shippingCarrier: "Carrier",
      trackingNumber: "AB-1",
      trackingUrl: "https://carrier.example/AB-1",
    };

    const result = await orderService.adminUpdateShipping("o1", data);

    expect(orderPrismaRepository.updateShipping).toHaveBeenCalledWith(
      "o1",
      data,
    );
    expect(result).toMatchObject({
      shippingCarrier: "Carrier",
      trackingNumber: "AB-1",
      adminActions: ["DISPATCH"],
    });
  });

  it("does not update shipping information for a missing order", async () => {
    orderPrismaRepository.findById.mockResolvedValue(null);

    await expect(
      orderService.adminUpdateShipping("missing", {
        shippingCarrier: null,
        trackingNumber: null,
        trackingUrl: null,
      }),
    ).rejects.toThrow(NotFoundError);
    expect(orderPrismaRepository.updateShipping).not.toHaveBeenCalled();
  });
});

describe("orderService.cancelOrder", () => {
  it("throws NotFoundError when order does not exist", async () => {
    orderPrismaRepository.findByIdAndUser.mockResolvedValue(null);

    await expect(orderService.cancelOrder("o1", "u1")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws ForbiddenError when order is not in a cancellable state", async () => {
    orderPrismaRepository.findByIdAndUser.mockResolvedValue({
      id: "o1",
      status: "PAID",
      items: [],
    });

    await expect(orderService.cancelOrder("o1", "u1")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("cancels an awaiting-payment order and enqueues an idempotent stock restore", async () => {
    orderPrismaRepository.findByIdAndUser.mockResolvedValue({
      id: "o1",
      status: "AWAITING_PAYMENT",
      items: [{ variantId: "v1", quantity: 2 }],
    });
    const result = await orderService.cancelOrder("o1", "u1");

    expect(outboxRepository.enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventType: "order.status.changed",
      payload: { orderId: "o1", userId: "u1", status: "CANCELLED" },
    });
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventType: "order.stock.restore",
      payload: {
        orderId: "o1",
        items: [{ variantId: "v1", quantity: 2 }],
      },
    });
    expect(Product.bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ orderId: "o1" });
  });

  it("throws ForbiddenError and does not restore stock when a concurrent request already resolved the order", async () => {
    orderPrismaRepository.findByIdAndUser.mockResolvedValue({
      id: "o1",
      status: "AWAITING_PAYMENT",
      items: [{ variantId: "v1", quantity: 2 }],
    });
    prisma.$transaction.mockImplementationOnce(async (callback) =>
      callback({
        order: {
          findUnique: vi.fn().mockResolvedValue({ status: "AWAITING_PAYMENT" }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        payment: { updateMany: vi.fn() },
      }),
    );

    await expect(orderService.cancelOrder("o1", "u1")).rejects.toThrow(
      ForbiddenError,
    );
    expect(outboxRepository.enqueue).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "order.stock.restore" }),
    );
  });
});

describe("orderService.adminUpdateStatus", () => {
  it("throws NotFoundError when order does not exist", async () => {
    orderPrismaRepository.findById.mockResolvedValue(null);

    await expect(
      orderService.adminUpdateStatus("missing", "SHIPPED"),
    ).rejects.toThrow(NotFoundError);
  });

  it("updates the order and enqueues the status-change notification event when the status actually changes", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "PROCESSING",
    });

    await orderService.adminUpdateStatus("o1", "SHIPPED");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({ updateMany: expect.any(Function) }),
      }),
      {
        eventType: "order.status.changed",
        payload: { orderId: "o1", userId: "u1", status: "SHIPPED" },
      },
    );
    expect(notificationPrismaRepository.create).not.toHaveBeenCalled();
  });

  it("does not write history or enqueue an event when another admin changed the order first", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const createHistory = vi.fn();
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "PROCESSING",
    });
    prisma.$transaction.mockImplementationOnce((callback) =>
      callback({
        order: { updateMany },
        orderStatusHistory: { create: createHistory },
      }),
    );

    await expect(
      orderService.adminUpdateStatus("o1", "SHIPPED", "admin-1"),
    ).rejects.toThrow(ConflictError);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "o1", status: "PROCESSING" },
      data: { status: "SHIPPED", statusChangedAt: expect.any(Date) },
    });
    expect(createHistory).not.toHaveBeenCalled();
    expect(outboxRepository.enqueue).not.toHaveBeenCalled();
  });

  it("moves a shipped order to out for delivery before it can be delivered", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "SHIPPED",
    });

    await orderService.adminUpdateStatus("o1", "OUT_FOR_DELIVERY");

    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: { orderId: "o1", userId: "u1", status: "OUT_FOR_DELIVERY" },
      }),
    );
  });

  it("does not allow a shipped order to skip out for delivery", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "SHIPPED",
    });

    await expect(
      orderService.adminUpdateStatus("o1", "DELIVERED"),
    ).rejects.toThrow(BadRequestError);
  });

  it("allows a warehouse correction from processing back to paid when a reason is supplied", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "PROCESSING",
    });

    await orderService.adminUpdateStatus(
      "o1",
      "PAID",
      "admin-1",
      "Stock mismatch",
    );

    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: { orderId: "o1", userId: "u1", status: "PAID" },
      }),
    );
  });

  it("requires a reason when returning an order to paid", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "PROCESSING",
    });

    await expect(
      orderService.adminUpdateStatus("o1", "PAID", "admin-1"),
    ).rejects.toThrow(BadRequestError);
  });

  it("does not allow a shipped order to return to processing", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "SHIPPED",
    });

    await expect(
      orderService.adminUpdateStatus(
        "o1",
        "PROCESSING",
        "admin-1",
        "Carrier issue",
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("skips the notification event when the status doesn't actually change — no-op guard", async () => {
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      status: "SHIPPED",
    });

    await orderService.adminUpdateStatus("o1", "SHIPPED");

    expect(outboxRepository.enqueue).not.toHaveBeenCalled();
    expect(notificationPrismaRepository.create).not.toHaveBeenCalled();
  });
});

describe("orderService admin dashboard actions", () => {
  it("returns server-owned actions with the admin order list", async () => {
    orderPrismaRepository.findAll.mockResolvedValue([
      [
        {
          id: "o1",
          status: "AWAITING_PAYMENT",
          payment: { amount: 100, refundedAmount: 0 },
        },
        {
          id: "o2",
          status: "DELIVERED",
          payment: { amount: 100, refundedAmount: 25 },
          returnRequests: [{ id: "return-1", status: "APPROVED" }],
        },
      ],
      2,
    ]);

    const result = await orderService.adminListOrders({ page: 1, limit: 10 });

    expect(result.data[0].adminActions).toEqual(["CONFIRM_PAYMENT", "CANCEL"]);
    expect(result.data[1].adminActions).toEqual(["REFUND"]);
    expect(result.data[1].refundableAmount).toBe(75);
  });

  it("delegates metrics to the repository", async () => {
    orderPrismaRepository.getAdminMetrics.mockResolvedValue({ totalOrders: 4 });

    await expect(
      orderService.adminGetMetrics({ status: "PAID", search: "alex" }),
    ).resolves.toEqual({ totalOrders: 4 });
    expect(orderPrismaRepository.getAdminMetrics).toHaveBeenCalledWith({
      status: "PAID",
      search: "alex",
    });
  });

  it("lets an admin cancel an unpaid order with a reason and releases its coupon", async () => {
    const couponUsage = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const coupon = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const history = { create: vi.fn().mockResolvedValue({}) };
    orderPrismaRepository.findById.mockResolvedValue({
      id: "o1",
      userId: "u1",
      couponId: "c1",
      status: "AWAITING_PAYMENT",
      items: [{ variantId: "v1", quantity: 2 }],
    });
    prisma.$transaction.mockImplementationOnce((callback) =>
      callback({
        order: {
          findUnique: vi.fn().mockResolvedValue({
            status: "AWAITING_PAYMENT",
            userId: "u1",
            couponId: "c1",
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        couponUsage,
        coupon,
        orderStatusHistory: history,
      }),
    );

    await orderService.adminCancelOrder("o1", "admin-1", "Customer request");

    expect(couponUsage.deleteMany).toHaveBeenCalledWith({
      where: { orderId: "o1" },
    });
    expect(coupon.updateMany).toHaveBeenCalled();
    expect(history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedByUserId: "admin-1",
        reason: "Customer request",
        toStatus: "CANCELLED",
      }),
    });
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "order.stock.restore",
        payload: expect.objectContaining({ orderId: "o1" }),
      }),
    );
  });
});

describe("orderService.adminRefundOrder", () => {
  const mockRefundTransaction = ({
    amount = 100,
    refundedAmount = 0,
    approvedReturn = true,
  } = {}) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "payment-1" }]),
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "o1",
          userId: "u1",
          status: "DELIVERED",
          payment: {
            amount,
            refundedAmount,
            status: refundedAmount ? "PARTIALLY_REFUNDED" : "COMPLETED",
          },
          items: [{ id: "item-1" }],
          returnRequests: approvedReturn
            ? [{ id: "return-1", status: "APPROVED", refundAmount: 25 }]
            : [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      payment: { update: vi.fn().mockResolvedValue({}) },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      returnRequest: { update: vi.fn().mockResolvedValue({}) },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx));
    orderPrismaRepository.findAdminById.mockResolvedValue({
      id: "o1",
      status: "DELIVERED",
      payment: { amount, refundedAmount: refundedAmount + 25 },
    });
    return tx;
  };

  it("records a partial refund without closing the order", async () => {
    const tx = mockRefundTransaction();

    await orderService.adminRefundOrder(
      "o1",
      { amount: 25, reason: "Damaged box", transactionId: "RF-1" },
      "admin-1",
    );

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { orderId: "o1" },
      data: { refundedAmount: 25, status: "PARTIALLY_REFUNDED" },
    });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "order.refund.completed" }),
    );
  });

  it("marks the order refunded when the remaining balance is refunded", async () => {
    const tx = mockRefundTransaction({ amount: 100, refundedAmount: 75 });

    await orderService.adminRefundOrder(
      "o1",
      { amount: 25, reason: "Approved return", transactionId: "RF-2" },
      "admin-1",
    );

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { orderId: "o1" },
      data: { refundedAmount: 100, status: "REFUNDED" },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { status: "REFUNDED", statusChangedAt: expect.any(Date) },
    });
    expect(tx.orderStatusHistory.create).toHaveBeenCalled();
  });

  it("rejects an amount above the remaining refundable balance", async () => {
    mockRefundTransaction({ amount: 100, refundedAmount: 75 });

    await expect(
      orderService.adminRefundOrder(
        "o1",
        { amount: 30, reason: "Too much", transactionId: "RF-3" },
        "admin-1",
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("rejects a physical-order refund until its return is approved", async () => {
    mockRefundTransaction({ approvedReturn: false });

    await expect(
      orderService.adminRefundOrder(
        "o1",
        { amount: 25, reason: "Not inspected", transactionId: "RF-4" },
        "admin-1",
      ),
    ).rejects.toThrow(
      "A physical order can only be refunded after its return is approved",
    );
  });

  it("does not reuse a bank reference for a different return", async () => {
    const tx = mockRefundTransaction();
    tx.refund.findUnique.mockResolvedValue({
      orderId: "o1",
      amount: 25,
      returnRequestId: "return-previous",
    });

    await expect(
      orderService.adminRefundOrder(
        "o1",
        {
          amount: 25,
          reason: "Approved return",
          transactionId: "RF-1",
          returnRequestId: "return-1",
        },
        "admin-1",
      ),
    ).rejects.toThrow("Refund transaction ID already exists");
    expect(tx.refund.create).not.toHaveBeenCalled();
  });
});
