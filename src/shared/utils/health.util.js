import mongoose from "mongoose";
import { prisma } from "../../configs/db/index.js";
import { redisClient } from "../../configs/cache/redis.js";
import { esAvailable, esBreaker } from "../../configs/integrations/elasticsearch.js";

const checkPostgres = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "up" };
  } catch (err) {
    return { status: "down", error: err.message };
  }
};

const checkRedis = async () => {
  try {
    await redisClient.ping();
    return { status: "up" };
  } catch (err) {
    return { status: "down", error: err.message };
  }
};

const checkMongo = () => ({
  status: mongoose.connection.readyState === 1 ? "up" : "down",
});

// why: ES has a Mongo fallback (see search.service.js) — its outage degrades search quality but must not fail readiness
const checkElasticsearch = () => ({
  status: esAvailable ? "up" : "down",
  circuit: esBreaker.state,
  optional: true,
});

export const getHealthStatus = async () => {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  const mongo = checkMongo();
  const elasticsearch = checkElasticsearch();

  const healthy = postgres.status === "up" && mongo.status === "up" && redis.status === "up";

  return { healthy, services: { postgres, mongo, redis, elasticsearch } };
};
