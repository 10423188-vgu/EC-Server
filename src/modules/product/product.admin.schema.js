import { z } from "zod";

export const productOverviewSchema = z.object({
  query: z.object({
    days: z.enum(["7", "14", "30", "90"]).default("14").transform(Number),
  }),
});

export const adminProductsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    search: z.string().trim().max(100).optional(),
    categorySlug: z.string().max(100).optional(),
    brandSlug: z.string().max(100).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    trash: z.enum(["true", "false"]).default("false"),
    stock: z.enum(["out", "low"]).optional(),
    sortBy: z
      .enum(["name", "stock", "price", "updatedAt"])
      .default("updatedAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
});

const productIds = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Product IDs must be unique",
  );
export const productBulkSchema = z.object({
  body: z
    .object({
      ids: productIds,
      action: z.enum(["activate", "deactivate", "trash", "restore"]),
    })
    .strict(),
});
export const productExportSchema = z.object({
  query: adminProductsSchema.shape.query.omit({ page: true, limit: true }),
  body: z.object({ ids: productIds.optional() }).strict(),
});
export const productHistorySchema = z.object({
  params: z.object({ id: z.uuid() }),
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
});
