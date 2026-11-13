import { z } from "zod";
import { isOwnCloudinaryUrl } from "../../shared/utils/cloudinary.util.js";
import { normalizePhone, PHONE_REGEX } from "../../shared/utils/phone.util.js";
import { TIER_NAMES } from "./user.service.js";
import { authSchema } from "../auth/auth.schema.js";

export const userSchema = {
  adminCreateCustomer: z.object({
    body: authSchema.register.shape.body.strict(),
  }),
  adminCustomerSuspension: z.object({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ suspended: z.boolean() }).strict(),
  }),
  adminCustomerDetails: z.object({
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
    }),
  }),
  twoFactorConfirm: z.object({
    body: z.object({
      secret: z.string().regex(/^[A-Z2-7]{20,64}$/i),
      code: z.string().regex(/^\d{6}$/),
    }),
  }),
  twoFactorDisable: z.object({
    body: z.object({ code: z.string().regex(/^(\d{6}|[A-F\d]{16})$/i) }),
  }),
  adminCustomers: z.object({
    query: z.object({
      page: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z
          .string()
          .regex(/^\d+$/)
          .transform(Number)
          .pipe(z.number().int().min(1))
          .optional()
          .default(1),
      ),
      limit: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z
          .string()
          .regex(/^\d+$/)
          .transform(Number)
          .pipe(z.number().int().min(1).max(50))
          .optional()
          .default(25),
      ),
      search: z.string().trim().min(1).max(100).optional(),
      status: z.enum(["active", "suspended"]).optional(),
      sortBy: z
        .enum(["name", "registered", "orders"])
        .optional()
        .default("registered"),
      sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    }),
  }),

  adminCustomerOverview: z.object({
    query: z.object({
      days: z.coerce
        .number()
        .int()
        .refine((value) => [7, 14, 30, 90].includes(value))
        .default(30),
    }),
  }),

  adminCustomerExport: z.object({
    query: z.object({
      search: z.string().trim().min(1).max(100).optional(),
      status: z.enum(["active", "suspended"]).optional(),
      sortBy: z
        .enum(["name", "registered", "orders"])
        .optional()
        .default("registered"),
      sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    }),
    body: z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(2000).optional(),
      })
      .strict(),
  }),

  updateProfile: z.object({
    body: z.object({
      name: z
        .string()
        .min(3, "Name must be at least 3 characters")
        .max(15, "Name cannot exceed 15 characters")
        .optional(),
      // why: an empty string means "clear the saved phone" (the column is nullable) —
      // only non-empty values need to pass the phone format check
      phone: z
        .string()
        .transform((value) =>
          value.trim() === "" ? null : normalizePhone(value),
        )
        .refine(
          (value) => value === null || PHONE_REGEX.test(value),
          "Enter a valid phone number (optionally starting with +)",
        )
        .optional(),
    }),
  }),

  requestEmailChange: z.object({
    body: z
      .object({
        email: z
          .string()
          .trim()
          .email("Please enter a valid email address")
          .transform((value) => value.toLowerCase()),
      })
      .strict(),
  }),

  updateReviewProfile: z.object({
    body: z
      .object({
        reviewDisplayName: z.string().trim().max(30).nullable().optional(),
        reviewAvatar: z
          .url()
          .nullable()
          .refine(
            (url) => url === null || isOwnCloudinaryUrl(url, "avatars"),
            "Review photo must be uploaded to this app's avatar folder",
          )
          .optional(),
      })
      .strict(),
  }),

  changePassword: z.object({
    body: z
      .object({
        oldPassword: z
          .string()
          .min(6, "Old password must be at least 6 characters"),
        newPassword: z
          .string()
          .min(6, "New password must be at least 6 characters"),
        confirmPassword: z
          .string()
          .min(6, "Confirm password must be at least 6 characters"),
      })
      .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      }),
  }),

  updateAvatar: z.object({
    body: z.object({
      url: z
        .string()
        .url("Invalid URL")
        .refine((url) => isOwnCloudinaryUrl(url, "avatars"), {
          message:
            "Avatar URL must be an image uploaded to this app's Cloudinary account",
        }),
    }),
  }),

  updateBanner: z.object({
    body: z.object({
      url: z
        .string()
        .url("Invalid URL")
        .refine((url) => isOwnCloudinaryUrl(url, "banners"), {
          message:
            "Banner URL must be an image uploaded to this app's Cloudinary account",
        }),
    }),
  }),

  setFrame: z.object({
    body: z.object({
      frame: z.enum(TIER_NAMES),
    }),
  }),
};
