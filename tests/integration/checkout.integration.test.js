import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

// why: only the Postgres-touching repositories are mocked. Redis (cart) and MongoDB
// (product stock) run against real engines — a mongod spun up just for this suite, and
// the developer's local Redis on a dedicated DB index — so the atomic guards these stores
// are actually relied on for (Lua stock cap, findOneAndUpdate's $gte race guard) get
// exercised for real instead of asserting against a mock that always answers as told.
vi.mock("../../src/modules/order/order.prisma.repository.js", () => ({
  orderPrismaRepository: {
    create: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock("../../src/modules/payment/payment.prisma.repository.js", () => ({
  paymentPrismaRepository: {
    findByOrderId: vi.fn(),
  },
}));

vi.mock("../../src/configs/db/index.js", () => ({
  prisma: {
    address: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: { updateMany: vi.fn() },
    orderStatusHistory: { create: vi.fn() },
    outboxEvent: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const { orderService } = await import("../../src/modules/order/order.service.js");
const { paymentService } = await import("../../src/modules/payment/payment.service.js");
const { orderPrismaRepository } = await import("../../src/modules/order/order.prisma.repository.js");
const { paymentPrismaRepository } = await import("../../src/modules/payment/payment.prisma.repository.js");
const { prisma } = await import("../../src/configs/db/index.js");
const { cartRedisRepository } = await import("../../src/modules/cart/cart.redis.repository.js");
const { redisClient, connectRedis, disconnectRedis } = await import("../../src/configs/cache/redis.js");
const { Product } = await import("../../src/models/product.model.js");
const { productMongoRepository } = await import("../../src/modules/product/product.mongo.repository.js");
const { cartService } = await import("../../src/modules/cart/cart.service.js");
const { outboxHandlers } = await import("../../src/shared/outbox/outbox.handlers.js");
const { recoverCheckout } = await import("../../src/modules/order/checkout.recovery.js");

const DEFAULT_ADDRESS = {
  id: "addr-1",
  fullName: "Test Buyer",
  phone: "0900000000",
  street: "1 Test St",
  ward: "Ward 1",
  district: "District 1",
  city: "Test City",
};

const seedProduct = async ({ stock, price = 100_000 }) => {
  const doc = await Product.create({
    name: "Integration Test Product",
    slug: `integration-product-${randomUUID()}`,
    categoryId: "cat-1",
    categorySlug: "cat-1",
    categoryName: "Category",
    variants: [{ sku: `SKU-${randomUUID()}`, name: "Default", price, stock }],
  });
  return { productId: doc._id, variantId: doc.variants[0]._id };
};

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await connectRedis();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  await disconnectRedis();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await Product.deleteMany({});
  await redisClient.flushDb();

  prisma.address.findFirst.mockResolvedValue(DEFAULT_ADDRESS);
  prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: new Date() });
  prisma.order.findUnique.mockResolvedValue({
    status: "AWAITING_PAYMENT",
    userId: "u1",
  });
  prisma.order.update.mockResolvedValue({});
  prisma.order.updateMany.mockResolvedValue({ count: 1 });
  prisma.payment.updateMany.mockResolvedValue({ count: 1 });
  prisma.orderStatusHistory.create.mockResolvedValue({});
  prisma.outboxEvent.create.mockResolvedValue({ id: "recovery-event" });
  prisma.outboxEvent.update.mockResolvedValue({});
  prisma.$transaction.mockImplementation((operation) =>
    typeof operation === "function" ? operation(prisma) : Promise.all(operation)
  );
  orderPrismaRepository.create.mockImplementation((data) =>
    Promise.resolve({ order: { id: data.id, userId: data.userId } })
  );
});

describe("cartRedisRepository — real Redis atomic stock guard", () => {
  it("retries purchased-cart cleanup without deleting newly added or changed items", async () => {
    const userId = `u-${randomUUID()}`;
    const orderId = randomUUID();
    await cartRedisRepository.setItemAtomic(userId, "v1", 10, 2);
    await cartRedisRepository.setItemAtomic(userId, "changed", 10, 3);
    const items = [{ variantId: "v1", quantity: 2 }, { variantId: "changed", quantity: 2 }];
    await cartRedisRepository.clearPurchased(userId, orderId, items);
    expect(await cartRedisRepository.getAll(userId)).toEqual({ changed: "3" });
    await cartRedisRepository.setItemAtomic(userId, "v1", 10, 2);
    await cartRedisRepository.clearPurchased(userId, orderId, items);
    expect(await cartRedisRepository.getAll(userId)).toEqual({ v1: "2", changed: "3" });
  });
  it("rejects an increment that would exceed the stock cap, without mutating the hash", async () => {
    const userId = `u-${randomUUID()}`;
    await cartRedisRepository.setItemAtomic(userId, "v-cap", 2, 2);

    await expect(cartRedisRepository.incrementItemAtomic(userId, "v-cap", 2)).rejects.toThrow("OVER_STOCK");

    expect(await cartRedisRepository.getAll(userId)).toEqual({ "v-cap": "2" });
  });

  it("sets a TTL on the cart key so an abandoned cart expires on its own", async () => {
    const userId = `u-${randomUUID()}`;
    await cartRedisRepository.incrementItemAtomic(userId, "v-ttl", 10);

    const ttl = await redisClient.ttl(`cart:${userId}`);
    expect(ttl).toBeGreaterThan(0);
  });
});

describe("checkout -> confirmPayment — real Mongo + Redis lifecycle", () => {
  it("deducts stock in Mongo at checkout, and only clears the Redis cart once payment is confirmed", async () => {
    const userId = `u-${randomUUID()}`;
    const { variantId } = await seedProduct({ stock: 5 });
    await cartRedisRepository.setItemAtomic(userId, variantId, 5, 2);

    const result = await orderService.checkout({ userId, addressId: "addr-1" });

    const afterCheckout = await Product.findOne({ "variants._id": variantId }).lean();
    expect(afterCheckout.variants[0].stock).toBe(3);
    // why: checkout only creates the AWAITING_PAYMENT order — clearing the cart before the
    // transfer is actually confirmed would lose the customer's items over a payment that
    // never arrives
    expect(await cartRedisRepository.getAll(userId)).toEqual({ [variantId]: "2" });

    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    orderPrismaRepository.findById.mockResolvedValue({ id: result.orderId, userId });
    prisma.order.findUnique.mockResolvedValue({
      status: "AWAITING_PAYMENT",
      userId,
      items: [{ variantId, quantity: 2 }],
    });

    await paymentService.confirmPayment(result.orderId, "admin-1");

    expect(await cartRedisRepository.getAll(userId)).toEqual({});
  });
});

describe("checkout — concurrent buyers on a single-unit variant", () => {
  it("lets exactly one buyer through and never lets Mongo stock go negative", async () => {
    const { variantId } = await seedProduct({ stock: 1 });
    const buyers = [`u-a-${randomUUID()}`, `u-b-${randomUUID()}`];
    await Promise.all(buyers.map((userId) => cartRedisRepository.setItemAtomic(userId, variantId, 1, 1)));

    const results = await Promise.allSettled(
      buyers.map((userId) => orderService.checkout({ userId, addressId: "addr-1" }))
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // why: this is the one assertion a fully-mocked unit test structurally cannot make —
    // it proves MongoDB's own document-level atomicity (either the pre-flight snapshot
    // check or the $gte guard in deductStock's findOneAndUpdate catches the loser,
    // depending on how the two calls happen to interleave), not just that our code calls
    // the right functions
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/ran out of stock|only has 0 item\(s\) left/);

    const finalDoc = await Product.findOne({ "variants._id": variantId }).lean();
    expect(finalDoc.variants[0].stock).toBe(0);
  });
});

describe("cancel stock restoration outbox", () => {
  it("restores only deducted checkout items once and fences late deductions", async () => {
    const first = await seedProduct({ stock: 5 });
    const second = await seedProduct({ stock: 7 });
    const orderId = randomUUID();
    await Product.updateOne(
      { "variants._id": first.variantId },
      {
        $inc: { "variants.$.stock": -2 },
        $addToSet: { "variants.$.stockDeductionKeys": orderId },
      },
    );
    const snapshot = {
      id: orderId,
      status: "PENDING",
      statusHistory: [{ id: "recovery-history" }],
      items: [
        { variantId: first.variantId, quantity: 2 },
        { variantId: second.variantId, quantity: 3 },
      ],
    };
    prisma.order.findUnique.mockResolvedValue(snapshot);
    await recoverCheckout(orderId);
    prisma.order.findUnique.mockResolvedValue({ ...snapshot, status: "CANCELLED" });
    await recoverCheckout(orderId);
    const products = await Product.find({}).lean();
    expect(products.find((p) => p._id === first.productId).variants[0].stock).toBe(5);
    expect(products.find((p) => p._id === second.productId).variants[0].stock).toBe(7);
    const late = await Product.findOneAndUpdate(
      { variants: { $elemMatch: { _id: second.variantId, stock: { $gte: 3 }, stockRestoreKeys: { $ne: orderId } } } },
      { $inc: { "variants.$.stock": -3 } },
    );
    expect(late).toBeNull();
  });
  it("restores each variant once when the same event is retried", async () => {
    const { variantId } = await seedProduct({ stock: 3 });
    const payload = { items: [{ variantId, quantity: 2 }] };

    await outboxHandlers["order.stock.restore"](payload, { eventId: "event-1" });
    await outboxHandlers["order.stock.restore"](payload, { eventId: "event-1" });

    const product = await Product.findOne({ "variants._id": variantId }).lean();
    expect(product.variants[0].stock).toBe(5);
  });
});

describe("deleted catalog items and existing orders", () => {
  it("blocks cart writes and checkout for a deleted product without reducing stock", async () => {
    const { productId, variantId } = await seedProduct({ stock: 5 });
    await cartRedisRepository.setItemAtomic("buyer", variantId, 5, 1);
    await productMongoRepository.delete(productId, "admin");
    expect(await cartService.getCart("buyer")).toEqual([]);
    await expect(cartService.addItem("buyer", variantId)).rejects.toThrow(
      "Variant not found",
    );
    await expect(cartService.upsertItem("buyer", variantId, 2)).rejects.toThrow(
      "Variant not found",
    );
    await expect(
      orderService.checkout({ userId: "buyer", addressId: "addr-1" }),
    ).rejects.toThrow("no longer available");
    expect(orderPrismaRepository.create).not.toHaveBeenCalled();
    expect((await Product.findById(productId).lean()).variants[0].stock).toBe(
      5,
    );
    await expect(
      cartService.upsertItem("buyer", variantId, 0),
    ).resolves.toEqual({ removed: true });
  });

  it("rejects a mixed cart instead of silently ordering only its available items", async () => {
    const first = await seedProduct({ stock: 5 });
    const second = await seedProduct({ stock: 5 });
    await Promise.all([
      cartRedisRepository.setItemAtomic("buyer", first.variantId, 5, 1),
      cartRedisRepository.setItemAtomic("buyer", second.variantId, 5, 1),
    ]);
    await productMongoRepository.deleteVariant(
      second.productId,
      second.variantId,
      "admin",
    );
    await expect(
      orderService.checkout({ userId: "buyer", addressId: "addr-1" }),
    ).rejects.toThrow("no longer available");
    expect(orderPrismaRepository.create).not.toHaveBeenCalled();
    expect(
      (await Product.findById(first.productId).lean()).variants[0].stock,
    ).toBe(5);
    await expect(
      cartService.addItem("buyer", second.variantId),
    ).rejects.toThrow("not available");
  });

  it("rechecks deletion atomically if an admin deletes after checkout reads the cart", async () => {
    const { productId, variantId } = await seedProduct({ stock: 5 });
    await cartRedisRepository.setItemAtomic("buyer", variantId, 5, 1);
    const update = Product.findOneAndUpdate.bind(Product);
    const spy = vi
      .spyOn(Product, "findOneAndUpdate")
      .mockImplementationOnce(async (...args) => {
        await Product.updateOne(
          { _id: productId },
          { $set: { deletedAt: new Date(), isActive: false } },
        );
        return update(...args);
      });
    try {
      await expect(
        orderService.checkout({ userId: "buyer", addressId: "addr-1" }),
      ).rejects.toThrow("ran out of stock");
      expect((await Product.findById(productId).lean()).variants[0].stock).toBe(
        5,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("restocks a deleted product and variant once for an old order", async () => {
    const { productId, variantId } = await seedProduct({ stock: 3 });
    await productMongoRepository.deleteVariant(productId, variantId, "admin");
    await productMongoRepository.delete(productId, "admin");
    const payload = { items: [{ variantId, quantity: 2 }] };
    await outboxHandlers["order.stock.restore"](payload, {
      eventId: "return-old-order",
    });
    await outboxHandlers["order.stock.restore"](payload, {
      eventId: "return-old-order",
    });
    const product = await Product.findById(productId).lean();
    expect(product.variants[0].stock).toBe(5);
    expect(product.deletedAt).toBeInstanceOf(Date);
    expect(product.variants[0].deletedAt).toBeInstanceOf(Date);
    expect(product.isActive).toBe(false);
  });
});
