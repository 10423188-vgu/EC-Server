export const ORDER_SLA_HOURS = {
  payment: 24,
  fulfillment: 48,
  delivery: 72,
};

export const buildOverdueOrderWhere = (now = new Date()) => ({
  OR: [
    {
      status: { in: ["PENDING", "AWAITING_PAYMENT"] },
      statusChangedAt: {
        lt: new Date(now.getTime() - ORDER_SLA_HOURS.payment * 60 * 60 * 1000),
      },
    },
    {
      status: { in: ["PAID", "PROCESSING"] },
      statusChangedAt: {
        lt: new Date(
          now.getTime() - ORDER_SLA_HOURS.fulfillment * 60 * 60 * 1000,
        ),
      },
    },
    {
      status: { in: ["SHIPPED", "OUT_FOR_DELIVERY"] },
      statusChangedAt: {
        lt: new Date(now.getTime() - ORDER_SLA_HOURS.delivery * 60 * 60 * 1000),
      },
    },
  ],
});
export const MAX_ADMIN_ORDER_OFFSET = 10000;
// why: 2,000 UUIDs fit the existing 100KB JSON body limit; larger exports use filters.
export const MAX_SELECTED_ORDER_EXPORT = 2000;
