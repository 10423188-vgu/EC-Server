import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderPrismaRepository } from "../../../src/modules/order/order.prisma.repository.js";
import { buildOverdueOrderWhere } from "../../../src/modules/order/order.policy.js";
import { prisma } from "../../../src/configs/db/index.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    payment: { aggregate: vi.fn(), count: vi.fn() },
    orderItem: { aggregate: vi.fn() },
  },
}));

describe("orderPrismaRepository admin reporting", () => {
  it("omits return relations and unused payment amounts for CSV batches", async () => {
    prisma.order.findMany.mockResolvedValue([]);
    await orderPrismaRepository.findSelected(["first"], { forExport: true });
    const query = prisma.order.findMany.mock.calls[0][0];
    expect(query.select.returnRequests).toBe(false);
    expect(query.select.payment).toEqual({
      select: { method: true, status: true },
    });
    expect(query.select.items).toBeUndefined();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T06:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("loads fresh selected summaries in selection order without fetching item bodies", async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: "second", _count: { items: 3 } },
      { id: "first", _count: { items: 2 } },
    ]);
    const selected = await orderPrismaRepository.findSelected([
      "first",
      "second",
    ]);
    expect(selected).toEqual([
      { id: "first", itemsCount: 2 },
      { id: "second", itemsCount: 3 },
    ]);
    const query = prisma.order.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ id: { in: ["first", "second"] } });
    expect(query.select.items).toBeUndefined();
    expect(query.select.shippingStreet).toBeUndefined();
    expect(query.select.payment.select.confirmedByUser).toBeUndefined();
    expect(prisma.order.count).not.toHaveBeenCalled();
  });

  it.each([
    {
      sortBy: "customerName",
      sortOrder: "asc",
      orderBy: [
        { user: { name: "asc" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
    },
    {
      sortBy: "total",
      sortOrder: "desc",
      orderBy: [{ total: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    },
  ])(
    "sorts admin orders by $sortBy",
    async ({ sortBy, sortOrder, orderBy }) => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      await orderPrismaRepository.findAll({
        page: 1,
        limit: 10,
        sortBy,
        sortOrder,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy }),
      );
    },
  );

  it("combines search, statuses and dates in the list query", async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    const dateFrom = new Date("2026-09-01T00:00:00.000Z");
    const dateTo = new Date("2026-09-14T23:59:59.999Z");

    await orderPrismaRepository.findAll({
      page: 1,
      limit: 10,
      status: "DELIVERED",
      paymentStatus: "COMPLETED",
      search: "alex",
      dateFrom,
      dateTo,
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "DELIVERED",
          payment: { is: { status: "COMPLETED" } },
          createdAt: { gte: dateFrom, lte: dateTo },
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("adds SLA conditions to filtered overdue order lists", async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);

    await orderPrismaRepository.findAll({
      page: 1,
      limit: 10,
      status: "PROCESSING",
      overdue: true,
    });

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ status: "PROCESSING" }, buildOverdueOrderWhere()],
    });
  });

  it("uses cursor batches and preserves the active filters for CSV export", async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await orderPrismaRepository.findAdminExportBatch(
      { paymentStatus: "COMPLETED", search: "alex" },
      "cursor-order",
      500,
    );

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "cursor-order" },
        skip: 1,
        take: 500,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where: expect.objectContaining({
          payment: { is: { status: "COMPLETED" } },
          OR: expect.any(Array),
        }),
        select: expect.objectContaining({
          user: { select: { name: true, email: true } },
          _count: { select: { items: true } },
        }),
      }),
    );
  });

  it("calculates revenue, AOV and rates from unpaginated database data", async () => {
    prisma.order.groupBy.mockResolvedValue([
      { status: "DELIVERED", _count: { _all: 6 } },
      { status: "CANCELLED", _count: { _all: 2 } },
      { status: "REFUNDED", _count: { _all: 2 } },
    ]);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 800, refundedAmount: 150 },
      _count: { _all: 8 },
    });
    prisma.payment.count.mockResolvedValue(2);
    prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 20 } });
    prisma.order.count.mockResolvedValue(3);

    const metrics = await orderPrismaRepository.getAdminMetrics({});

    expect(metrics).toEqual(
      expect.objectContaining({
        totalOrders: 10,
        paidOrderCount: 8,
        paymentConversionRate: 80,
        collectedRevenue: 800,
        refundedAmount: 150,
        netRevenue: 650,
        averageOrderValue: 100,
        cancellationRate: 20,
        refundRate: 25,
        overdueOrderCount: 3,
        averageItems: 2,
        fulfillmentDistribution: {
          PROCESSING: 0,
          SHIPPED: 0,
          OUT_FOR_DELIVERY: 0,
          DELIVERED: 6,
        },
      }),
    );
  });
});
