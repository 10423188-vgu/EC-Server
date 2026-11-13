import { createClient } from "redis";
import { CircuitBreaker } from "../../shared/utils/circuit-breaker.js";
import { logger } from "../../shared/utils/logger.js";

export const redisCircuit = new CircuitBreaker("redis", {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 10_000,
});

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    connectTimeout: 5_000,
    // why: never give up reconnecting (an outage longer than the old ~5.5s cap meant
    // permanent disconnection until process restart) — cap the DELAY instead, with
    // jitter so many instances reconnecting after the same outage don't all retry in lockstep
    reconnectStrategy: (retries) => {
      const backoff = Math.min(retries * 100, 3_000);
      const jitter = Math.floor(Math.random() * 100);
      return backoff + jitter;
    },
  },
  // why: bound the pending-commands queue so a slow/degraded Redis fails fast instead
  // of accepting unlimited queued commands while memory grows unbounded
  commandsQueueMaxLength: 1_000,
});

redisClient.on("connect", () => logger.info("Redis connected"));
redisClient.on("error", (err) => logger.error({ err }, "Redis error"));
redisClient.on("reconnecting", () => logger.warn("Redis reconnecting"));

const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error({ err: error }, "Failed to connect to Redis");
    process.exit(1);
  }
};

const disconnectRedis = async () => {
  try {
    await redisClient.quit();
    logger.info("Redis disconnected");
  } catch (error) {
    logger.error({ err: error }, "Error disconnecting Redis");
  }
};

export { redisClient, connectRedis, disconnectRedis };
