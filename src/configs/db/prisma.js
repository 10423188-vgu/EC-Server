import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { logger } from "../../shared/utils/logger.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
});

export const connectPostgres = async () => {
  try {
    await prisma.$connect();
    logger.info("PostgreSQL connected");
  } catch (error) {
    logger.error({ err: error }, "PostgreSQL connection failed");
    throw error;
  }
};

export const disconnectPostgres = async () => {
  await prisma.$disconnect();
  await pool.end();
  logger.info("PostgreSQL disconnected");
};
