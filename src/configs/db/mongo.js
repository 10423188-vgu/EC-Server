import mongoose from "mongoose";
import dns from "node:dns/promises";
import { logger } from "../../shared/utils/logger.js";

// why: some networks' default DNS resolver can't resolve the SRV/TXT records mongodb+srv:// (Atlas) needs — force resolvers known to support them
dns.setServers(["1.1.1.1", "8.8.8.8"]);

export const connectMongo = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not defined");

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: Number(process.env.MONGO_POOL_MAX) || 10,
    // why: autoIndex builds indexes synchronously on every connect — fine in dev,
    // but a lock-contention risk against a large production collection. Indexes should
    // already exist from having run in dev/staging first; production just uses them.
    autoIndex: process.env.NODE_ENV !== "production",
  });
  logger.info("MongoDB connected");
};

export const disconnectMongo = async () => {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
};

export default mongoose;
