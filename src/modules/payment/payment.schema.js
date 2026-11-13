import { z } from "zod";

const uuidParam = z.string().uuid("Invalid ID");

export const paymentSchema = {
  confirm: z.object({
    params: z.object({ orderId: uuidParam }),
  }),
};
