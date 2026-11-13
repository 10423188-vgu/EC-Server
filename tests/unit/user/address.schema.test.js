import { describe, expect, it } from "vitest";
import { addressSchema } from "../../../src/modules/address/address.schema.js";

const address = {
  fullName: "Alex",
  phone: "+84123456789",
  street: "123 Road",
  ward: "Ward",
  district: "District",
  city: "City",
};

describe("country-aware address validation", () => {
  it.each([
    ["VN", "70000"],
    ["US", "10001-1234"],
    ["CA", "k1a 0b1"],
    ["GB", "SW1A 1AA"],
    ["AU", "2000"],
    ["SG", "238801"],
  ])("accepts supported %s postal formats", (countryCode, postalCode) => {
    expect(
      addressSchema.address.safeParse({
        body: { ...address, countryCode, postalCode },
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid postal code at the postalCode field", () => {
    const parsed = addressSchema.address.safeParse({
      body: { ...address, countryCode: "VN", postalCode: "700000" },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].path).toEqual(["body", "postalCode"]);
  });

  it("accepts existing nullable postal codes and defaults the country", () => {
    expect(
      addressSchema.address.parse({ body: { ...address, postalCode: null } })
        .body,
    ).toMatchObject({ countryCode: "VN", postalCode: null });
  });

  it("does not require ward/district for international addresses", () => {
    const { ward, district, ...international } = address;
    expect(
      addressSchema.address.safeParse({
        body: { ...international, countryCode: "US", postalCode: "10001" },
      }).success,
    ).toBe(true);
    expect(
      addressSchema.address.safeParse({ body: international }).success,
    ).toBe(false);
  });
});
