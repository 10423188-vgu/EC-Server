import { connectPostgres, disconnectPostgres } from "./prisma.js";
import { connectMongo, disconnectMongo } from "./mongo.js";
import { connectES } from "../integrations/elasticsearch.js";

export const connectDB = async () => {
  await Promise.all([
    connectPostgres(),
    connectMongo(),
    // why: connectES() catches its own errors internally and never rejects — a down ES must not block Postgres/Mongo from connecting
    connectES(),
  ]);
};

export const disconnectDB = async () => {
  await Promise.all([
    disconnectPostgres(),
    disconnectMongo(),
  ]);
};

export { prisma } from "./prisma.js";
