import { z } from "zod";

export const categorySchema = {
  getCategories: z.object({
    query: z.object({
      includeChildren: z
        .string()
        .optional()
        .transform((v) => v === "true"),
      limit: z.string().optional(),
    }),
  }),

  getCategoryBySlug: z.object({
    params: z.object({ slug: z.string().min(1) }),
  }),

  getCategoryById: z.object({
    params: z.object({ id: z.string().uuid("Invalid category ID") }),
  }),

  createCategory: z.object({
    body: z.object({
      name: z.string().min(2, "Name must be at least 2 characters"),
      slug: z
        .string()
        .min(2)
        .regex(
          /^[a-z0-9-]+$/,
          "Slug must contain only lowercase letters, numbers and hyphens",
        ),
      description: z.string().nullable().optional(),
      imageUrl: z.string().url("Invalid image URL").nullable().optional(),
      videoUrl: z.string().url("Invalid video URL").nullable().optional(),
      parentId: z.string().uuid("Invalid parent ID").nullable().optional(),
      isActive: z.boolean().optional().default(true),
    }),
  }),

  updateCategory: z.object({
    params: z.object({ id: z.string().uuid("Invalid category ID") }),
    body: z.object({
      name: z.string().min(2).optional(),
      slug: z
        .string()
        .min(2)
        .regex(/^[a-z0-9-]+$/)
        .optional(),
      description: z.string().nullable().optional(),
      imageUrl: z.string().url().nullable().optional(),
      videoUrl: z.string().url().nullable().optional(),
      parentId: z.string().uuid().nullable().optional(),
      isActive: z.boolean().optional(),
    }),
  }),

  deleteCategory: z.object({
    params: z.object({ id: z.string().uuid("Invalid category ID") }),
  }),
};
