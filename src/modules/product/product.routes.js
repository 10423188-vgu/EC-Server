import { Router } from "express";
import { productController } from "./product.controller.js";
import {
  authenticate,
  authorize,
} from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { productSchema } from "./product.schema.js";
import {
  adminProductsSchema,
  productOverviewSchema,
  productBulkSchema,
  productExportSchema,
  productHistorySchema,
} from "./product.admin.schema.js";

const router = Router();

router.post(
  "/admin/bulk",
  authenticate,
  authorize("ADMIN"),
  validate(productBulkSchema),
  productController.bulkUpdate,
);
router.post(
  "/admin/export",
  authenticate,
  authorize("ADMIN"),
  validate(productExportSchema),
  productController.exportCsv,
);
router.get(
  "/admin/:id/history",
  authenticate,
  authorize("ADMIN"),
  validate(productHistorySchema),
  productController.history,
);

router.post(
  "/:id/variants/:variantId/stock-adjustments",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.adjustStock),
  productController.adjustStock,
);
router.get(
  "/:id/variants/:variantId/stock-adjustments",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.deleteVariant),
  productController.stockHistory,
);

router.get(
  "/admin/list",
  authenticate,
  authorize("ADMIN"),
  validate(adminProductsSchema),
  productController.adminList,
);
router.get(
  "/admin/overview",
  authenticate,
  authorize("ADMIN"),
  validate(productOverviewSchema),
  productController.adminOverview,
);

router.get(
  "/admin/:id",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.getProductById),
  productController.adminDetail,
);
router.post(
  "/:id/restore",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.deleteProduct),
  productController.restoreProduct,
);
router.post(
  "/:id/variants/:variantId/restore",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.deleteVariant),
  productController.restoreVariant,
);

router.get(
  "/",
  validate(productSchema.getProducts),
  productController.getProducts,
);

router.get(
  "/:id/related",
  validate(productSchema.getRelatedProducts),
  productController.getRelatedProducts,
);
router.get(
  "/:id",
  validate(productSchema.getProductById),
  productController.getProductById,
);

router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.createProduct),
  productController.createProduct,
);
router.put(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.updateProduct),
  productController.updateProduct,
);
router.delete(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.deleteProduct),
  productController.deleteProduct,
);

router.post(
  "/:id/variants",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.createVariant),
  productController.createVariant,
);
router.put(
  "/:id/variants/:variantId",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.updateVariant),
  productController.updateVariant,
);
router.delete(
  "/:id/variants/:variantId",
  authenticate,
  authorize("ADMIN"),
  validate(productSchema.deleteVariant),
  productController.deleteVariant,
);

export default router;
