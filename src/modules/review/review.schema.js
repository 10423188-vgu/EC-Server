import { z } from "zod";

const uuidParam = z.string().uuid("Invalid ID");

const imageSchema = z.object({
  url: z.string().url("Invalid image URL"),
  altText: z.string().nullable().optional(),
});

export const reviewSchema = {
  getProductReviews: z.object({
    params: z.object({ productId: uuidParam }),
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((v) => (v ? Math.max(1, parseInt(v)) : 1)),
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(50, parseInt(v)) : 10)),
      sort: z
        .enum(["recent", "helpful", "highest", "lowest"])
        .optional()
        .default("helpful"),
      rating: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v) : undefined))
        .refine((v) => v === undefined || (v >= 1 && v <= 5), {
          message: "Rating filter must be 1-5",
        }),
    }),
  }),

  createReview: z.object({
    params: z.object({ productId: uuidParam }),
    body: z.object({
      rating: z.number().int().min(1).max(5),
      title: z.string().min(3).max(100),
      body: z.string().min(10).max(2000),
      images: z.array(imageSchema).max(5).optional().default([]),
    }),
  }),

  updateReview: z.object({
    params: z.object({ reviewId: uuidParam }),
    body: z.object({
      rating: z.number().int().min(1).max(5).optional(),
      title: z.string().min(3).max(100).optional(),
      body: z.string().min(10).max(2000).optional(),
      images: z.array(imageSchema).max(5).optional(),
    }),
  }),

  deleteReview: z.object({
    params: z.object({ reviewId: uuidParam }),
  }),

  voteHelpful: z.object({
    params: z.object({ reviewId: uuidParam }),
    body: z.object({
      vote: z.enum(["helpful", "not_helpful", "remove"]),
    }),
  }),

  adminResponse: z.object({
    params: z.object({ reviewId: uuidParam }),
    body: z.object({
      body: z.string().min(1).max(1000),
    }),
  }),

  updateStatus: z.object({
    params: z.object({ reviewId: uuidParam }),
    body: z.object({
      status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    }),
  }),

  getMyReviews: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((v) => (v ? Math.max(1, parseInt(v)) : 1)),
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(50, parseInt(v)) : 10)),
    }),
  }),

  adminListReviews: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((v) => (v ? Math.max(1, parseInt(v)) : 1)),
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? Math.min(100, parseInt(v)) : 20)),
      status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
      productId: uuidParam.optional(),
      userId: uuidParam.optional(),
    }),
  }),
};
