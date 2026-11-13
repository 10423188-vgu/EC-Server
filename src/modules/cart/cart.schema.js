import { z } from "zod";

export const cartSchema = {
  addItem: z.object({
    body: z.object({
      variantId: z.string().uuid("Invalid variant ID"),
    }),
  }),

  upsertItem: z.object({
    body: z.object({
      variantId: z.string().uuid("Invalid variant ID"),
      quantity: z.number().int().min(0, "Quantity must be 0 or more"),
    }),
  }),

  removeItem: z.object({
    params: z.object({
      variantId: z.string().uuid("Invalid variant ID"),
    }),
  }),
};
