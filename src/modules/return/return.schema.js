import { z } from "zod";
import { isOwnCloudinaryUrl } from "../../shared/utils/cloudinary.util.js";

const uuidParam = z.string().uuid("Invalid ID");

export const returnSchema = {
  create: z.object({
    params: z.object({ id: uuidParam }),
    body: z.object({
      reason: z.string().trim().min(3).max(500),
      customerNote: z.string().trim().max(1000).optional(),
      evidenceImages: z
        .array(
          z
            .string()
            .url()
            .refine((url) => isOwnCloudinaryUrl(url, "returns"), {
              message: "Evidence must be uploaded to this app",
            }),
        )
        .max(5)
        .default([]),
      items: z
        .array(
          z.object({
            orderItemId: uuidParam,
            quantity: z.coerce.number().int().positive(),
          }),
        )
        .min(1)
        .max(50),
    }),
  }),

  updateStatus: z.object({
    params: z.object({ returnId: uuidParam }),
    body: z
      .object({
        status: z.enum(["INSPECTING", "APPROVED", "REJECTED"]),
        inspectionResult: z.string().trim().min(3).max(1000).optional(),
        restockItemIds: z.array(uuidParam).max(50).default([]),
      })
      .superRefine((data, context) => {
        if (
          ["APPROVED", "REJECTED"].includes(data.status) &&
          !data.inspectionResult
        ) {
          context.addIssue({
            code: "custom",
            path: ["inspectionResult"],
            message: "Inspection result is required when resolving a return",
          });
        }
      }),
  }),
};
