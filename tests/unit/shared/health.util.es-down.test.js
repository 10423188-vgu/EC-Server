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

// Separate file so esAvailable can be statically mocked to false — Elasticsearch is a
// soft dependency with a Mongo fallback (see search.service.js) and must not flip `healthy`.
vi.mock("../../../src/configs/integrations/elasticsearch.js", () => ({
  esAvailable: false,
  esBreaker: { state: "OPEN" },
}));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  redisClient.ping.mockResolvedValue("PONG");
  Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
});

describe("getHealthStatus — Elasticsearch is a soft dependency", () => {
  it("stays healthy when Elasticsearch is down, as long as Postgres/Mongo/Redis are up", async () => {
    const result = await getHealthStatus();

    expect(result.healthy).toBe(true);
    expect(result.services.elasticsearch).toEqual({ status: "down", circuit: "OPEN", optional: true });
  });
});
