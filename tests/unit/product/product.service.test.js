import { describe, it, expect, vi, beforeEach } from "vitest";
import { productService } from "../../../src/modules/product/product.service.js";
import { productMongoRepository } from "../../../src/modules/product/product.mongo.repository.js";
import { prisma } from "../../../src/configs/db/index.js";
import { deleteFromCloudinary } from "../../../src/shared/utils/cloudinary.util.js";
import { NotFoundError, BadRequestError } from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/product/product.mongo.repository.js", () => ({
  productMongoRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findAdminById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
    restoreVariant: vi.fn(),
    skuExists: vi.fn(),
    skuExistsAny: vi.fn(),
    addVariant: vi.fn(),
    findVariant: vi.fn(),
    updateVariant: vi.fn(),
    deleteVariant: vi.fn(),
    findForRelated: vi.fn(),
    findRelated: vi.fn(),
  },
}));

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    category: { findUnique: vi.fn() },
    brand: { findUnique: vi.fn() },
  },
}));

vi.mock("../../../src/shared/utils/cloudinary.util.js", () => ({
  deleteFromCloudinary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/shared/utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.category.findUnique.mockResolvedValue(null);
  prisma.brand.findUnique.mockResolvedValue(null);
});

describe("productService.getProducts", () => {
  it("paginates and shapes the result from the repository", async () => {
    productMongoRepository.findAll.mockResolvedValue({ products: [{ id: "p1" }], total: 25 });

    const result = await productService.getProducts({ page: 2, limit: 10 });

    expect(productMongoRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, sortField: "createdAt", sortOrder: "desc" })
    );
    expect(result).toEqual({
      data: [{ id: "p1" }],
      pagination: { total: 25, page: 2, limit: 10, totalPages: 3 },
    });
  });
});

describe("productService.getProductById", () => {
  it("throws NotFoundError when the product does not exist", async () => {
    productMongoRepository.findById.mockResolvedValue(null);

    await expect(productService.getProductById("missing")).rejects.toThrow(NotFoundError);
  });

  it("returns the product when found", async () => {
    productMongoRepository.findById.mockResolvedValue({ id: "p1", name: "Shoe", isActive: true });

    await expect(productService.getProductById("p1")).resolves.toEqual({ id: "p1", name: "Shoe", isActive: true });
  });
});

describe("productService.createProduct", () => {
  const baseData = { name: "Shoe", categoryId: "cat1", brandId: null, variants: [{ sku: "SKU1" }] };

  it("throws BadRequestError when a variant SKU is already taken", async () => {
    productMongoRepository.skuExistsAny.mockResolvedValue("SKU1");
    prisma.category.findUnique.mockResolvedValue({ id: "cat1", name: "Shoes", slug: "shoes" });

    await expect(productService.createProduct(baseData)).rejects.toThrow('SKU "SKU1" already exists');
    expect(productMongoRepository.create).not.toHaveBeenCalled();
  });

  it("throws BadRequestError when categoryId does not resolve to a real category", async () => {
    productMongoRepository.skuExistsAny.mockResolvedValue(null);
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(productService.createProduct(baseData)).rejects.toThrow("Category not found");
  });

  it("denormalizes category/brand name+slug onto the created product", async () => {
    productMongoRepository.skuExistsAny.mockResolvedValue(null);
    prisma.category.findUnique.mockResolvedValue({ id: "cat1", name: "Shoes", slug: "shoes" });
    productMongoRepository.create.mockResolvedValue({ id: "p1" });

    await productService.createProduct(baseData);

    expect(productMongoRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Shoe",
        categoryId: "cat1",
        categoryName: "Shoes",
        categorySlug: "shoes",
        brandId: null,
        brandName: null,
        brandSlug: null,
      })
    );
  });

  it("maps a concurrent duplicate-SKU write (Mongo code 11000) to a BadRequestError", async () => {
    productMongoRepository.skuExistsAny.mockResolvedValue(null);
    prisma.category.findUnique.mockResolvedValue({ id: "cat1", name: "Shoes", slug: "shoes" });
    const dupError = Object.assign(new Error("duplicate"), { code: 11000, keyValue: { "variants.sku": "SKU1" } });
    productMongoRepository.create.mockRejectedValue(dupError);

    await expect(productService.createProduct(baseData)).rejects.toThrow('SKU "SKU1" already exists');
  });

  it("rethrows unrelated write errors as-is", async () => {
    productMongoRepository.skuExistsAny.mockResolvedValue(null);
    prisma.category.findUnique.mockResolvedValue({ id: "cat1", name: "Shoes", slug: "shoes" });
    productMongoRepository.create.mockRejectedValue(new Error("connection lost"));

    await expect(productService.createProduct(baseData)).rejects.toThrow("connection lost");
  });
});

