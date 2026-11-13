import { describe, it, expect, vi, beforeEach } from "vitest";
import { processEvent } from "../../../src/workers/outbox.worker.js";
import { outboxRepository, OUTBOX_MAX_ATTEMPTS } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import { outboxHandlers } from "../../../src/shared/outbox/outbox.handlers.js";

vi.mock("../../../src/shared/outbox/outbox.prisma.repository.js", () => ({
  OUTBOX_MAX_ATTEMPTS: 5,
  outboxRepository: {
    markProcessed: vi.fn(),
    markFailed: vi.fn(),
  },
}));

vi.mock("../../../src/shared/outbox/outbox.handlers.js", () => ({
  outboxHandlers: {
    "brand.renamed": vi.fn(),
    "order.status.changed": vi.fn(),
    "return.status.changed": vi.fn(),
  },
}));

vi.mock("../../../src/shared/utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("outbox.worker processEvent", () => {
  it("runs the matching handler and marks the event processed on success", async () => {
    outboxHandlers["brand.renamed"].mockResolvedValue(undefined);
    const event = { id: "e1", eventType: "brand.renamed", payload: { brandId: "b1", name: "New" }, attempts: 0 };

    await processEvent(event);

    expect(outboxHandlers["brand.renamed"]).toHaveBeenCalledWith(event.payload, { eventId: "e1" });
    expect(outboxRepository.markProcessed).toHaveBeenCalledWith("e1");
    expect(outboxRepository.markFailed).not.toHaveBeenCalled();
  });

  it("runs the order status change handler and marks the event processed on success", async () => {
    outboxHandlers["order.status.changed"].mockResolvedValue(undefined);
    const event = { id: "e2", eventType: "order.status.changed", payload: { orderId: "o1", userId: "u1", status: "SHIPPED" }, attempts: 0 };

    await processEvent(event);

    expect(outboxHandlers["order.status.changed"]).toHaveBeenCalledWith(event.payload, { eventId: "e2" });
    expect(outboxRepository.markProcessed).toHaveBeenCalledWith("e2");
    expect(outboxRepository.markFailed).not.toHaveBeenCalled();
  });

  it("runs the return status notification handler and marks the event processed", async () => {
    outboxHandlers["return.status.changed"].mockResolvedValue(undefined);
    const event = {
      id: "e6",
      eventType: "return.status.changed",
      payload: { returnId: "r1", orderId: "o1", userId: "u1", status: "APPROVED" },
      attempts: 0,
    };

    await processEvent(event);

    expect(outboxHandlers["return.status.changed"]).toHaveBeenCalledWith(
      event.payload,
      { eventId: "e6" },
    );
    expect(outboxRepository.markProcessed).toHaveBeenCalledWith("e6");
    expect(outboxRepository.markFailed).not.toHaveBeenCalled();
  });

  it("marks the event failed (not processed) when the handler throws, so it can retry", async () => {
    const err = new Error("Mongo unreachable");
    outboxHandlers["brand.renamed"].mockRejectedValue(err);
    const event = { id: "e3", eventType: "brand.renamed", payload: { brandId: "b1" }, attempts: 1 };

    await processEvent(event);

    expect(outboxRepository.markFailed).toHaveBeenCalledWith("e3", err);
    expect(outboxRepository.markProcessed).not.toHaveBeenCalled();
  });

  it("marks an event with no registered handler as processed instead of retrying forever", async () => {
    const event = { id: "e4", eventType: "unknown.event", payload: {}, attempts: 0 };

    await processEvent(event);

    expect(outboxRepository.markProcessed).toHaveBeenCalledWith("e4");
    expect(outboxRepository.markFailed).not.toHaveBeenCalled();
  });

  it("still retries on the attempt that reaches OUTBOX_MAX_ATTEMPTS — the repository query excludes it next poll", async () => {
    const err = new Error("still failing");
    outboxHandlers["brand.renamed"].mockRejectedValue(err);
    const event = { id: "e5", eventType: "brand.renamed", payload: {}, attempts: OUTBOX_MAX_ATTEMPTS - 1 };

    await processEvent(event);

    expect(outboxRepository.markFailed).toHaveBeenCalledWith("e5", err);
  });
});
