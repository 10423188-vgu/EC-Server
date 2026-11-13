import { outboxRepository, OUTBOX_MAX_ATTEMPTS } from "../shared/outbox/outbox.prisma.repository.js";
import { outboxHandlers } from "../shared/outbox/outbox.handlers.js";
import { logger } from "../shared/utils/logger.js";

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 20;

let running = false;
let pollTimer = null;

export const processEvent = async (event) => {
  const handler = outboxHandlers[event.eventType];
  if (!handler) {
    // why: an unknown eventType is a code/deploy mismatch, not a transient failure — retrying
    // it forever would never fix itself, so mark it processed and surface it loudly instead
    logger.error({ eventId: event.id, eventType: event.eventType }, "[Outbox] no handler registered for event type");
    await outboxRepository.markProcessed(event.id);
    return;
  }

  try {
    await handler(event.payload, { eventId: event.id });
    await outboxRepository.markProcessed(event.id);
  } catch (err) {
    await outboxRepository.markFailed(event.id, err);
    const attempt = event.attempts + 1;
    if (attempt >= OUTBOX_MAX_ATTEMPTS) {
      logger.error({ err, eventId: event.id, eventType: event.eventType, attempt }, "[Outbox] event exceeded max attempts — needs manual investigation");
    } else {
      logger.warn({ err, eventId: event.id, eventType: event.eventType, attempt }, "[Outbox] handler failed, will retry");
    }
  }
};

const poll = async () => {
  let batchIsFull = false;
  try {
    const events = await outboxRepository.findBatch(BATCH_SIZE);
    batchIsFull = events.length === BATCH_SIZE;
    for (const event of events) await processEvent(event);
  } catch (err) {
    logger.error({ err }, "[Outbox] poll failed");
  } finally {
    // why: a full batch means backlog remains; waiting two seconds after every
    // batch caps throughput even when the database and handlers are idle.
    if (running) pollTimer = setTimeout(poll, batchIsFull ? 0 : POLL_INTERVAL_MS);
  }
};

export const startOutboxWorker = () => {
  running = true;
  poll();
  logger.info("[Outbox] worker started");
};

export const stopOutboxWorker = async () => {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  logger.info("[Outbox] worker stopped");
};
