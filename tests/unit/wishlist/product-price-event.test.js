import { beforeEach, describe, expect, it, vi } from "vitest";
import { Product } from "../../../src/models/product.model.js";
import { ProductChange } from "../../../src/models/product-change.model.js";
import { auditProductChange } from "../../../src/modules/product/product.history.service.js";
import { lowestProductPrice } from "../../../src/modules/product/product.pricing.js";

vi.mock("mongoose", () => ({
  default: {
    set: vi.fn(),
    connection: { transaction: (callback) => callback() },
  },
}));
vi.mock("../../../src/models/product.model.js", () => ({
  Product: { findById: vi.fn() },
}));
vi.mock("../../../src/models/product-change.model.js", () => ({
  ProductChange: { create: vi.fn() },
}));
vi.mock("../../../src/configs/db/index.js", () => ({ prisma: {} }));

beforeEach(() => vi.resetAllMocks());

const product = (price) => ({
  _id: "product",
  name: "Laptop",
  isActive: true,
  variants: [{ _id: "variant", name: "Default", sku: "SKU", price }],
});
const audit = async (before, after) => {
  Product.findById
    .mockReturnValueOnce({ lean: () => Promise.resolve(before) })
    .mockReturnValueOnce({ lean: () => Promise.resolve(after) });
  return auditProductChange(
    "product",
    "admin",
    "variant.updated",
    async () => after,
  );
};

describe("product price-drop events", () => {
  it("records a price drop alongside the audited edit", async () => {
    await audit(product(100), product(80));
    expect(ProductChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        priceDrop: { name: "Laptop", previousPrice: 100, price: 80 },
      }),
    );
  });

  it("does not announce an increase or a newly created product as a drop", async () => {
    await audit(product(80), product(100));
    expect(ProductChange.create.mock.calls[0][0]).not.toHaveProperty(
      "priceDrop",
    );
    ProductChange.create.mockClear();
    await audit(null, product(80));
    expect(ProductChange.create.mock.calls[0][0]).not.toHaveProperty(
      "priceDrop",
    );
  });

  it("ignores deleted and inactive variants when comparing prices", () => {
    expect(
      lowestProductPrice({
        variants: [
          { price: 5, deletedAt: new Date() },
          { price: 6, isActive: false },
          { price: 100, salePrice: 80 },
        ],
      }),
    ).toBe(80);
    expect(lowestProductPrice({ ...product(80), isActive: false })).toBeNull();
  });
});
