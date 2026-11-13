import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";
import { getHealthStatus } from "../../../src/shared/utils/health.util.js";
import { prisma } from "../../../src/configs/db/index.js";
import { redisClient } from "../../../src/configs/cache/redis.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

vi.mock("../../../src/configs/cache/redis.js", () => ({
  redisClient: { ping: vi.fn() },
}));

vi.mock("../../../src/configs/integrations/elasticsearch.js", () => ({
  esAvailable: true,
  esBreaker: { state: "CLOSED" },
}));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  redisClient.ping.mockResolvedValue("PONG");
  Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
});

describe("getHealthStatus", () => {
  it("reports healthy when Postgres, Mongo, and Redis are all up (ES optional)", async () => {
    const result = await getHealthStatus();

    expect(result.healthy).toBe(true);
    expect(result.services).toEqual({
      postgres: { status: "up" },
      mongo: { status: "up" },
      redis: { status: "up" },
      elasticsearch: { status: "up", circuit: "CLOSED", optional: true },
    });
  });

  it("reports unhealthy when Postgres is down, even if Mongo/Redis are up", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));

    const result = await getHealthStatus();

    expect(result.healthy).toBe(false);
    expect(result.services.postgres).toEqual({ status: "down", error: "connection refused" });
  });

  it("reports unhealthy when Mongo connection is not ready", async () => {
    Object.defineProperty(mongoose.connection, "readyState", { value: 0, configurable: true });

    const result = await getHealthStatus();

    expect(result.healthy).toBe(false);
    expect(result.services.mongo).toEqual({ status: "down" });
  });

  it("reports unhealthy when Redis ping fails", async () => {
    redisClient.ping.mockRejectedValue(new Error("timeout"));

    const result = await getHealthStatus();

    expect(result.healthy).toBe(false);
    expect(result.services.redis).toEqual({ status: "down", error: "timeout" });
  });

});
