import { z } from "zod";

export const wishlistSchema = {
  preferences: z.object({
    body: z.object({ saleAlerts: z.boolean() }).strict(),
  }),
  shared: z.object({
    params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
    query: z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    }),
  }),
  list: z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    }),
  }),
  ids: z.object({
    query: z.object({
      productIds: z.string().transform((value) => value.split(","))
        .pipe(z.array(z.string().uuid()).min(1).max(100)),
    }),
  }),
  toggleItem: z.object({
    params: z.object({
      productId: z.string().uuid("Invalid product ID"),
    }),
  }),
};
