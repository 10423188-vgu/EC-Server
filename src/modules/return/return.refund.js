const cents = (amount) => Math.round(Number(amount) * 100);

const cumulativeItemRefund = (lineCents, orderedQuantity, returnedQuantity) =>
  Math.floor((lineCents * returnedQuantity) / orderedQuantity);

export const calculateReturnRefund = (order, items, previousReturns) => {
  const orderedItems = [...order.items].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const subtotalCents = orderedItems.reduce(
    (sum, item) => sum + cents(item.subtotal),
    0,
  );
  const discountCents = Math.min(
    Math.max(cents(order.discountAmount ?? 0), 0),
    subtotalCents,
  );
  const returnedByItem = new Map();
  for (const previous of previousReturns) {
    for (const item of previous.items) {
      returnedByItem.set(
        item.orderItemId,
        (returnedByItem.get(item.orderItemId) ?? 0) + item.quantity,
      );
    }
  }
  const requestedByItem = new Map(
    items.map((item) => [item.orderItemId, item.quantity]),
  );
  let allocatedDiscount = 0;
  let refundCents = 0;
  for (const [index, item] of orderedItems.entries()) {
    const lineCents = cents(item.subtotal);
    const discountShare =
      index === orderedItems.length - 1
        ? discountCents - allocatedDiscount
        : subtotalCents > 0
          ? Math.floor((discountCents * lineCents) / subtotalCents)
          : 0;
    allocatedDiscount += discountShare;
    const netCents = lineCents - discountShare;
    const previouslyReturned = returnedByItem.get(item.id) ?? 0;
    const nowReturned = requestedByItem.get(item.id) ?? 0;
    refundCents +=
      cumulativeItemRefund(
        netCents,
        item.quantity,
        previouslyReturned + nowReturned,
      ) - cumulativeItemRefund(netCents, item.quantity, previouslyReturned);
  }
  const allItemsReturned = orderedItems.every(
    (item) =>
      (returnedByItem.get(item.id) ?? 0) +
        (requestedByItem.get(item.id) ?? 0) ===
      item.quantity,
  );
  if (allItemsReturned) refundCents += cents(order.shippingFee ?? 0);
  return refundCents / 100;
};
