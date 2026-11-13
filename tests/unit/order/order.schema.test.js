import { describe, expect, it } from "vitest";
import { orderSchema } from "../../../src/modules/order/order.schema.js";

const parseListQuery = (query) => orderSchema.list.shape.query.safeParse(query);
const parseAdminListQuery = (query) =>
  orderSchema.adminList.shape.query.safeParse(query);

describe("orderSchema.list pagination", () => {
  it("uses defaults for missing or empty pagination values", () => {
    expect(parseListQuery({}).data).toMatchObject({ page: 1, limit: 10 });
    expect(parseListQuery({ page: "", limit: "" }).data).toMatchObject({
      page: 1,
      limit: 10,
    });
  });

  it("accepts positive integers and caps the page size at 50", () => {
    expect(parseListQuery({ page: "3", limit: "25" }).data).toMatchObject({
      page: 3,
      limit: 25,
    });
    expect(parseListQuery({ page: "3", limit: "500" }).data).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it.each(["0", "-1", "1.5", "2abc", "abc"])(
    "rejects invalid pagination value %s",
    (value) => {
      expect(parseListQuery({ page: value }).success).toBe(false);
      expect(parseListQuery({ limit: value }).success).toBe(false);
    },
  );
});

describe("orderSchema.adminList sorting", () => {
  it("bounds deep admin offsets without limiting CSV filters or customer pages", () => {
    expect(parseAdminListQuery({ page: "1001", limit: "10" }).success).toBe(
      true,
    );
    expect(parseAdminListQuery({ page: "1002", limit: "10" }).success).toBe(
      false,
    );
    expect(parseAdminListQuery({ page: "202", limit: "50" }).success).toBe(
      false,
    );
    expect(parseListQuery({ page: "1002", limit: "10" }).success).toBe(true);
    expect(orderSchema.adminExport.shape.query.safeParse({}).success).toBe(
      true,
    );
  });
  it("bounds selected export IDs and rejects duplicates", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const parse = (ids) =>
      orderSchema.adminExportSelected.shape.body.safeParse({ ids });
    expect(parse([id]).success).toBe(true);
    expect(parse([]).success).toBe(false);
    expect(parse([id, id]).success).toBe(false);
    const ids = Array.from(
      { length: 2001 },
      (_, index) =>
        `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
    );
    expect(parse(ids.slice(0, 2000)).success).toBe(true);
    expect(parse(ids).success).toBe(false);
  });
  it.each([
    { sortBy: "customerName", sortOrder: "asc" },
    { sortBy: "total", sortOrder: "desc" },
  ])("accepts supported sorting: %o", (sorting) => {
    expect(parseAdminListQuery(sorting).success).toBe(true);
  });

  it.each([
    { sortBy: "email", sortOrder: "asc" },
    { sortBy: "total", sortOrder: "random" },
  ])("rejects unsupported sorting: %o", (sorting) => {
    expect(parseAdminListQuery(sorting).success).toBe(false);
  });
});

describe("orderSchema admin shipping and filters", () => {
  const orderId = "123e4567-e89b-42d3-a456-426614174000";

  it("accepts complete carrier information and clearing all tracking fields", () => {
    const parse = (body) =>
      orderSchema.adminUpdateShipping.shape.body.safeParse(body);

    expect(
      parse({
        shippingCarrier: "Carrier",
        trackingNumber: "AB-123",
        trackingUrl: "https://carrier.example/AB-123",
      }).success,
    ).toBe(true);
    expect(
      parse({
        shippingCarrier: null,
        trackingNumber: null,
        trackingUrl: null,
      }).success,
    ).toBe(true);
    expect(
      orderSchema.adminMetrics.shape.query.safeParse({ overdue: "true" }).data
        .overdue,
    ).toBe(true);
  });

  it.each([
    { shippingCarrier: "Carrier", trackingNumber: null, trackingUrl: null },
    { shippingCarrier: null, trackingNumber: "AB-123", trackingUrl: null },
    {
      shippingCarrier: null,
      trackingNumber: null,
      trackingUrl: "javascript:alert(1)",
    },
  ])("rejects incomplete or unsafe shipping data: %o", (body) => {
    expect(
      orderSchema.adminUpdateShipping.safeParse({
        params: { id: orderId },
        body,
      }).success,
    ).toBe(false);
  });
});
