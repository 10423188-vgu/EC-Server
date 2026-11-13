import { z } from "zod";

const variantImageSchema = z.object({
  url: z.string().url("Invalid image URL"),
  altText: z.string().nullable().optional(),
  position: z.number().int().min(0).default(0),
});

const variantSchema = z.object({
  sku: z.string().min(1, "SKU is required"),
  name: z.string().min(1, "Variant name is required"),
  price: z.number().positive("Price must be positive"),
  salePrice: z.number().positive().nullable().optional(),
  stock: z.number().int().min(0, "Stock cannot be negative").default(0),
  weight: z.number().positive().nullable().optional(),
  options: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
  images: z.array(variantImageSchema).max(12).optional(),
});

const imageSchema = z.object({
  url: z.string().url("Invalid image URL"),
  altText: z.string().nullable().optional(),
  position: z.number().int().min(0).default(0),
});

const attributeSchema = z.object({
  key: z.string().min(1, "Attribute key is required"),
  value: z.string().min(1, "Attribute value is required"),
});

// why: Product._id and variant._id are both generated via crypto.randomUUID() (product.model.js), not Mongo ObjectId
const mongoIdParam = z.string().uuid("Invalid ID");
const variantIdParam = z.string().uuid("Invalid ID");

export const productSchema = {
  getProducts: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((v) => Math.max(1, Math.min(1000, v ? parseInt(v) : 1))),
      limit: z
        .string()
        .optional()
        .transform((v) => Math.max(1, Math.min(100, v ? parseInt(v) : 12))),
      search: z.string().optional(),
      categorySlug: z.string().optional(),
      categorySlugs: z.union([z.string(), z.array(z.string())]).optional(),
      brandSlug: z.string().optional(),
      tagSlug: z.string().optional(),
      minPrice: z
        .string()
        .optional()
        .transform((v) => (v ? parseFloat(v) : undefined)),
      maxPrice: z
        .string()
        .optional()
        .transform((v) => (v ? parseFloat(v) : undefined)),
      isFeatured: z
        .string()
        .optional()
        .transform((v) =>
          v === "true" ? true : v === "false" ? false : undefined,
        ),
      onSale: z
        .string()
        .optional()
        .transform((v) =>
          v === "true" ? true : v === "false" ? false : undefined,
        ),
      sortBy: z
        .enum(["createdAt", "price", "name"])
        .optional()
        .default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    }),
  }),

  getProductById: z.object({
    params: z.object({ id: mongoIdParam }),
  }),

  createProduct: z.object({
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
      categoryId: z.string().uuid("Invalid category ID"),
      brandId: z.string().uuid("Invalid brand ID").nullable().optional(),
      isActive: z.boolean().optional().default(true),
      isFeatured: z.boolean().optional().default(false),
      variants: z
        .array(variantSchema)
        .min(1, "At least one variant is required")
        .refine(
          (variants) =>
            new Set(variants.map((variant) => variant.sku)).size ===
            variants.length,
          "SKU must be unique within the product",
        ),
      images: z.array(imageSchema).max(12).optional().default([]),
      attributes: z.array(attributeSchema).optional().default([]),
      tags: z.array(z.string()).optional().default([]),
    }),
  }),

  updateProduct: z.object({
    params: z.object({ id: mongoIdParam }),
    body: z.object({
      expectedRevision: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      name: z.string().min(2).optional(),
      slug: z
        .string()
        .min(2)
        .regex(/^[a-z0-9-]+$/)
        .optional(),
      description: z.string().nullable().optional(),
      categoryId: z.string().uuid().optional(),
      brandId: z.string().uuid().nullable().optional(),
      isActive: z.boolean().optional(),
      isFeatured: z.boolean().optional(),
      images: z.array(imageSchema).max(12).optional(),
      attributes: z.array(attributeSchema).optional(),
      tags: z.array(z.string()).optional(),
    }),
  }),

  deleteProduct: z.object({
    params: z.object({ id: mongoIdParam }),
  }),

  createVariant: z.object({
    params: z.object({ id: mongoIdParam }),
    body: variantSchema,
  }),

  updateVariant: z.object({
    params: z.object({ id: mongoIdParam, variantId: variantIdParam }),
    body: variantSchema
      .omit({ stock: true })
      .partial()
      .extend({
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  }),

  deleteVariant: z.object({
    params: z.object({ id: mongoIdParam, variantId: variantIdParam }),
  }),

  adjustStock: z.object({
    params: z.object({ id: mongoIdParam, variantId: variantIdParam }),
    body: z.object({
      requestId: z.string().uuid(),
      delta: z
        .number()
        .int()
        .min(-1000000)
        .max(1000000)
        .refine((value) => value !== 0, "Quantity must not be zero"),
      reason: z.string().trim().min(3).max(500),
    }),
  }),

  getRelatedProducts: z.object({
    params: z.object({ id: mongoIdParam }),
    query: z.object({
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(parseInt(v), 20) : 8)),
    }),
  }),
};
