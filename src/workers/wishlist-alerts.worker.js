import { ProductChange } from "../models/product-change.model.js";
import { prisma } from "../configs/db/index.js";
import { logger } from "../shared/utils/logger.js";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 20;
let running = false;
let timer = null;
let inFlight = null;

export const relayWishlistPriceDrops = async () => {
  const events = await ProductChange.find({
    priceDrop: { $exists: true },
    priceAlertRelayedAt: null,
  })
    .select({ productId: 1, priceDrop: 1, createdAt: 1 })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE)
    .lean();
  if (!events.length) return;

  // why: the Mongo event ID is also the PG idempotency key. A crash between
  // these two writes replays the batch without duplicating outbox events.
  await prisma.outboxEvent.createMany({
    data: events.map((event) => ({
      id: `wishlist-price:${event._id}`,
      eventType: "wishlist.price.dropped",
      payload: {
        productId: event.productId,
        ...event.priceDrop,
        observedAt: event.createdAt.toISOString(),
      },
    })),
    skipDuplicates: true,
  });
  await ProductChange.updateMany(
    { _id: { $in: events.map((event) => event._id) } },
    { $set: { priceAlertRelayedAt: new Date() } },
  );
};

const poll = async () => {
  try {
    await relayWishlistPriceDrops();
  } catch (err) {
    logger.error({ err }, "[Wishlist] price-drop relay failed; retrying later");
  } finally {
    if (running) timer = setTimeout(run, POLL_INTERVAL_MS);
  }
};

const run = () => {
  inFlight = poll();
};

export const startWishlistAlertsWorker = () => {
  if (running) return;
  running = true;
  run();
};

export const stopWishlistAlertsWorker = async () => {
  running = false;
  clearTimeout(timer);
  await inFlight;
};
