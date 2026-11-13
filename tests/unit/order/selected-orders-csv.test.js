import { describe, expect, it } from "vitest";
import {
  selectedOrdersCsvHeader,
  selectedOrderCsvRow,
} from "../../../src/modules/order/order.csv.js";

describe("selected order CSV", () => {
  it.each(["=HYPERLINK(1)", "+1", "-1", "@SUM(1)", "\t =1"])(
    "neutralizes formula-like customer names %s",
    (name) => {
      const csv = selectedOrderCsvRow({ id: "order-1", user: { name } });
      expect(csv).toContain(`"'${name}"`);
    },
  );

  it("preserves quotes, commas, Unicode and line breaks as CSV data", () => {
    const csv =
      selectedOrdersCsvHeader +
      selectedOrderCsvRow({
        id: "order-1",
        user: { name: 'Nguyễn, "An"\nTest' },
      });
    expect(csv).toContain('"Nguyễn, ""An""\nTest"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
