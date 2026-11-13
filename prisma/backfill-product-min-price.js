import "dotenv/config";
import mongoose from "mongoose";
import dns from "node:dns/promises";
import { Product } from "../src/models/product.model.js";

// Same DNS override as mongo.js — avoids SRV lookup failures on some ISPs
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const computeDenormalizedFields = (variants = []) => {
  const active = variants.filter((v) => v.isActive);
  const activePrices = active.map((v) => v.salePrice ?? v.price);
  return {
    minPrice: activePrices.length ? Math.min(...activePrices) : null,
    hasSale: active.some((v) => v.salePrice != null),
    inStock: active.some((v) => v.stock > 0),
  };
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const products = await Product.find({}, { variants: 1 }).lean();
  console.log(`Backfilling minPrice/hasSale/inStock for ${products.length} products...`);

  const ops = products.map((p) => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: computeDenormalizedFields(p.variants) },
    },
  }));

  if (ops.length) await Product.bulkWrite(ops);

  console.log("Done.");
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
