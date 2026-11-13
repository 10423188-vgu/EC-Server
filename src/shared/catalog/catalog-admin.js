import { z } from "zod";
import { Product } from "../../models/product.model.js";

export const catalogListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    search: z.string().trim().max(100).default(""),
    status: z.enum(["active", "inactive"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  }),
});

export const listCatalogRecords = async (model, productField, query) => {
  const { page, limit, search, status, sortOrder } = query;
  const where = {
    ...(search && {
      OR: ["name", "slug"].map((field) => ({
        [field]: { contains: search, mode: "insensitive" },
      })),
    }),
    ...(status && { isActive: status === "active" }),
  };
  const [records, total] = await Promise.all([
    model.findMany({
      where,
      orderBy: [{ name: sortOrder }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      ...(productField === "categoryId" && {
        include: { _count: { select: { children: true } } },
      }),
    }),
    model.count({ where }),
  ]);
  // why: one aggregation for the entire page avoids a Mongo query per row;
  // include trashed products because they also prevent deleting this reference.
  const counts = records.length
    ? await Product.aggregate([
        { $match: { [productField]: { $in: records.map(({ id }) => id) } } },
        { $group: { _id: `$${productField}`, count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10000 })
    : [];
  const byId = new Map(counts.map(({ _id, count }) => [_id, count]));
  return {
    data: records.map(({ _count, ...record }) => ({
      ...record,
      productCount: byId.get(record.id) ?? 0,
      ...(productField === "categoryId" && { childCount: _count.children }),
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getCatalogOverview = async (model, productField) => {
  // why: aggregate product references once alongside the small catalog read;
  // overview totals must cover every record, independent of table pagination.
  const [records, counts] = await Promise.all([
    model.findMany({ select: { id: true, name: true, isActive: true } }),
    Product.aggregate([
      { $match: { [productField]: { $ne: null } } },
      { $group: { _id: `$${productField}`, count: { $sum: 1 } } },
    ]).option({ maxTimeMS: 10000 }),
  ]);
  const byId = new Map(counts.map(({ _id, count }) => [_id, count]));
  const active = records.filter((record) => record.isActive).length;
  const ranked = records.map(({ id, name }) => ({
    id,
    name,
    count: byId.get(id) ?? 0,
  }));
  return {
    total: records.length,
    active,
    inactive: records.length - active,
    empty: ranked.filter((record) => record.count === 0).length,
    top: ranked
      .filter((record) => record.count > 0)
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5),
  };
};
