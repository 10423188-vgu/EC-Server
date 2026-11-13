import { prisma } from "../../configs/db/index.js";

export const OUTBOX_MAX_ATTEMPTS = 5;

export const outboxRepository = {
  // why: tx is required (no default) — callers must enqueue inside the same Prisma transaction
  // as the source-of-truth write, so the event and that write commit or roll back together
  enqueue: async (tx, { eventType, payload, availableAt }) => {
    return tx.outboxEvent.create({ data: { eventType, payload, availableAt } });
  },

  findBatch: async (limit) => {
    return prisma.outboxEvent.findMany({
      where: {
        processedAt: null,
        attempts: { lt: OUTBOX_MAX_ATTEMPTS },
        availableAt: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  },

  markProcessed: async (id) => {
    return prisma.outboxEvent.update({ where: { id }, data: { processedAt: new Date() } });
  },

  markFailed: async (id, error) => {
    return prisma.outboxEvent.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: String(error?.message ?? error) },
    });
  },
};
