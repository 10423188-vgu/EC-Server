import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Product } from "../../src/models/product.model.js";
import { StockAdjustment } from "../../src/models/stock-adjustment.model.js";
import {
  adjustProductStock,
  listStockAdjustments,
} from "../../src/modules/product/product.inventory.service.js";

let database;
let product;
let variantId;
beforeAll(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  await Promise.all([Product.init(), StockAdjustment.init()]);
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
});
beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), StockAdjustment.deleteMany({})]);
  product = await Product.create({
    name: "Inventory",
    slug: "inventory",
    categoryId: "cat",
    categorySlug: "cat",
    categoryName: "Cat",
    inStock: true,
    variants: [{ sku: "INV", name: "Default", price: 100, stock: 3 }],
  });
  variantId = product.variants[0]._id;
});
const adjust = (data) =>
  adjustProductStock(product._id, variantId, "admin", {
    reason: "Stock count",
    ...data,
  });

describe("manual stock adjustments with real Mongo transactions", () => {
  it("changes stock and persists its audit record once even with concurrent retries", async () => {
    const requestId = randomUUID();
    const result = await Promise.all([
      adjust({ requestId, delta: 2 }),
      adjust({ requestId, delta: 2 }),
    ]);
    expect(result[0]).toMatchObject({
      before: 3,
      after: 5,
      delta: 2,
      changedBy: "admin",
    });
    expect(result[1]._id).toBe(requestId);
    expect((await Product.findById(product._id).lean()).variants[0].stock).toBe(
      5,
    );
    expect(await StockAdjustment.countDocuments()).toBe(1);
    await expect(adjust({ requestId, delta: 1 })).rejects.toThrow(
      "different values",
    );
    expect((await listStockAdjustments(product._id, variantId))[0]._id).toBe(
      requestId,
    );
  });

  it("prevents negative stock and rejects deleted variants without creating history", async () => {
    await expect(
      adjust({ requestId: randomUUID(), delta: -4 }),
    ).rejects.toThrow("negative");
    await Product.updateOne(
      { _id: product._id },
      { $set: { "variants.0.deletedAt": new Date() } },
    );
    await expect(adjust({ requestId: randomUUID(), delta: 2 })).rejects.toThrow(
      "unavailable",
    );
    expect((await Product.findById(product._id).lean()).variants[0].stock).toBe(
      3,
    );
    expect(await StockAdjustment.countDocuments()).toBe(0);
  });

  it("rolls back inventory if the audit write fails", async () => {
    const spy = vi
      .spyOn(StockAdjustment, "create")
      .mockRejectedValueOnce(new Error("Audit write failed"));
    try {
      await expect(
        adjust({ requestId: randomUUID(), delta: 2 }),
      ).rejects.toThrow("Audit write failed");
      expect(
        (await Product.findById(product._id).lean()).variants[0].stock,
      ).toBe(3);
      expect(await StockAdjustment.countDocuments()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not overwrite checkout deductions running at the same time", async () => {
    await Promise.allSettled([
      adjust({ requestId: randomUUID(), delta: -2 }),
      Product.findOneAndUpdate(
        {
          _id: product._id,
          variants: { $elemMatch: { _id: variantId, stock: { $gte: 2 } } },
        },
        { $inc: { "variants.$.stock": -2 } },
      ),
    ]);
    expect((await Product.findById(product._id).lean()).variants[0].stock).toBe(
      1,
    );
  });

  it("updates the availability summary when stock reaches zero or is replenished", async () => {
    await adjust({ requestId: randomUUID(), delta: -3 });
    expect((await Product.findById(product._id).lean()).inStock).toBe(false);
    await adjust({ requestId: randomUUID(), delta: 1 });
    expect((await Product.findById(product._id).lean()).inStock).toBe(true);
  });
});
