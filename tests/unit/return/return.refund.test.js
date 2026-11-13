import { describe, expect, it } from "vitest";
import { calculateReturnRefund } from "../../../src/modules/return/return.refund.js";

const order = {
  items: [
    { id: "a", quantity: 2, subtotal: 100 },
    { id: "b", quantity: 1, subtotal: 50 },
  ],
  discountAmount: 30,
  shippingFee: 10,
};

describe("calculateReturnRefund", () => {
  it("allocates discounts by item and withholds shipping on partial returns", () => {
    expect(
      calculateReturnRefund(order, [{ orderItemId: "a", quantity: 1 }], []),
    ).toBe(40);
  });

  it("refunds the remaining items and shipping only on the final return", () => {
    expect(
      calculateReturnRefund(
        order,
        [
          { orderItemId: "a", quantity: 1 },
          { orderItemId: "b", quantity: 1 },
        ],
        [{ items: [{ orderItemId: "a", quantity: 1 }] }],
      ),
    ).toBe(90);
  });

  it("does not lose cents across repeated partial returns", () => {
    const smallOrder = {
      items: [{ id: "a", quantity: 3, subtotal: 0.1 }],
      discountAmount: 0,
      shippingFee: 0,
    };
    const first = calculateReturnRefund(
      smallOrder,
      [{ orderItemId: "a", quantity: 1 }],
      [],
    );
    const last = calculateReturnRefund(
      smallOrder,
      [{ orderItemId: "a", quantity: 2 }],
      [{ items: [{ orderItemId: "a", quantity: 1 }] }],
    );
    expect(first + last).toBe(0.1);
  });
});
