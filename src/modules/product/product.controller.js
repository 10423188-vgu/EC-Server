import {
  listAdminProducts,
  getProductOverview,
} from "./product.admin.service.js";
import { productService } from "./product.service.js";
import {
  adjustProductStock,
  listStockAdjustments,
} from "./product.inventory.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  auditProductChange,
  listProductHistory,
  productRevision,
} from "./product.history.service.js";
import { bulkUpdateProducts } from "./product.bulk.service.js";
import { exportProductsCsv } from "./product.export.service.js";
import { Product } from "../../models/product.model.js";
import { ConflictError } from "../../shared/errors/app.error.js";

export const productController = {
  bulkUpdate: asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await bulkUpdateProducts(req.body, req.userId) });
  }),
  history: asyncHandler(async (req, res) => {
    res.json({
      success: true,
      ...(await listProductHistory(req.params.id, req.query)),
    });
  }),
  exportCsv: asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (
      ids &&
      (await Product.countDocuments({ _id: { $in: ids } })) !== ids.length
    ) {
      throw new ConflictError(
        "Some selected products are unavailable. Refresh the list.",
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="products.csv"');
    try {
      await pipeline(Readable.from(exportProductsCsv(req.query, ids)), res);
    } catch (error) {
      if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
    }
  }),
  adjustStock: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      data: await adjustProductStock(
        req.params.id,
        req.params.variantId,
        req.userId,
        req.body,
      ),
    });
  }),
  stockHistory: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      data: await listStockAdjustments(req.params.id, req.params.variantId),
    });
  }),
  adminDetail: asyncHandler(async (req, res) => {
    const product = await productService.getAdminProductById(req.params.id);
    sendSuccess(res, {
      data: {
        ...product,
        revision: productRevision(product),
        variants: product.variants.map((variant) => ({
          ...variant,
          revision: productRevision(variant, true),
        })),
      },
    });
  }),
  restoreProduct: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      message: "Product restored as inactive",
      data: await auditProductChange(
        req.params.id,
        req.userId,
        "restored",
        () => productService.restoreProduct(req.params.id),
      ),
    });
  }),
  restoreVariant: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      message: "Variant restored as inactive",
      data: await auditProductChange(
        req.params.id,
        req.userId,
        "variant.restored",
        () =>
          productService.restoreVariant(req.params.id, req.params.variantId),
      ),
    });
  }),
  adminList: asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await listAdminProducts(req.query)) });
  }),
  adminOverview: asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await getProductOverview(req.query) });
  }),
  getRelatedProducts: asyncHandler(async (req, res) => {
    const products = await productService.getRelatedProducts(
      req.params.id,
      req.query.limit,
    );
    sendSuccess(res, {
      message: "Related products fetched successfully",
      data: products,
    });
  }),

  getProducts: asyncHandler(async (req, res) => {
    const result = await productService.getProducts(req.query);
    // why: not sendSuccess — client reads `pagination` at the response's top level, not nested under `meta`
    res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      ...result,
    });
  }),

  getProductById: asyncHandler(async (req, res) => {
    const product = await productService.getProductById(req.params.id);
    sendSuccess(res, {
      message: "Product fetched successfully",
      data: product,
    });
  }),

  createProduct: asyncHandler(async (req, res) => {
    const product = await auditProductChange(null, req.userId, "created", () =>
      productService.createProduct(req.body),
    );
    sendSuccess(res, {
      statusCode: 201,
      message: "Product created successfully",
      data: product,
    });
  }),

  updateProduct: asyncHandler(async (req, res) => {
    const { expectedRevision, ...data } = req.body;
    const product = await auditProductChange(
      req.params.id,
      req.userId,
      "updated",
      () => productService.updateProduct(req.params.id, data),
      { revision: expectedRevision },
    );
    sendSuccess(res, {
      message: "Product updated successfully",
      data: product,
    });
  }),

  deleteProduct: asyncHandler(async (req, res) => {
    await auditProductChange(req.params.id, req.userId, "trashed", () =>
      productService.deleteProduct(req.params.id, req.userId),
    );
    sendSuccess(res, { message: "Product moved to trash" });
  }),

  createVariant: asyncHandler(async (req, res) => {
    const variant = await auditProductChange(
      req.params.id,
      req.userId,
      "variant.created",
      () => productService.createVariant(req.params.id, req.body),
    );
    sendSuccess(res, {
      statusCode: 201,
      message: "Variant created successfully",
      data: variant,
    });
  }),

  updateVariant: asyncHandler(async (req, res) => {
    const { expectedRevision, ...data } = req.body;
    const variant = await auditProductChange(
      req.params.id,
      req.userId,
      "variant.updated",
      () =>
        productService.updateVariant(req.params.id, req.params.variantId, data),
      { revision: expectedRevision, variantId: req.params.variantId },
    );
    sendSuccess(res, {
      message: "Variant updated successfully",
      data: variant,
    });
  }),

  deleteVariant: asyncHandler(async (req, res) => {
    await auditProductChange(req.params.id, req.userId, "variant.trashed", () =>
      productService.deleteVariant(
        req.params.id,
        req.params.variantId,
        req.userId,
      ),
    );
    sendSuccess(res, { message: "Variant moved to trash" });
  }),
};
