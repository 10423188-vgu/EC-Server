import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/configs/db/index.js";
import { Product } from "../../../src/models/product.model.js";
import { wishlistService } from "../../../src/modules/wishlist/wishlist.service.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    wishlist: { findMany: vi.fn(), count: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));
vi.mock("../../../src/models/product.model.js", () => ({
  Product: { find: vi.fn(), findOne: vi.fn() },
}));

beforeEach(() => vi.resetAllMocks());

describe("shared wishlist privacy", () => {
  it("reads a bounded page for the private wishlist", async () => {
    prisma.wishlist.findMany.mockResolvedValue([]);
    prisma.wishlist.count.mockResolvedValue(30);

    const result = await wishlistService.getPaginatedWishlist("owner", {
      page: 2,
      limit: 12,
    });

    expect(prisma.wishlist.findMany).toHaveBeenCalledWith({
      where: { userId: "owner" },
      select: { productId: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { productId: "asc" }],
      skip: 12,
      take: 12,
    });
    expect(result).toEqual({
      data: [],
      pagination: { page: 2, limit: 12, total: 30, totalPages: 3 },
    });
  });

  it("only reads requested wishlist IDs", async () => {
    prisma.wishlist.findMany.mockResolvedValue([{ productId: "product" }]);
    Product.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: "product" }]),
    });

    await expect(
      wishlistService.getWishlistIds("owner", ["product"]),
    ).resolves.toEqual(["product"]);
    expect(prisma.wishlist.findMany).toHaveBeenCalledWith({
      where: { userId: "owner", productId: { in: ["product"] } },
      select: { productId: true },
    });
  });

  it("revokes the share token with one scoped write and returns private settings", async () => {
    prisma.user.update.mockResolvedValue({
      wishlistShareToken: null,
      wishlistSaleAlerts: true,
    });
    await expect(wishlistService.disableSharing("owner")).resolves.toEqual({
      shareToken: null,
      saleAlerts: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "owner" },
        data: { wishlistShareToken: null },
      }),
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it("returns 404 after the owner revokes the token", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      wishlistService.getSharedWishlist("revoked", { page: 1, limit: 12 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.wishlist.findMany).not.toHaveBeenCalled();
  });

  it("does not expose a suspended owner's wishlist", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "owner",
      suspendedAt: new Date(),
    });
    await expect(
      wishlistService.getSharedWishlist("token", { page: 1, limit: 12 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns only public products, with the cheapest effective variant price", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "owner",
      email: "private@example.com",
      name: "Private owner",
    });
    prisma.wishlist.findMany.mockResolvedValue([
      { productId: "product", createdAt: new Date() },
    ]);
    prisma.wishlist.count.mockResolvedValue(1);
    Product.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: "product",
          name: "Laptop",
          images: [],
          variants: [
            { price: 100, salePrice: null, isActive: true, stock: 1 },
            { price: 120, salePrice: 80, isActive: true, stock: 1 },
          ],
        },
      ]),
    });
    const result = await wishlistService.getSharedWishlist("token", {
      page: 1,
      limit: 12,
    });
    expect(result.data[0].product).toMatchObject({ price: 120, salePrice: 80 });
    expect(Object.keys(result.data[0])).toEqual(["product"]);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("Private owner");
    expect(JSON.stringify(result)).not.toContain("owner");
  });

  it("enables sharing only when private and generates an unguessable token", async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      wishlistShareToken: "saved-token",
      wishlistSaleAlerts: true,
    });
    await wishlistService.enableSharing("owner");
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "owner", wishlistShareToken: null, suspendedAt: null },
      data: {
        wishlistShareToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
  });
});

describe("wishlist price notifications", () => {
  const payload = {
    productId: "product",
    name: "Laptop",
    price: 80,
    observedAt: "2026-10-19T00:00:00.000Z",
  };

  it("sends batches with a stable keyset when more than 100 customers follow a product", async () => {
    Product.findOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ variants: [{ price: 80 }] }),
    });
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      userId: `user-${String(index).padStart(3, "0")}`,
    }));
    prisma.wishlist.findMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ userId: "user-100" }]);
    await wishlistService.sendPriceDropAlerts(payload, "event");
    expect(
      prisma.notification.createMany.mock.calls.map(
        ([request]) => request.data.length,
      ),
    ).toEqual([100, 1]);
    expect(prisma.wishlist.findMany.mock.calls[1][0].where.userId).toEqual({
      gt: "user-099",
    });
  });

  it("skips an obsolete drop when the price has already risen again", async () => {
    Product.findOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ variants: [{ price: 120 }] }),
    });
    await wishlistService.sendPriceDropAlerts(payload, "event");
    expect(prisma.wishlist.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it("honors opt-out/suspension, excludes later subscribers, and deduplicates retries", async () => {
    Product.findOne.mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue({ variants: [{ price: 100, salePrice: 80 }] }),
    });
    prisma.wishlist.findMany.mockResolvedValue([{ userId: "customer" }]);
    prisma.notification.createMany.mockResolvedValue({ count: 1 });
    await wishlistService.sendPriceDropAlerts(payload, "event");
    expect(prisma.wishlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: "product",
          createdAt: { lte: new Date(payload.observedAt) },
          user: { wishlistSaleAlerts: true, suspendedAt: null },
        },
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          eventKey: "event:customer",
          userId: "customer",
          type: "WISHLIST_PRICE_DROP",
          link: "/products/product",
        }),
      ],
    });
  });
});
