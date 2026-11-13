import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import mongoose from "mongoose";
import dns from "node:dns/promises";
import { Product } from "../src/models/product.model.js";

// Same DNS override as mongo.js — avoids SRV lookup failures on some ISPs
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// why: existing orders snapshot `image` at checkout time (order.service.js resolveCheckoutCart) —
// this re-derives it from the variant's current MongoDB data using the exact same priority, for
// orders placed back when a variant didn't have its own photo yet
const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const items = await prisma.orderItem.findMany({
    select: { id: true, variantId: true, image: true },
  });

  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const products = await Product.find(
    { "variants._id": { $in: variantIds } },
    { images: { $slice: 1 }, variants: 1 }
  ).lean();

  const imageByVariant = new Map();
  for (const p of products) {
    for (const v of p.variants) {
      imageByVariant.set(String(v._id), v.images?.[0]?.url ?? p.images?.[0]?.url ?? null);
    }
  }

  let updated = 0;
  let skippedMissing = 0;
  for (const item of items) {
    if (!imageByVariant.has(item.variantId)) {
      skippedMissing++;
      continue;
    }
    const correctImage = imageByVariant.get(item.variantId);
    if (correctImage === item.image) continue;

    await prisma.orderItem.update({ where: { id: item.id }, data: { image: correctImage } });
    updated++;
    console.log(`updated ${item.id}: ${item.image ?? "(null)"} -> ${correctImage ?? "(null)"}`);
  }

  console.log(
    `\nDone. ${updated}/${items.length} order items updated, ${skippedMissing} skipped (variant no longer exists).`
  );

  await mongoose.disconnect();
  await prisma.$disconnect();
  await pool.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
