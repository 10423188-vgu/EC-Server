import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkUpdateProducts } from "../../../src/modules/product/product.bulk.service.js";
import { Product } from "../../../src/models/product.model.js";
import { ProductChange } from "../../../src/models/product-change.model.js";
import mongoose from "mongoose";

vi.mock("mongoose", () => ({
  default: { connection: { transaction: vi.fn((work) => work()) } },
}));

vi.mock("../../../src/models/product.model.js", () => ({
  Product: {
    find: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("../../../src/models/product-change.model.js", () => ({
  ProductChange: { insertMany: vi.fn() },
}));

vi.mock("../../../src/modules/product/product.history.service.js", () => ({
  productChanges: vi.fn((previous, next) =>
    previous.isActive === next.isActive
      ? []
      : [
          {
            field: "isActive",
            before: previous.isActive,
            after: next.isActive,
          },
        ],
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Product.find.mockReturnValue({
    lean: vi.fn().mockResolvedValue([
      { _id: { toString: () => "p1" }, isActive: false, deletedAt: null },
      { _id: "p2", isActive: true, deletedAt: null },
    ]),
  });
});

describe("bulkUpdateProducts", () => {
  it("updates eligible records in one batch and reports missing IDs", async () => {
    const result = await bulkUpdateProducts(
      { ids: ["p1", "p2", "missing"], action: "activate" },
      "admin-1",
    );

    expect(result.changed).toEqual(["p1"]);
    expect(result.skipped).toEqual(["p2"]);
    expect(result.failed).toEqual([
      { id: "missing", message: "Product not found" },
    ]);
    expect(Product.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["p1"] } },
      { $set: { isActive: true } },
    );
    expect(ProductChange.insertMany).toHaveBeenCalledTimes(1);
    expect(mongoose.connection.transaction).toHaveBeenCalledTimes(1);
  });

  it("does not issue writes when every requested change is skipped", async () => {
    await expect(
      bulkUpdateProducts({ ids: ["p2"], action: "activate" }, "admin-1"),
    ).resolves.toEqual({ changed: [], skipped: ["p2"], failed: [] });
    expect(Product.updateMany).not.toHaveBeenCalled();
    expect(ProductChange.insertMany).not.toHaveBeenCalled();
  });
});
