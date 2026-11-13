import { z } from "zod";

const uuidParam = z.string().uuid("Invalid ID");
const positiveDecimal = z.number().positive();

export const couponSchema = {
  validate: z.object({
    body: z.object({
      code: z.string().min(1).max(50).toUpperCase(),
    }),
  }),

  create: z.object({
    body: z.object({
      code: z
        .string()
        .min(3)
        .max(50)
        .regex(/^[A-Z0-9_-]+$/, "Code must be uppercase letters, numbers, _ or -")
        .toUpperCase(),
      name: z.string().min(2).max(100),
      description: z.string().max(500).optional(),

      type: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING"]),
      value: positiveDecimal,
      maxDiscount: positiveDecimal.optional(),

      minOrderAmount: positiveDecimal.optional(),

      scope: z.enum(["ALL", "CATEGORY", "PRODUCT", "BRAND"]).default("ALL"),
      scopeIds: z.array(z.string().uuid()).optional().default([]),

      usageLimit: z.number().int().positive().optional(),
      perUserLimit: z.number().int().min(1).default(1),

      startsAt: z.string().datetime().optional(),
      expiresAt: z.string().datetime().optional(),

      isActive: z.boolean().default(true),
    }).refine(
      (d) => {
        if (d.type === "PERCENTAGE" && d.value > 100) return false;
        return true;
      },
      { message: "Percentage value must be 0-100", path: ["value"] }
    ).refine(
      (d) => {
        if (d.scope !== "ALL" && !d.scopeIds?.length) return false;
        return true;
      },
      { message: "scopeIds required when scope is not ALL", path: ["scopeIds"] }
    ).refine(
      (d) => {
        if (d.startsAt && d.expiresAt && new Date(d.startsAt) >= new Date(d.expiresAt)) return false;
        return true;
      },
      { message: "expiresAt must be after startsAt", path: ["expiresAt"] }
    ),
  }),

  update: z.object({
    params: z.object({ id: uuidParam }),
    body: z.object({
      name: z.string().min(2).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
      value: positiveDecimal.optional(),
      maxDiscount: positiveDecimal.nullable().optional(),
      minOrderAmount: positiveDecimal.nullable().optional(),
      usageLimit: z.number().int().positive().nullable().optional(),
      perUserLimit: z.number().int().min(1).optional(),
      startsAt: z.string().datetime().nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      isActive: z.boolean().optional(),
    }),
  }),

  getById: z.object({
    params: z.object({ id: uuidParam }),
  }),

  deleteById: z.object({
    params: z.object({ id: uuidParam }),
  }),

  list: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((v) => (v ? Math.max(1, parseInt(v)) : 1)),
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(100, parseInt(v)) : 20)),
      isActive: z
        .string()
        .optional()
        .transform((v) =>
          v === "true" ? true : v === "false" ? false : undefined
        ),
      type: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING"]).optional(),
    }),
  }),
};
