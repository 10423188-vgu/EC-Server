import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogListSchema,
  listCatalogRecords,
} from "../../../src/shared/catalog/catalog-admin.js";
import { Product } from "../../../src/models/product.model.js";

vi.mock("../../../src/models/product.model.js", () => ({
  Product: { aggregate: vi.fn() },
}));
const model = { findMany: vi.fn(), count: vi.fn() };
const query = {
  page: 2,
  limit: 10,
  search: "Camera",
  status: "inactive",
  sortOrder: "desc",
};
const option = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  model.count.mockResolvedValue(21);
  Product.aggregate.mockReturnValue({ option });
  option.mockResolvedValue([{ _id: "c1", count: 3 }]);
});
describe("admin catalog list", () => {
  it("paginates inactive categories and batches product counts including trash", async () => {
    model.findMany.mockResolvedValue([
      { id: "c1", name: "Camera", _count: { children: 2 } },
      { id: "c2", name: "Cameras", _count: { children: 0 } },
    ]);
    const result = await listCatalogRecords(model, "categoryId", query);
    expect(
      result.data.map(({ productCount, childCount }) => [
        productCount,
        childCount,
      ]),
    ).toEqual([
      [3, 2],
      [0, 0],
    ]);
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: {
          isActive: false,
          OR: [
            { name: { contains: "Camera", mode: "insensitive" } },
            { slug: { contains: "Camera", mode: "insensitive" } },
          ],
        },
      }),
    );
    expect(Product.aggregate).toHaveBeenCalledExactlyOnceWith([
      { $match: { categoryId: { $in: ["c1", "c2"] } } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);
  });
  it("supports brands without child relations", async () => {
    model.findMany.mockResolvedValue([{ id: "c1", name: "Brand" }]);
    const result = await listCatalogRecords(model, "brandId", query);
    expect(result.data[0]).toEqual({
      id: "c1",
      name: "Brand",
      productCount: 3,
    });
    expect(model.findMany.mock.calls[0][0]).not.toHaveProperty("include");
  });
  it("skips Mongo on an empty page", async () => {
    model.findMany.mockResolvedValue([]);
    await listCatalogRecords(model, "brandId", query);
    expect(Product.aggregate).not.toHaveBeenCalled();
  });
  it("validates bounds and normalizes defaults", () => {
    expect(catalogListSchema.parse({ query: {} }).query).toEqual({
      page: 1,
      limit: 10,
      search: "",
      sortOrder: "asc",
    });
    expect(catalogListSchema.safeParse({ query: { page: 1001 } }).success).toBe(
      false,
    );
    expect(catalogListSchema.safeParse({ query: { limit: 51 } }).success).toBe(
      false,
    );
    expect(
      catalogListSchema.safeParse({ query: { status: "unknown" } }).success,
    ).toBe(false);
  });
});
