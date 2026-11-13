import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/configs/db/index.js";
import { Product } from "../../../src/models/product.model.js";
import { orderAnalyticsRepository } from "../../../src/modules/order/order.analytics.repository.js";
import { orderSchema } from "../../../src/modules/order/order.schema.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    order: { groupBy: vi.fn() },
    payment: { count: vi.fn(), findMany: vi.fn() },
    orderItem: { groupBy: vi.fn() },
  },
}));
vi.mock("../../../src/models/product.model.js", () => ({
  Product: { find: vi.fn() },
}));

describe("admin analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T14:00:00.000Z"));
  });

  it("books payments and completed refunds on their own UTC dates", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ day: "2026-10-31", total: 100000 }])
      .mockResolvedValueOnce([{ day: "2026-11-01", total: 30000 }])
      .mockResolvedValueOnce([
        { country_code: "VN", total: 100000, orders: 1 },
      ]);
    prisma.order.groupBy.mockResolvedValue([
      { status: "DELIVERED", _count: { _all: 1 } },
      { status: "CANCELLED", _count: { _all: 1 } },
    ]);
    prisma.payment.count.mockResolvedValue(1);
    prisma.orderItem.groupBy.mockResolvedValue([
      {
        productId: "product-1",
        productName: "Laptop",
        _sum: { quantity: 2, subtotal: 200000 },
      },
    ]);
    Product.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: "product-1",
          categoryId: "electronics",
          categoryName: "Electronics",
          images: [{ url: "https://example.test/laptop.webp" }],
          variants: [{ price: 120000, salePrice: 100000 }],
          reviewStats: { average: 4.5 },
        },
      ]),
    });
    prisma.payment.findMany.mockResolvedValue([
      {
        amount: 100000,
        paidAt: new Date("2026-10-31T09:00:00.000Z"),
        order: { id: "order-1", user: { name: "Alex", email: "a@b.com" } },
      },
    ]);

    const result = await orderAnalyticsRepository.getOverview(3);

    expect(result.daily).toEqual([
      { day: "2026-10-30", collected: 0, refunded: 0, net: 0 },
      { day: "2026-10-31", collected: 100000, refunded: 0, net: 100000 },
      { day: "2026-11-01", collected: 0, refunded: 30000, net: -30000 },
    ]);
    expect(result.countrySales).toEqual([
      { countryCode: "VN", revenue: 100000, orders: 1 },
    ]);
    expect(result.summary).toEqual({
      collectedRevenue: 100000,
      refundedAmount: 30000,
      netRevenue: 70000,
      totalOrders: 2,
      paidOrders: 1,
      averageOrderValue: 100000,
    });
    expect(result.topProducts).toEqual([
      { id: "product-1", name: "Laptop", quantity: 2 },
    ]);
    expect(result.topProductCards).toEqual([
      {
        id: "product-1",
        name: "Laptop",
        quantity: 2,
        sales: 200000,
        image: "https://example.test/laptop.webp",
        price: 120000,
        salePrice: 100000,
        rating: 4.5,
      },
    ]);
    expect(result.topProductsByCategory).toEqual([
      {
        id: "electronics",
        name: "Electronics",
        products: [{ id: "product-1", name: "Laptop", quantity: 2 }],
      },
    ]);
    expect(result.categoryBreakdown).toEqual([
      { id: "electronics", name: "Electronics", quantity: 2 },
    ]);
    expect(result.recentSales[0].customer).toBe("Alex");
    expect(Product.find).toHaveBeenCalledTimes(1);
    expect(prisma.payment.count).toHaveBeenCalledWith({
      where: {
        paidAt: {
          gte: new Date("2026-10-30T00:00:00.000Z"),
          lt: new Date("2026-11-02T00:00:00.000Z"),
        },
        status: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
    });
    vi.useRealTimers();
  });

  it("groups all sold units by category and combines categories after the fourth", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.order.groupBy.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.orderItem.groupBy.mockResolvedValue(
      [6, 5, 4, 3, 2, 1].map((quantity, index) => ({
        productId: `product-${index}`,
        productName: `Product ${index}`,
        _sum: { quantity },
      })),
    );
    Product.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        Array.from({ length: 6 }, (_, index) => ({
          _id: `product-${index}`,
          categoryId: `category-${index}`,
          categoryName: `Category ${index}`,
        })),
      ),
    });

    const result = await orderAnalyticsRepository.getOverview(7);

    expect(result.categoryBreakdown).toEqual([
      { id: "category-0", name: "Category 0", quantity: 6 },
      { id: "category-1", name: "Category 1", quantity: 5 },
      { id: "category-2", name: "Category 2", quantity: 4 },
      { id: "category-3", name: "Category 3", quantity: 3 },
      { id: "other", name: "Other", quantity: 3 },
    ]);
    expect(result.categoryBreakdown.reduce((sum, item) => sum + item.quantity, 0)).toBe(21);
    expect(result.topProductsByCategory).toHaveLength(6);
    expect(result.topProductsByCategory[5].products).toEqual([
      { id: "product-5", name: "Product 5", quantity: 1 },
    ]);
    expect(Product.find).toHaveBeenNthCalledWith(
      1,
      { _id: { $in: Array.from({ length: 6 }, (_, index) => `product-${index}`) } },
      { categoryId: 1, categoryName: 1 },
    );
    expect(Product.find).toHaveBeenNthCalledWith(
      2,
      { _id: { $in: ["product-0", "product-1", "product-2", "product-3"] } },
      expect.objectContaining({ images: { $slice: 1 }, variants: { $slice: 1 } }),
    );
    vi.useRealTimers();
  });

  it("ranks products within a category and merges old product names", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.order.groupBy.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.orderItem.groupBy.mockResolvedValue([
      { productId: "p1", productName: "New name", _sum: { quantity: 4 } },
      { productId: "p2", productName: "Second", _sum: { quantity: 3 } },
      { productId: "p1", productName: "Old name", _sum: { quantity: 2 } },
      { productId: "p3", productName: "Other", _sum: { quantity: 5 } },
    ]);
    Product.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: "p1", categoryId: "c1", categoryName: "Category 1" },
        { _id: "p2", categoryId: "c1", categoryName: "Category 1" },
        { _id: "p3", categoryId: "c2", categoryName: "Category 2" },
      ]),
    });

    const result = await orderAnalyticsRepository.getOverview(7);

    expect(result.topProducts[0]).toEqual({
      id: "p1",
      name: "New name",
      quantity: 6,
    });
    expect(result.topProductsByCategory[0]).toEqual({
      id: "c1",
      name: "Category 1",
      products: [
        { id: "p1", name: "New name", quantity: 6 },
        { id: "p2", name: "Second", quantity: 3 },
      ],
    });
    vi.useRealTimers();
  });

  it("only accepts supported reporting periods", () => {
    expect(orderSchema.adminAnalytics.parse({ query: {} }).query.days).toBe(7);
    expect(orderSchema.adminAnalytics.parse({ query: { days: "90" } }).query.days).toBe(90);
    expect(() =>
      orderSchema.adminAnalytics.parse({ query: { days: "365" } }),
    ).toThrow();
    vi.useRealTimers();
  });
});
