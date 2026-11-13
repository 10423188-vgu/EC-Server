import { afterEach, describe, expect, it, vi } from "vitest";
import { outboxRepository } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import { prisma } from "../../../src/configs/db/index.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { outboxEvent: { findMany: vi.fn().mockResolvedValue([]) } },
}));

afterEach(() => vi.useRealTimers());

describe("outbox scheduling", () => {
  it("only polls due events so a new checkout is not recovered while still running", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-14T06:00:00.000Z");
    vi.setSystemTime(now);
    await outboxRepository.findBatch(20);
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { processedAt: null, attempts: { lt: 5 }, availableAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
  });

  it("persists the recovery deadline in the caller's business transaction", async () => {
    const tx = { outboxEvent: { create: vi.fn() } };
    const event = {
      eventType: "order.checkout.recover",
      payload: { orderId: "order-1" },
      availableAt: new Date("2026-10-14T06:15:00.000Z"),
    };
    await outboxRepository.enqueue(tx, event);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({ data: event });
  });
});
