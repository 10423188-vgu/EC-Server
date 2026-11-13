import { describe, expect, it, vi } from "vitest";
import { adminProductPipeline } from "../../../src/modules/product/product.admin.service.js";
import {
  adminProductsSchema,
  productExportSchema,
} from "../../../src/modules/product/product.admin.schema.js";
vi.mock("../../../src/configs/db/index.js", () => ({ prisma: {} }));
vi.mock("../../../src/models/product.model.js", () => ({ Product: {} }));
describe("product admin brand filter", () => {
  it("retains brandSlug in list/export validation and Mongo matching", () => {
    const query = adminProductsSchema.parse({
      query: { brandSlug: "acme" },
    }).query;
    expect(query.brandSlug).toBe("acme");
    expect(adminProductPipeline(query)[0]).toEqual({
      $match: { deletedAt: null, brandSlug: "acme" },
    });
    expect(
      productExportSchema.parse({ query: { brandSlug: "acme" }, body: {} })
        .query.brandSlug,
    ).toBe("acme");
  });
});
