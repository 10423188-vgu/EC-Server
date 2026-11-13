import { z } from "zod";

export const notificationSchema = {
  list: z.object({
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

  markRead: z.object({
    params: z.object({ id: z.string().uuid("Invalid notification ID") }),
  }),
};
