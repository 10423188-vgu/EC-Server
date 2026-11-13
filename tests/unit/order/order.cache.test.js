import { describe, expect, it, vi } from "vitest";
import { invalidateOrderViews } from "../../../../client/src/entities/order/api/order.cache.js";

describe("order cache invalidation", () => {
  it("invalidates matching lists/metrics and only the changed order's details", async () => {
    const client = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await invalidateOrderViews(client, "changed-order");
    expect(
      client.invalidateQueries.mock.calls.map(([filter]) => filter.queryKey),
    ).toEqual([
      ["orders", "list"],
      ["orders", "admin", "list"],
      ["orders", "admin", "metrics"],
      ["orders", "admin", "analytics"],
      ["orders", "changed-order"],
      ["orders", "admin", "detail", "changed-order"],
    ]);
  });
  it("leaves financial reports valid for return-review changes", async () => {
    const client = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await invalidateOrderViews(client, "changed-order", { metrics: false });
    expect(
      client.invalidateQueries.mock.calls.some(([filter]) =>
        ["metrics", "analytics"].some((key) => filter.queryKey.includes(key)),
      ),
    ).toBe(false);
  });
});
