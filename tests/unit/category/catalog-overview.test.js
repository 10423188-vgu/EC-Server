import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogOverview } from "../../../src/shared/catalog/catalog-admin.js";
import { Product } from "../../../src/models/product.model.js";

vi.mock("../../../src/models/product.model.js", () => ({
  Product: { aggregate: vi.fn() },
}));
const model = { findMany: vi.fn() };
const option = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Product.aggregate.mockReturnValue({ option });
});

describe("catalog overview", () => {
  it("counts the entire catalog and excludes orphan product references from rankings", async () => {
    model.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        id: `c${index}`,
        name: `Category ${index}`,
        isActive: index < 8,
      })),
    );
    option.mockResolvedValue([
      { _id: "c11", count: 12 },
      { _id: "c2", count: 3 },
      { _id: "deleted-category", count: 999 },
    ]);
    const result = await getCatalogOverview(model, "categoryId");
    expect(result).toEqual({
      total: 12,
      active: 8,
      inactive: 4,
      empty: 10,
      top: [
        { id: "c11", name: "Category 11", count: 12 },
        { id: "c2", name: "Category 2", count: 3 },
      ],
    });
    expect(model.findMany).toHaveBeenCalledExactlyOnceWith({
      select: { id: true, name: true, isActive: true },
    });
    expect(Product.aggregate).toHaveBeenCalledExactlyOnceWith([
      { $match: { categoryId: { $ne: null } } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);
  });
  it("limits ranking to five and sorts tied counts by name then id", async () => {
    const records = [
      "Foxtrot",
      "Echo",
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
    ].map((name, i) => ({ id: `b${i}`, name, isActive: true }));
    model.findMany.mockResolvedValue(records);
    option.mockResolvedValue(records.map(({ id }) => ({ _id: id, count: 2 })));
    const result = await getCatalogOverview(model, "brandId");
    expect(result.top.map(({ name }) => name)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
      "Echo",
    ]);
    expect(result.empty).toBe(0);
    expect(Product.aggregate.mock.calls[0][0][1].$group._id).toBe("$brandId");
  });
  it("returns zero totals and an empty ranking when no records exist", async () => {
    model.findMany.mockResolvedValue([]);
    option.mockResolvedValue([]);
    await expect(getCatalogOverview(model, "categoryId")).resolves.toEqual({
      total: 0,
      active: 0,
      inactive: 0,
      empty: 0,
      top: [],
    });
  });
  it("keeps categories with no products in empty/status totals", async () => {
    model.findMany.mockResolvedValue([
      { id: "c1", name: "Unused", isActive: false },
    ]);
    option.mockResolvedValue([]);
    await expect(getCatalogOverview(model, "categoryId")).resolves.toEqual({
      total: 1,
      active: 0,
      inactive: 1,
      empty: 1,
      top: [],
    });
  });
});
