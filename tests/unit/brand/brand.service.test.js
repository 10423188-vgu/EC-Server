import { describe, it, expect, vi, beforeEach } from "vitest";
import { brandService } from "../../../src/modules/brand/brand.service.js";
import { brandPrismaRepository } from "../../../src/modules/brand/brand.prisma.repository.js";
import { outboxRepository } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import { prisma } from "../../../src/configs/db/index.js";
import { NotFoundError } from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/brand/brand.prisma.repository.js", () => ({
  brandPrismaRepository: {
    findById: vi.fn(),
    update: vi.fn(),
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

const fakeTx = { name: "fake-tx" };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(fakeTx));
});

describe("brandService.updateBrand", () => {
  it("throws NotFoundError when the brand doesn't exist", async () => {
    brandPrismaRepository.findById.mockResolvedValue(null);

    await expect(brandService.updateBrand("b1", { name: "New" })).rejects.toThrow(NotFoundError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("enqueues a brand.renamed outbox event in the same transaction when the name changes", async () => {
    brandPrismaRepository.findById.mockResolvedValue({ id: "b1", name: "Old", slug: "old", logoUrl: null });
    brandPrismaRepository.update.mockResolvedValue({ id: "b1", name: "New" });

    const result = await brandService.updateBrand("b1", { name: "New" });

    expect(brandPrismaRepository.update).toHaveBeenCalledWith("b1", { name: "New" }, fakeTx);
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(fakeTx, {
      eventType: "brand.renamed",
      payload: { brandId: "b1", name: "New", slug: undefined },
    });
    expect(result).toEqual({ id: "b1", name: "New" });
  });

  it("does not enqueue an outbox event when only non-denormalized fields change", async () => {
    brandPrismaRepository.findById.mockResolvedValue({ id: "b1", name: "Old", slug: "old", logoUrl: null });
    brandPrismaRepository.update.mockResolvedValue({ id: "b1", isActive: false });

    await brandService.updateBrand("b1", { isActive: false });

    expect(outboxRepository.enqueue).not.toHaveBeenCalled();
  });
});
