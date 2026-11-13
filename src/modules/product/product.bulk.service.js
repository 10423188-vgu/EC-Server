import mongoose from "mongoose";
import { Product } from "../../models/product.model.js";
import { ProductChange } from "../../models/product-change.model.js";
import { productChanges } from "./product.history.service.js";

export const bulkUpdateProducts = ({ ids, action }, changedBy) =>
  mongoose.connection.transaction(async () => {
    const products = await Product.find({ _id: { $in: ids } }).lean();
    const byId = new Map(
      products.map((product) => [String(product._id), product]),
    );
    const now = new Date();
    const patch =
      action === "trash"
        ? { isActive: false, deletedAt: now, deletedBy: changedBy }
        : action === "restore"
          ? { isActive: false, deletedAt: null, deletedBy: null }
          : { isActive: action === "activate" };
    const changed = [],
      skipped = [],
      failed = [],
      events = [];
    for (const id of ids) {
      const product = byId.get(String(id));
      if (!product) {
        failed.push({ id, message: "Product not found" });
        continue;
      }
      if (
        action === "restore"
          ? !product.deletedAt
          : action === "trash" && product.deletedAt
      ) {
        skipped.push(id);
        continue;
      }
      if (product.deletedAt && action !== "restore") {
        failed.push({
          id,
          message: "Restore the product before changing its status",
        });
        continue;
      }
      const changes = productChanges(product, { ...product, ...patch });
      if (!changes.length) {
        skipped.push(id);
        continue;
      }
      changed.push(id);
      events.push({
        productId: id,
        changedBy,
        action: `bulk.${action}`,
        changes,
      });
    }
    if (changed.length) {
      await Product.updateMany({ _id: { $in: changed } }, { $set: patch });
      await ProductChange.insertMany(events);
    }
    return { changed, skipped, failed };
  });
