export const RETURN_WINDOW_DAYS = 30;
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const getReturnEligibility = (order, now = new Date()) => {
  const deliveredAt = order.statusChangedAt;
  if (!deliveredAt) return { canRequestReturn: false, returnDeadlineAt: null };

  const returnDeadlineAt = new Date(
    new Date(deliveredAt).getTime() + RETURN_WINDOW_MS,
  );
  return {
    canRequestReturn: order.status === "DELIVERED" && now < returnDeadlineAt,
    returnDeadlineAt,
  };
};
