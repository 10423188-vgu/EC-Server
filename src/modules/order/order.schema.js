import { z } from "zod";
import {
  MAX_ADMIN_ORDER_OFFSET,
  MAX_SELECTED_ORDER_EXPORT,
} from "./order.policy.js";

const uuidParam = z.string().uuid("Invalid ID");
const orderStatus = z.enum([
  "PENDING",
  "AWAITING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);
const paymentStatus = z.enum([
  "PENDING",
  "COMPLETED",
  "PARTIALLY_REFUNDED",
  "FAILED",
  "REFUNDED",
]);
const dateFrom = z
  .string()
  .date()
  .transform((value) => new Date(`${value}T00:00:00.000Z`));
const dateTo = z
  .string()
  .date()
  .transform((value) => new Date(`${value}T23:59:59.999Z`));
const positiveIntegerQuery = (defaultValue) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^\d+$/, "Must be a positive integer")
      .transform(Number)
      .pipe(z.number().int().min(1))
      .optional()
      .default(defaultValue),
  );

const adminFilters = {
  status: orderStatus.optional(),
  paymentStatus: paymentStatus.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  dateFrom: dateFrom.optional(),
  dateTo: dateTo.optional(),
  overdue: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
};

const listFilters = {
  ...adminFilters,
  page: positiveIntegerQuery(1).pipe(z.number().max(2_147_483_647)),
  limit: positiveIntegerQuery(10).transform((value) => Math.min(value, 50)),
};
const adminListFilters = {
  ...listFilters,
  sortBy: z.enum(["customerName", "total"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
};

export const orderSchema = {
  adminExportSelected: z.object({
    body: z
      .object({
        ids: z
          .array(uuidParam)
          .min(1)
          .max(MAX_SELECTED_ORDER_EXPORT)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Duplicate order IDs",
          ),
      })
      .strict(),
  }),
  adminSelected: z.object({
    body: z.object({ ids: z.array(uuidParam).min(1).max(500) }),
  }),
  checkout: z.object({
    body: z.object({
      addressId: uuidParam,
      couponCode: z.string().min(1).max(50).toUpperCase().optional(),
      note: z.string().max(500).optional(),
    }),
  }),

  list: z.object({
    query: z
      .object(listFilters)
      .refine(
        ({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo,
        { message: "dateFrom must be before or equal to dateTo" },
      ),
  }),

  adminList: z.object({
    query: z
      .object(adminListFilters)
      .refine(
        ({ page, limit }) => (page - 1) * limit <= MAX_ADMIN_ORDER_OFFSET,
        {
          message:
            "Narrow your filters or export matching orders to browse more results",
        },
      )
      .refine(
        ({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo,
        { message: "dateFrom must be before or equal to dateTo" },
      ),
  }),

  getById: z.object({
    params: z.object({ id: uuidParam }),
  }),

  cancel: z.object({
    params: z.object({ id: uuidParam }),
  }),

  adminUpdateStatus: z.object({
    params: z.object({ id: uuidParam }),
    body: z.object({
      status: z.enum([
        "PAID",
        "PROCESSING",
        "SHIPPED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
      ]),
      reason: z.string().trim().min(3).max(500).optional(),
    }),
  }),
  adminCancel: z.object({
    params: z.object({ id: uuidParam }),
    body: z.object({
      reason: z.string().trim().min(3).max(500),
    }),
  }),
  adminRefund: z.object({
    params: z.object({ id: uuidParam }),
    body: z.object({
      amount: z.coerce.number().positive().multipleOf(0.01),
      reason: z.string().trim().min(3).max(500),
      transactionId: z.string().trim().min(3).max(100),
      returnRequestId: uuidParam.optional(),
    }),
  }),
  adminMetrics: z.object({
    query: z
      .object(adminFilters)
      .refine(
        ({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo,
        { message: "dateFrom must be before or equal to dateTo" },
      ),
  }),
  adminAnalytics: z.object({
    query: z.object({
      days: z.enum(["7", "14", "30", "90"]).default("7").transform(Number),
    }),
  }),
  adminExport: z.object({
    query: z
      .object(adminFilters)
      .refine(
        ({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo,
        { message: "dateFrom must be before or equal to dateTo" },
      ),
  }),
  adminUpdateShipping: z.object({
    params: z.object({ id: uuidParam }),
    body: z
      .object({
        shippingCarrier: z.string().trim().max(80).nullable(),
        trackingNumber: z.string().trim().max(100).nullable(),
        trackingUrl: z
          .string()
          .trim()
          .url()
          .max(2048)
          .refine((url) => /^https?:\/\//i.test(url), {
            message: "Tracking URL must use HTTP or HTTPS",
          })
          .nullable(),
      })
      .superRefine(
        ({ shippingCarrier, trackingNumber, trackingUrl }, context) => {
          if (Boolean(shippingCarrier) !== Boolean(trackingNumber)) {
            context.addIssue({
              code: "custom",
              path: ["trackingNumber"],
              message: "Carrier and tracking number must be provided together",
            });
          }
          if (trackingUrl && !trackingNumber) {
            context.addIssue({
              code: "custom",
              path: ["trackingUrl"],
              message: "A tracking number is required when a URL is provided",
            });
          }
        },
      ),
  }),
  adminGetById: z.object({
    params: z.object({ id: uuidParam }),
  }),
};