describe("productService.updateProduct", () => {
  it("throws NotFoundError when the product does not exist", async () => {
    productMongoRepository.findById.mockResolvedValue(null);

    await expect(productService.updateProduct("missing", {})).rejects.toThrow(NotFoundError);
  });

  it("re-resolves denormalized fields against the existing brand when only categoryId changes", async () => {
    productMongoRepository.findById.mockResolvedValue({ id: "p1", categoryId: "cat-old", brandId: "brand-old", images: [] });
    prisma.category.findUnique.mockResolvedValue({ id: "cat-new", name: "New Cat", slug: "new-cat" });
    prisma.brand.findUnique.mockResolvedValue({ id: "brand-old", name: "Old Brand", slug: "old-brand" });
    productMongoRepository.update.mockResolvedValue({ id: "p1" });

    await productService.updateProduct("p1", { categoryId: "cat-new" });

    expect(prisma.brand.findUnique).toHaveBeenCalledWith({ where: { id: "brand-old" }, select: expect.any(Object) });
    expect(productMongoRepository.update).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ categoryId: "cat-new", categoryName: "New Cat", brandId: "brand-old", brandName: "Old Brand" })
    );
  });

  it("detaches gallery images without destroying assets used by old orders", async () => {
    productMongoRepository.findById.mockResolvedValue({
      id: "p1",
      categoryId: "cat1",
      brandId: null,
      images: [{ url: "old1.jpg" }, { url: "old2.jpg" }],
    });
    productMongoRepository.update.mockResolvedValue({ id: "p1" });

    await productService.updateProduct("p1", { images: [{ url: "new1.jpg" }] });

    expect(deleteFromCloudinary).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the product is deleted concurrently mid-update", async () => {
    productMongoRepository.findById.mockResolvedValue({ id: "p1", categoryId: "cat1", brandId: null, images: [] });
    productMongoRepository.update.mockResolvedValue(null);

    await expect(productService.updateProduct("p1", { name: "New name" })).rejects.toThrow(NotFoundError);
  });
});

describe("productService.deleteProduct", () => {
  it("throws NotFoundError when the product does not exist", async () => {
    productMongoRepository.delete.mockResolvedValue(null);

    await expect(productService.deleteProduct("missing")).rejects.toThrow(NotFoundError);
  });

  it("soft deletes with an audit user and keeps its images", async () => {
    productMongoRepository.delete.mockResolvedValue({ id: "p1", images: [{ url: "a.jpg" }] });

    await productService.deleteProduct("p1", "admin-1");

    expect(productMongoRepository.delete).toHaveBeenCalledWith("p1", "admin-1");
    expect(deleteFromCloudinary).not.toHaveBeenCalled();
  });
});

describe("productService.createVariant", () => {
  it("throws NotFoundError when the product does not exist", async () => {
    productMongoRepository.findById.mockResolvedValue(null);
    productMongoRepository.skuExists.mockResolvedValue(false);

    await expect(productService.createVariant("missing", { sku: "SKU1" })).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when the SKU is already taken", async () => {
    productMongoRepository.findById.mockResolvedValue({ id: "p1" });
    productMongoRepository.skuExists.mockResolvedValue(true);

    await expect(productService.createVariant("p1", { sku: "SKU1" })).rejects.toThrow('SKU "SKU1" already exists');
  });

  it("maps a concurrent duplicate-SKU write to a BadRequestError", async () => {
    productMongoRepository.findById.mockResolvedValue({ id: "p1" });
    productMongoRepository.skuExists.mockResolvedValue(false);
    productMongoRepository.addVariant.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));

    await expect(productService.createVariant("p1", { sku: "SKU1" })).rejects.toThrow('SKU "SKU1" already exists');
  });
});

describe("productService.updateVariant / deleteVariant", () => {
  it("updateVariant throws NotFoundError when the variant does not exist", async () => {
    productMongoRepository.findVariant.mockResolvedValue(null);

    await expect(productService.updateVariant("p1", "missing", {})).rejects.toThrow(NotFoundError);
  });

  it("updateVariant preserves detached image assets for old order snapshots", async () => {
    productMongoRepository.findVariant.mockResolvedValue({ id: "v1", images: [{ url: "old.jpg" }] });
    productMongoRepository.updateVariant.mockResolvedValue({ id: "v1" });

    await productService.updateVariant("p1", "v1", { images: [{ url: "new.jpg" }] });

    expect(deleteFromCloudinary).not.toHaveBeenCalled();
  });

  it("deleteVariant throws NotFoundError when the variant does not exist", async () => {
    productMongoRepository.findVariant.mockResolvedValue(null);

    await expect(productService.deleteVariant("p1", "missing")).rejects.toThrow(NotFoundError);
  });

  it("deleteVariant preserves the variant and its images", async () => {
    productMongoRepository.findVariant.mockResolvedValue({ id: "v1", images: [{ url: "a.jpg" }] });
    productMongoRepository.deleteVariant.mockResolvedValue({ id: "p1" });

    await productService.deleteVariant("p1", "v1");

    expect(productMongoRepository.deleteVariant).toHaveBeenCalledWith("p1", "v1", undefined);
    expect(deleteFromCloudinary).not.toHaveBeenCalled();
  });
});

describe("productService.getRelatedProducts", () => {
  it("throws NotFoundError when the source product does not exist", async () => {
    productMongoRepository.findForRelated.mockResolvedValue(null);

    await expect(productService.getRelatedProducts("missing", 8)).rejects.toThrow(NotFoundError);
  });

  it("delegates to findRelated using the source product's category/brand/tags", async () => {
    productMongoRepository.findForRelated.mockResolvedValue({ categoryId: "cat1", brandId: "brand1", tags: ["sale"] });
    productMongoRepository.findRelated.mockResolvedValue([{ id: "p2" }]);

    const result = await productService.getRelatedProducts("p1", 8);

    expect(productMongoRepository.findRelated).toHaveBeenCalledWith(
      "p1",
      { categoryId: "cat1", brandId: "brand1", tags: ["sale"] },
      8
    );
    expect(result).toEqual([{ id: "p2" }]);
  });

  it("defaults tags to an empty array when the source product has none", async () => {
    productMongoRepository.findForRelated.mockResolvedValue({ categoryId: "cat1", brandId: null });
    productMongoRepository.findRelated.mockResolvedValue([]);

    await productService.getRelatedProducts("p1", 8);

    expect(productMongoRepository.findRelated).toHaveBeenCalledWith(
      "p1",
      { categoryId: "cat1", brandId: null, tags: [] },
      8
    );
  });
});
