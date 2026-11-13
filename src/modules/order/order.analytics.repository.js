import { prisma } from "../../configs/db/index.js";
import { Product } from "../../models/product.model.js";

const PAID_STATUSES = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];

const dayKey = (date) => date.toISOString().slice(0, 10);

export const orderAnalyticsRepository = {
  getOverview: async (days) => {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    // why: database grouping returns at most one row per day instead of loading
    // every payment and refund into the server process.
    const [
      salesDays,
      refundDays,
      statusGroups,
      paidOrders,
      countrySales,
      soldItems,
      recent,
    ] = await Promise.all([
        prisma.$queryRaw`
          SELECT TO_CHAR("paidAt", 'YYYY-MM-DD') AS day,
                 SUM(amount) AS total
          FROM "Payment"
          WHERE "paidAt" >= ${start} AND "paidAt" < ${end}
            AND status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
          GROUP BY 1
          ORDER BY 1
        `,
        prisma.$queryRaw`
          SELECT TO_CHAR("processedAt", 'YYYY-MM-DD') AS day,
                 SUM(amount) AS total
          FROM "Refund"
          WHERE "processedAt" >= ${start} AND "processedAt" < ${end}
            AND status::text = 'COMPLETED'
          GROUP BY 1
          ORDER BY 1
        `,
        prisma.order.groupBy({
          by: ["status"],
          where: { createdAt: { gte: start, lt: end } },
          _count: { _all: true },
        }),
        prisma.payment.count({
          where: {
            paidAt: { gte: start, lt: end },
            status: { in: PAID_STATUSES },
          },
        }),
        prisma.$queryRaw`
          SELECT o."shippingCountryCode" AS country_code,
                 SUM(p.amount) AS total,
                 COUNT(*)::int AS orders
          FROM "Payment" p
          JOIN "Order" o ON o.id = p."orderId"
          WHERE p."paidAt" >= ${start} AND p."paidAt" < ${end}
            AND p.status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND o."shippingCountryCode" IS NOT NULL
          GROUP BY o."shippingCountryCode"
          ORDER BY SUM(p.amount) DESC
        `,
        prisma.orderItem.groupBy({
          by: ["productId", "productName"],
          where: {
            order: {
              payment: {
                is: {
                  paidAt: { gte: start, lt: end },
                  status: { in: PAID_STATUSES },
                },
              },
            },
          },
          _sum: { quantity: true, subtotal: true },
          orderBy: { _sum: { quantity: "desc" } },
        }),
        prisma.payment.findMany({
          where: {
            paidAt: { gte: start, lt: end },
            status: { in: PAID_STATUSES },
          },
          orderBy: { paidAt: "desc" },
          take: 5,
          select: {
            amount: true,
            paidAt: true,
            order: {
              select: {
                id: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        }),
      ]);

    const productTotals = new Map();
    const productSales = new Map();
    for (const item of soldItems) {
      productSales.set(
        item.productId,
        (productSales.get(item.productId) ?? 0) +
          Number(item._sum.subtotal ?? 0),
      );
      const product = productTotals.get(item.productId) ?? {
        id: item.productId,
        name: item.productName,
        quantity: 0,
      };
      product.quantity += item._sum.quantity ?? 0;
      productTotals.set(item.productId, product);
    }
    const rankedProducts = [...productTotals.values()].sort(
      (a, b) => b.quantity - a.quantity,
    );
    const productIds = [...productTotals.keys()];
    const cardIds = rankedProducts.slice(0, 4).map((product) => product.id);
    const cardProjection = {
      categoryId: 1,
      categoryName: 1,
      images: { $slice: 1 },
      variants: { $slice: 1 },
      reviewStats: 1,
    };
    // why: category totals need every sold product, but images, variants and ratings
    // are needed only for four cards. Keep one query for small result sets.
    const [products, cardProducts] =
      productIds.length === 0
        ? [[], []]
        : productIds.length <= 4
          ? [
              await Product.find(
                { _id: { $in: productIds } },
                cardProjection,
              ).lean(),
              null,
            ]
          : await Promise.all([
              Product.find(
                { _id: { $in: productIds } },
                { categoryId: 1, categoryName: 1 },
              ).lean(),
              Product.find({ _id: { $in: cardIds } }, cardProjection).lean(),
            ]);
    const categoryByProduct = new Map(
      products.map((product) => [String(product._id), product]),
    );
    const cardDetailsByProduct = new Map(
      (cardProducts ?? products).map((product) => [String(product._id), product]),
    );
    const categoryTotals = new Map();
    for (const item of rankedProducts) {
      const product = categoryByProduct.get(item.id);
      const id = product?.categoryId ?? "uncategorized";
      const name = product?.categoryName ?? "Uncategorized";
      const category = categoryTotals.get(id) ?? {
        id,
        name,
        quantity: 0,
        products: [],
      };
      category.quantity += item.quantity;
      category.products.push(item);
      categoryTotals.set(id, category);
    }
    const rankedCategories = [...categoryTotals.values()].sort(
      (a, b) => b.quantity - a.quantity,
    );
    const categoryBreakdown = rankedCategories.slice(0, 4).map(
      ({ id, name, quantity }) => ({ id, name, quantity }),
    );
    if (rankedCategories.length > 4) {
      categoryBreakdown.push({
        id: "other",
        name: "Other",
        quantity: rankedCategories
          .slice(4)
          .reduce((sum, category) => sum + category.quantity, 0),
      });
    }

    const salesByDay = new Map(salesDays.map((row) => [row.day, Number(row.total)]));
    const refundsByDay = new Map(
      refundDays.map((row) => [row.day, Number(row.total)]),
    );
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const day = dayKey(date);
      const collected = salesByDay.get(day) ?? 0;
      const refunded = refundsByDay.get(day) ?? 0;
      return { day, collected, refunded, net: collected - refunded };
    });
    const collectedRevenue = daily.reduce((sum, day) => sum + day.collected, 0);
    const refundedAmount = daily.reduce((sum, day) => sum + day.refunded, 0);

    return {
      period: { days, from: dayKey(start), to: dayKey(new Date(end.getTime() - 1)) },
      summary: {
        collectedRevenue,
        refundedAmount,
        netRevenue: collectedRevenue - refundedAmount,
        totalOrders: statusGroups.reduce((sum, row) => sum + row._count._all, 0),
        paidOrders,
        averageOrderValue: paidOrders ? collectedRevenue / paidOrders : 0,
      },
      daily,
      countrySales: countrySales.map((row) => ({
        countryCode: row.country_code,
        revenue: Number(row.total),
        orders: row.orders,
      })),
      statusCounts: Object.fromEntries(
        statusGroups.map((row) => [row.status, row._count._all]),
      ),
      topProducts: rankedProducts.slice(0, 5),
      topProductCards: rankedProducts.slice(0, 4).map((product) => {
        const details = cardDetailsByProduct.get(product.id)
        const variant = details?.variants?.[0]
        return {
          ...product,
          sales: productSales.get(product.id) ?? 0,
          image: details?.images?.[0]?.url ?? null,
          price: variant?.price ?? null,
          salePrice: variant?.salePrice ?? null,
          rating: details?.reviewStats?.average ?? 0,
        }
      }),
      topProductsByCategory: rankedCategories.map(({ id, name, products }) => ({
        id,
        name,
        products,
      })),
      categoryBreakdown,
      recentSales: recent.map((payment) => ({
        orderId: payment.order.id,
        customer: payment.order.user.name || payment.order.user.email,
        amount: Number(payment.amount),
        paidAt: payment.paidAt,
      })),
    };
  },
};
