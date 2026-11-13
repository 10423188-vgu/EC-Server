import { z } from "zod";

export const searchSchema = {
  search: z.object({
    query: z.object({
      q: z.string().optional().default(""),
      categorySlug: z.string().optional(),
      categorySlugs: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((v) => (v ? (Array.isArray(v) ? v : [v]) : undefined))
        .refine((v) => !v || v.length <= 50, { message: "Too many categorySlugs" }),
      brandSlug: z.string().optional(),
      tags: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((v) => (v ? (Array.isArray(v) ? v : [v]) : undefined))
        .refine((v) => !v || v.length <= 50, { message: "Too many tags" }),
      minPrice: z
        .string()
        .optional()
        .transform((v) => (v ? parseFloat(v) : undefined)),
      maxPrice: z
        .string()
        .optional()
        .transform((v) => (v ? parseFloat(v) : undefined)),
      minRating: z
        .string()
        .optional()
        .transform((v) => (v ? parseFloat(v) : undefined))
        .refine((v) => v === undefined || (v >= 1 && v <= 5), {
          message: "minRating must be 1-5",
        }),
      inStock: z
        .string()
        .optional()
        .transform((v) => (v === "true" ? true : undefined)),
      isFeatured: z
        .string()
        .optional()
        .transform((v) => (v === "true" ? true : undefined)),
      sort: z
        .enum(["relevance", "price_asc", "price_desc", "rating", "createdAt_desc", "createdAt_asc", "name_asc"])
        .optional()
        .default("relevance"),
      // why: caps how deep ES `from` (max_result_window: 50_000) and the Mongo
      // fallback's .skip() can go — the fallback has no limit of its own otherwise,
      // and it's exactly the path traffic falls back to when ES is unavailable
      page: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(200, Math.max(1, parseInt(v))) : 1)),
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(48, parseInt(v)) : 24)),
    }),
  }),

  suggest: z.object({
    query: z.object({
      q: z.string().min(1).max(100),
    }),
  }),
};
