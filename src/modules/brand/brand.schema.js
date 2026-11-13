import { z } from "zod";

export const brandSchema = {
  getBrands: z.object({
    query: z.object({
      limit: z.string().optional(),
    }),
  }),

  getBrandBySlug: z.object({
    params: z.object({ slug: z.string().min(1) }),
  }),

  getBrandById: z.object({
    params: z.object({ id: z.string().uuid("Invalid brand ID") }),
  }),

  createBrand: z.object({
    body: z.object({
      name: z.string().min(2, "Name must be at least 2 characters"),
      slug: z
        .string()
        .min(2)
        .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers and hyphens"),
      logoUrl: z.string().url("Invalid logo URL").nullable().optional(),
      isActive: z.boolean().optional().default(true),
    }),
  }),

  updateBrand: z.object({
    params: z.object({ id: z.string().uuid("Invalid brand ID") }),
    body: z.object({
      name: z.string().min(2).optional(),
      slug: z
        .string()
        .min(2)
        .regex(/^[a-z0-9-]+$/)
        .optional(),
      logoUrl: z.string().url().nullable().optional(),
      isActive: z.boolean().optional(),
    }),
  }),

  deleteBrand: z.object({
    params: z.object({ id: z.string().uuid("Invalid brand ID") }),
  }),
};
