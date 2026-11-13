import { Product } from "../../models/product.model.js";
import {
  adminProductPipeline,
  summaryStages,
} from "./product.admin.service.js";

const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const HEADERS = [
  "Product ID",
  "Product name",
  "Slug",
  "Category",
  "Brand",
  "Product status",
  "Product deleted at",
  "Variant ID",
  "SKU",
  "Variant name",
  "Options",
  "Price",
  "Sale price",
  "Stock",
  "Variant active",
  "Variant deleted at",
  "Updated at",
];

export async function* exportProductsCsv(query, ids) {
  const stages = ids
    ? [{ $match: { _id: { $in: ids } } }, ...summaryStages]
    : adminProductPipeline(query);
  const cursor = Product.aggregate([
    ...stages,
    {
      $sort: {
        [query.sortBy ?? "updatedAt"]: query.sortOrder === "asc" ? 1 : -1,
        _id: 1,
      },
    },
    {
      $project: {
        name: 1,
        slug: 1,
        categoryName: 1,
        brandName: 1,
        isActive: 1,
        deletedAt: 1,
        updatedAt: 1,
        variants: 1,
      },
    },
  ])
    .option({ maxTimeMS: 30000 })
    .cursor({ batchSize: 100 });
  try {
    yield `\uFEFF${HEADERS.map(csvCell).join(",")}\r\n`;
    for await (const product of cursor) {
      const variants = (product.variants ?? []).filter(
        (variant) => product.deletedAt || !variant.deletedAt,
      );
      for (const variant of variants.length ? variants : [{}]) {
        yield [
          product._id,
          product.name,
          product.slug,
          product.categoryName,
          product.brandName,
          product.deletedAt
            ? "Deleted"
            : product.isActive
              ? "Active"
              : "Inactive",
          product.deletedAt?.toISOString(),
          variant._id,
          variant.sku,
          variant.name,
          JSON.stringify(variant.options ?? {}),
          variant.price,
          variant.salePrice,
          variant.stock,
          variant.isActive,
          variant.deletedAt?.toISOString(),
          product.updatedAt?.toISOString(),
        ]
          .map(csvCell)
          .join(",") + "\r\n";
      }
    }
  } finally {
    await cursor.close();
  }
}
