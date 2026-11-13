import { describe, it, expect, vi, beforeEach } from "vitest";
import { categoryService } from "../../../src/modules/category/category.service.js";
import { categoryPrismaRepository } from "../../../src/modules/category/category.prisma.repository.js";
import { outboxRepository } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import { prisma } from "../../../src/configs/db/index.js";
import { NotFoundError } from "../../../src/shared/errors/app.error.js";
import { Product } from "../../../src/models/product.model.js";
import { deleteFromCloudinary } from "../../../src/shared/utils/cloudinary.util.js";

vi.mock("../../../src/modules/category/category.prisma.repository.js", () => ({
  categoryPrismaRepository: {
    findById: vi.fn(),
    update: vi.fn(),
    countChildren: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../src/shared/outbox/outbox.prisma.repository.js", () => ({
  outboxRepository: { enqueue: vi.fn() },
}));

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { $transaction: vi.fn() },
}));

vi.mock("../../../src/models/product.model.js", () => ({
  Product: { countDocuments: vi.fn() },
}));

vi.mock("../../../src/shared/utils/cloudinary.util.js", () => ({
  deleteFromCloudinary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/shared/utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const fakeTx = { name: "fake-tx", $executeRaw: vi.fn(), category: { findMany: vi.fn() } };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(fakeTx));
});

describe("categoryService.updateCategory", () => {
  it("does not save or enqueue a rename when the new parent creates a cycle", async () => {
    categoryPrismaRepository.findById.mockResolvedValue({ id: "c1" });
    fakeTx.category.findMany.mockResolvedValue([{ id: "c1", parentId: null }, { id: "c2", parentId: "c1" }]);
    await expect(categoryService.updateCategory("c1", { name: "Renamed", parentId: "c2" })).rejects.toThrow("descendants");
    expect(categoryPrismaRepository.update).not.toHaveBeenCalled();
    expect(outboxRepository.enqueue).not.toHaveBeenCalled();
  });

  it("cleans up the old image when explicitly removed", async () => {
    categoryPrismaRepository.findById.mockResolvedValue({ id: "c1", imageUrl: "https://example.test/old.png" });
    await categoryService.updateCategory("c1", { imageUrl: null });
    expect(deleteFromCloudinary).toHaveBeenCalledWith("https://example.test/old.png", "categories");
  });
  it("throws NotFoundError when the category doesn't exist", async () => {
    categoryPrismaRepository.findById.mockResolvedValue(null);

    await expect(categoryService.updateCategory("c1", { name: "New" })).rejects.toThrow(NotFoundError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("enqueues a category.renamed outbox event in the same transaction when the slug changes", async () => {
    categoryPrismaRepository.findById.mockResolvedValue({ id: "c1", name: "Old", slug: "old", imageUrl: null, videoUrl: null });
    categoryPrismaRepository.update.mockResolvedValue({ id: "c1", slug: "new-slug" });

    const result = await categoryService.updateCategory("c1", { slug: "new-slug" });

    expect(categoryPrismaRepository.update).toHaveBeenCalledWith("c1", { slug: "new-slug" }, fakeTx);
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(fakeTx, {
      eventType: "category.renamed",
      payload: { categoryId: "c1", name: undefined, slug: "new-slug" },
    });
    expect(result).toEqual({ id: "c1", slug: "new-slug" });
  });

  it("does not enqueue an outbox event when only non-denormalized fields change", async () => {
    categoryPrismaRepository.findById.mockResolvedValue({ id: "c1", name: "Old", slug: "old", imageUrl: null, videoUrl: null });
    categoryPrismaRepository.update.mockResolvedValue({ id: "c1", isActive: false });

    await categoryService.updateCategory("c1", { isActive: false });

    expect(outboxRepository.enqueue).not.toHaveBeenCalled();
  });
});

describe("category create/delete", () => {
  it("creates through the transaction after validating a parent", async () => {
    fakeTx.category.findMany.mockResolvedValue([{ id: "parent", parentId: null }]);
    await categoryService.createCategory({ name: "Child", parentId: "parent" });
    expect(categoryPrismaRepository.create).toHaveBeenCalledWith({ name: "Child", parentId: "parent" }, fakeTx);
  });
  it("rejects deleting categories containing inactive child categories", async () => {
    categoryPrismaRepository.findById.mockResolvedValue({ id: "c1" });
    categoryPrismaRepository.countChildren.mockResolvedValue(1);
    Product.countDocuments.mockResolvedValue(0);
    await expect(categoryService.deleteCategory("c1")).rejects.toThrow("subcategories");
    expect(categoryPrismaRepository.delete).not.toHaveBeenCalled();
  });
  it("rejects deleting categories referenced by products including trash", async () => {
    categoryPrismaRepository.findById.mockResolvedValue({ id: "c1" });
    categoryPrismaRepository.countChildren.mockResolvedValue(0);
    Product.countDocuments.mockResolvedValue(1);
    await expect(categoryService.deleteCategory("c1")).rejects.toThrow("existing products");
    expect(Product.countDocuments).toHaveBeenCalledWith({ categoryId: "c1" });
    expect(categoryPrismaRepository.delete).not.toHaveBeenCalled();
  });
});
