import { z } from "zod";
import { normalizePhone, PHONE_REGEX } from "../../shared/utils/phone.util.js";

const POSTAL_CODE_PATTERNS = {
  VN: /^\d{5}$/,
  US: /^\d{5}(?:-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/i,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  AU: /^\d{4}$/,
  SG: /^\d{6}$/,
};

const postalCodeSchema = z
  .string()
  .trim()
  .max(12)
  .nullish()
  .transform((value) => value?.toUpperCase() || null);

const validatePostalCode = (postalCode, countryCode) => {
  if (!postalCode) return true;
  return POSTAL_CODE_PATTERNS[countryCode]?.test(postalCode) ?? false;
};

export const addressSchema = {
  address: z.object({
    body: z
      .object({
        fullName: z.string().trim().min(1, "Full name is required").max(100),
        phone: z
          .string()
          .transform(normalizePhone)
          .refine(
            (phone) => PHONE_REGEX.test(phone),
            "Enter a valid phone number (optionally starting with +)",
          ),
        street: z.string().trim().min(1, "Street is required").max(300),
        ward: z.string().trim().max(100).optional().default(""),
        district: z.string().trim().max(100).optional().default(""),
        city: z.string().trim().min(1, "City is required").max(100),
        postalCode: postalCodeSchema,
        countryCode: z.enum(["VN", "US", "CA", "GB", "AU", "SG"]).default("VN"),
        isDefault: z.boolean().optional().default(false),
      })
      .superRefine((data, context) => {
        if (data.countryCode === "VN") {
          for (const field of ["ward", "district"]) {
            if (!data[field])
              context.addIssue({
                code: "custom",
                path: [field],
                message: `${field === "ward" ? "Ward" : "District"} is required`,
              });
          }
        }
        if (!validatePostalCode(data.postalCode, data.countryCode)) {
          context.addIssue({
            code: "custom",
            path: ["postalCode"],
            message: `Enter a valid postal code for ${data.countryCode}`,
          });
        }
      }),
  }),
};
