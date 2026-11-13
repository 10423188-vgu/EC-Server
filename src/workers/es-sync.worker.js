import { Product } from "../models/product.model.js";
import { syncProductsBatch } from "../shared/utils/es-sync.util.js";
import { logger } from "../shared/utils/logger.js";

let changeStream = null;
let pendingIds = new Set();
let flushTimer = null;
let inFlight = null;
let stopping = false;

// why: coalesce change-stream events for FLUSH_DELAY_MS before writing to ES — a
// category rename or stock-rollback bulkWrite fires one event per document, and without
// this, each one would trigger its own individual ES round-trip
const FLUSH_DELAY_MS = 300;
const RETRY_DELAY_MS = 2_000;
const MAX_BATCH_SIZE = 200;

const PIPELINE = [
  { $match: { operationType: { $in: ["insert", "update", "replace", "delete"] } } },
];

const flush = async () => {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (inFlight || !pendingIds.size) return inFlight;
  const ids = [...pendingIds];
  pendingIds = new Set();
  inFlight = syncProductsBatch(ids)
    .catch((err) => {
      // why: keep the whole batch for retry; bulk writes are idempotent, and a
      // partial ES failure must not silently lose the failed product IDs.
      ids.forEach((id) => pendingIds.add(id));
      logger.error({ err, count: ids.length }, "[ES worker] batch sync failed; retrying");
      return RETRY_DELAY_MS;
    })
    .then((delay) => {
      inFlight = null;
      if (!stopping && pendingIds.size) {
        flushTimer = setTimeout(flush, delay ?? FLUSH_DELAY_MS);
      }
    });
  return inFlight;
};

const scheduleFlush = () => {
  if (pendingIds.size >= MAX_BATCH_SIZE) {
    void flush();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
};

const handleChange = (event) => {
  pendingIds.add(String(event.documentKey._id));
  scheduleFlush();
};

export const startEsSyncWorker = async () => {
  stopping = false;
  try {
    // why: fullDocument not needed — syncProductsBatch re-fetches from MongoDB anyway
    changeStream = Product.watch(PIPELINE);
    changeStream.on("change", handleChange);
    changeStream.on("error", (err) =>
      logger.error({ err }, "[ES worker] change stream error")
    );
    logger.info("[ES worker] started — Product changes will auto-sync to Elasticsearch (batched)");
  } catch (err) {
    // why: Change Streams require a MongoDB replica set; standalone dev instances will fail here
    logger.warn({ err }, "[ES worker] could not start — ES sync disabled (replica set required)");
  }
};

export const stopEsSyncWorker = async () => {
  if (!changeStream) return;
  stopping = true;
  clearTimeout(flushTimer);
  await changeStream.close().catch(() => {});
  changeStream = null;
  await inFlight;
  if (pendingIds.size) {
    await flush();
  }
  logger.info("[ES worker] stopped");
};
