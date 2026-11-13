import { config } from "dotenv";
config();

// why: must import before any instrumented module (express, pg, mongoose, redis) so
// OpenTelemetry's require-in-the-middle patching wraps their first require() call
await import("./configs/integrations/tracing.js");

const { default: app } = await import("./app.js");
const { connectDB, disconnectDB } = await import("./configs/db/index.js");
const { connectRedis, disconnectRedis } =
  await import("./configs/cache/redis.js");
const { logger } = await import("./shared/utils/logger.js");
const { startEsSyncWorker, stopEsSyncWorker } =
  await import("./workers/es-sync.worker.js");
const { startOutboxWorker, stopOutboxWorker } =
  await import("./workers/outbox.worker.js");
const { startWishlistAlertsWorker, stopWishlistAlertsWorker } =
  await import("./workers/wishlist-alerts.worker.js");

await Promise.all([connectDB(), connectRedis()]);

// why: under PM2 cluster mode, every instance would otherwise open its own Mongo
// change-stream and re-index each Product change once per instance — only instance 0
// runs the sync worker. NODE_APP_INSTANCE is unset outside PM2 cluster mode (dev,
// single-process prod), so this is a no-op there and behaves exactly as before.
const isPrimaryInstance =
  process.env.NODE_APP_INSTANCE === undefined ||
  process.env.NODE_APP_INSTANCE === "0";
if (isPrimaryInstance) {
  await startEsSyncWorker();
  startOutboxWorker();
  startWishlistAlertsWorker();
}

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server started");
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = (code) => {
  logger.info("Shutting down gracefully...");
  // why: server.close() only resolves once every in-flight connection ends — a client that
  // never disconnects (or a DB/Redis teardown that hangs) would otherwise block process.exit
  // forever, needing a manual kill. Force-exit past that ceiling instead.
  const forceExit = setTimeout(() => {
    logger.warn("Graceful shutdown timed out — forcing exit");
    process.exit(code);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(async () => {
    if (isPrimaryInstance) await stopWishlistAlertsWorker();
    await Promise.all([
      isPrimaryInstance ? stopEsSyncWorker() : Promise.resolve(),
      isPrimaryInstance ? stopOutboxWorker() : Promise.resolve(),
      disconnectDB(),
      disconnectRedis(),
    ]);
    clearTimeout(forceExit);
    process.exit(code);
  });
};

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled Rejection");
  shutdown(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught Exception");
  shutdown(1);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received");
  shutdown(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received");
  shutdown(0);
});
