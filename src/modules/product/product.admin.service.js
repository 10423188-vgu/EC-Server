import { Product } from "../../models/product.model.js";
import { prisma } from "../../configs/db/index.js";

export const summaryStages = [
  {
    $set: {
      activeVariants: {
        $filter: {
          input: "$variants",
          as: "variant",
          cond: {
            $and: [
              { $eq: ["$$variant.isActive", true] },
              { $eq: [{ $ifNull: ["$$variant.deletedAt", null] }, null] },
            ],
          },
        },
      },
    },
  },
  {
    $set: {
      stock: { $sum: "$activeVariants.stock" },
      price: { $min: "$activeVariants.price" },
      variantCount: {
        $size: {
          $filter: {
            input: "$variants",
            as: "variant",
            cond: { $eq: [{ $ifNull: ["$$variant.deletedAt", null] }, null] },
          },
        },
      },
    },
  },
];
const summaryProjection = {
  _id: 0,
  id: "$_id",
  name: 1,
  slug: 1,
  categoryName: 1,
  categorySlug: 1,
  brandName: 1,
  stock: 1,
  price: 1,
  variantCount: 1,
  isActive: 1,
  deletedAt: 1,
  deletedBy: 1,
  updatedAt: 1,
  image: { $arrayElemAt: ["$images.url", 0] },
};

const adminProductMatch = (query) => {
  const { search, status, trash, categorySlug, brandSlug } = query;
  const match = { deletedAt: trash === "true" ? { $ne: null } : null };
  if (status) match.isActive = status === "active";
  if (categorySlug) match.categorySlug = categorySlug;
  if (brandSlug) match.brandSlug = brandSlug;
  if (search) {
    const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match.$or = [
      { name: { $regex: pattern, $options: "i" } },
      { "variants.sku": { $regex: pattern, $options: "i" } },
    ];
  }
  return { $match: match };
};

export const adminProductPipeline = (query) => {
  const { stock } = query;
  return [
    adminProductMatch(query),
    ...summaryStages,
    ...(stock
      ? [{ $match: { stock: stock === "out" ? 0 : { $gt: 0, $lte: 5 } } }]
      : []),
  ];
};

export const listAdminProducts = async (query) => {
  const { page, limit, sortBy, sortOrder } = query;
  const computedSort = sortBy === "stock" || sortBy === "price";
  const sort = { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1, _id: 1 } };
  // why: metadata sorts paginate before reducing variants; counts do not need
  // summaries unless a stock filter depends on them. Sorting before $facet also
  // allows MongoDB to use an eligible index for metadata sorts.
  const [result] = await Product.aggregate([
    ...(query.stock ? adminProductPipeline(query) : [adminProductMatch(query)]),
    ...(!computedSort ? [sort] : []),
    {
      $facet: {
        data: [
          ...(computedSort
            ? [...(!query.stock ? summaryStages : []), sort]
            : []),
          { $skip: (page - 1) * limit },
          { $limit: limit },
          ...(!query.stock && !computedSort ? summaryStages : []),
          { $project: summaryProjection },
        ],
        count: [{ $count: "total" }],
      },
    },
  ]).option({ maxTimeMS: 10000 });
  const total = result.count[0]?.total ?? 0;
  return {
    data: result.data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getProductOverview = async ({ days = 14 } = {}) => {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const until = new Date(since.getTime() + days * 86400000);
  const paidStatuses = [
    "PAID",
    "PROCESSING",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "REFUNDED",
  ];
  const [catalog, selling, sales] = await Promise.all([
    Product.aggregate([
      { $match: { deletedAt: null } },
      {
        $facet: {
          distribution: [
            {
              $group: {
                _id: { name: "$categoryName", slug: "$categorySlug" },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 6 },
          ],
          outOfStock: [
            { $match: { isActive: true } },
            ...summaryStages,
            { $match: { stock: 0 } },
            { $sort: { updatedAt: -1, _id: 1 } },
            { $limit: 3 },
            { $project: summaryProjection },
          ],
        },
      },
    ]).option({ maxTimeMS: 10000 }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        order: {
          is: {
            status: { in: paidStatuses },
            createdAt: { gte: since, lt: until },
          },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 3,
    }),
    prisma.$queryRaw`
      SELECT TO_CHAR(o."createdAt", 'YYYY-MM-DD') AS day,
             SUM(i.subtotal)::float8 AS total
      FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
      WHERE o."createdAt" >= ${since}
        AND o."createdAt" < ${until}
        AND o.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REFUNDED')
      GROUP BY day ORDER BY day
    `,
  ]);
  const products = selling.length
    ? await Product.find(
        { _id: { $in: selling.map((item) => item.productId) } },
        { name: 1, slug: 1, images: { $slice: 1 } },
      ).lean()
    : [];
  const byId = new Map(products.map((product) => [product._id, product]));
  const byDay = new Map(sales.map((entry) => [entry.day, Number(entry.total)]));
  return {
    days,
    distribution: catalog[0].distribution.map((entry) => ({
      name: entry._id.name ?? "Uncategorized",
      slug: entry._id.slug,
      count: entry.count,
    })),
    outOfStock: catalog[0].outOfStock,
    topSelling: selling.map((entry) => ({
      id: entry.productId,
      name: byId.get(entry.productId)?.name ?? "Archived product",
      image: byId.get(entry.productId)?.images?.[0]?.url,
      quantity: entry._sum.quantity,
      sales: Number(entry._sum.subtotal),
    })),
    sales: Array.from({ length: days }, (_, index) => {
      const date = new Date(since.getTime() + index * 86400000);
      const day = date.toISOString().slice(0, 10);
      return { day, total: byDay.get(day) ?? 0 };
    }),
  };
};
