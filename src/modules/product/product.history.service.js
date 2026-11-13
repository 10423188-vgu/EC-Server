import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { Product } from "../../models/product.model.js";
import { ProductChange } from "../../models/product-change.model.js";
import { prisma } from "../../configs/db/index.js";
import { ConflictError, NotFoundError } from "../../shared/errors/app.error.js";
import { lowestProductPrice } from "./product.pricing.js";

// why: repository reads, writes and denormalization must join the same transaction
// without passing a session through every existing product-service method.
mongoose.set("transactionAsyncLocalStorage", true);

const PRODUCT_FIELDS = [
  "name",
  "slug",
  "description",
  "categoryId",
  "categoryName",
  "brandId",
  "brandName",
  "tags",
  "attributes",
  "images",
  "isActive",
  "isFeatured",
  "deletedAt",
];
const VARIANT_FIELDS = [
  "sku",
  "name",
  "price",
  "salePrice",
  "weight",
  "options",
  "images",
  "isActive",
  "deletedAt",
];
const plainValue = (value) =>
  value == null ? null : JSON.parse(JSON.stringify(value));

// why: separate metadata/variant revisions avoid false conflicts from stock changes
// or editing another variant, without adding persisted version fields.
export const productRevision = (product, variant = false) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        (variant ? VARIANT_FIELDS : PRODUCT_FIELDS).map((field) =>
          plainValue(product?.[field]),
        ),
      ),
    )
    .digest("hex");

export const productChanges = (before, after) => {
  const changes = [];
  const compare = (field, previous, next) => {
    previous = plainValue(previous);
    next = plainValue(next);
    if (!isDeepStrictEqual(previous, next))
      changes.push({ field, before: previous, after: next });
  };
  for (const field of PRODUCT_FIELDS)
    compare(field, before?.[field], after?.[field]);
  const oldVariants = new Map(
    (before?.variants ?? []).map((variant) => [variant._id, variant]),
  );
  const newVariants = new Map(
    (after?.variants ?? []).map((variant) => [variant._id, variant]),
  );
  for (const id of new Set([...oldVariants.keys(), ...newVariants.keys()])) {
    for (const field of VARIANT_FIELDS) {
      compare(
        `variants.${id}.${field}`,
        oldVariants.get(id)?.[field],
        newVariants.get(id)?.[field],
      );
    }
  }
  return changes;
};

export const auditProductChange = (
  productId,
  changedBy,
  action,
  mutate,
  expected,
) =>
  mongoose.connection.transaction(async () => {
    const before = productId ? await Product.findById(productId).lean() : null;
    if (expected?.revision && before) {
      const target = expected.variantId
        ? before.variants.find((variant) => variant._id === expected.variantId)
        : before;
      if (
        productRevision(target, Boolean(expected.variantId)) !==
        expected.revision
      )
        throw new ConflictError(
          "This product or variant has changed. Reopen the editor to load the latest data before saving.",
        );
    }
    const result = await mutate();
    const id = productId ?? result.id;
    const after = await Product.findById(id).lean();
    const changes = productChanges(before, after);
    const previousPrice = lowestProductPrice(before);
    const price = lowestProductPrice(after);
    if (changes.length)
      await ProductChange.create({
        productId: id,
        changedBy,
        action,
        changes,
        // why: persist the price-drop event in the same Mongo transaction as
        // the product edit; the relay can recover after a process/PG outage.
        ...(previousPrice != null &&
          price != null &&
          price < previousPrice && {
            priceDrop: { name: after.name, previousPrice, price },
          }),
        variants: (after?.variants ?? before?.variants ?? []).map(
          (variant) => ({
            id: variant._id,
            name: variant.name,
            sku: variant.sku,
          }),
        ),
      });
    return result;
  });

export const listProductHistory = async (productId, { page, limit }) => {
  const [exists, entries, total] = await Promise.all([
    Product.exists({ _id: productId }),
    ProductChange.find({ productId })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ProductChange.countDocuments({ productId }),
  ]);
  if (!exists) throw new NotFoundError("Product");
  const ids = [...new Set(entries.map((entry) => entry.changedBy))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return {
    data: entries.map((entry) => ({
      ...entry,
      changedByName: names.get(entry.changedBy) ?? entry.changedBy,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};
