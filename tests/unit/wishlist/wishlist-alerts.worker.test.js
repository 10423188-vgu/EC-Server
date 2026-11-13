import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/configs/db/index.js";
import { ProductChange } from "../../../src/models/product-change.model.js";
import { relayWishlistPriceDrops } from "../../../src/workers/wishlist-alerts.worker.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { outboxEvent: { createMany: vi.fn() } },
}));
vi.mock("../../../src/models/product-change.model.js", () => ({
  ProductChange: { find: vi.fn(), updateMany: vi.fn() },
}));

const event = {
  _id: "change-1",
  productId: "product",
  createdAt: new Date("2026-10-19"),
  priceDrop: { name: "Laptop", previousPrice: 100, price: 80 },
};
beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    select: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn().mockResolvedValue([event]),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  ProductChange.find.mockReturnValue(query);
});

describe("durable Mongo-to-Postgres price event relay", () => {
  it("does not acknowledge a Mongo event when PostgreSQL is unavailable", async () => {
    prisma.outboxEvent.createMany.mockRejectedValue(new Error("PG down"));
    await expect(relayWishlistPriceDrops()).rejects.toThrow("PG down");
    expect(ProductChange.updateMany).not.toHaveBeenCalled();
  });

  it("retries a failed Mongo acknowledgment using the same unique outbox ID", async () => {
    prisma.outboxEvent.createMany.mockResolvedValue({ count: 1 });
    ProductChange.updateMany
      .mockRejectedValueOnce(new Error("Mongo down"))
      .mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(relayWishlistPriceDrops()).rejects.toThrow("Mongo down");
    await relayWishlistPriceDrops();
    const [first, second] = prisma.outboxEvent.createMany.mock.calls.map(
      ([data]) => data,
    );
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      skipDuplicates: true,
      data: [
        { id: "wishlist-price:change-1", eventType: "wishlist.price.dropped" },
      ],
    });
  });
});
