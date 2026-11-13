import { Router } from "express";
import { orderController } from "./order.controller.js";
import {
  authenticate,
  authorize,
} from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { orderSchema } from "./order.schema.js";
import { returnController } from "../return/return.controller.js";
import { returnSchema } from "../return/return.schema.js";

const router = Router();

// ─── Customer ─────────────────────────────────────────────────────────────────
router.post(
  "/checkout",
  authenticate,
  validate(orderSchema.checkout),
  orderController.checkout,
);
router.get("/", authenticate, validate(orderSchema.list), orderController.list);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.post(
  "/admin/export-selected.csv",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminExportSelected),
  orderController.adminExportSelected,
);
router.post(
  "/admin/selected",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminSelected),
  orderController.adminSelected,
);
router.get(
  "/admin/list",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminList),
  orderController.adminList,
);
router.patch(
  "/admin/returns/:returnId/status",
  authenticate,
  authorize("ADMIN"),
  validate(returnSchema.updateStatus),
  returnController.adminUpdateStatus,
);
router.get(
  "/admin/metrics",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminMetrics),
  orderController.adminMetrics,
);
router.get(
  "/admin/analytics",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminAnalytics),
  orderController.adminAnalytics,
);
router.get(
  "/admin/export.csv",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminExport),
  orderController.adminExport,
);
router.patch(
  "/admin/:id/shipping",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminUpdateShipping),
  orderController.adminUpdateShipping,
);
router.patch(
  "/admin/:id/cancel",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminCancel),
  orderController.adminCancel,
);
router.post(
  "/admin/:id/refunds",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminRefund),
  orderController.adminRefund,
);
router.patch(
  "/admin/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminUpdateStatus),
  orderController.adminUpdateStatus,
);
router.get(
  "/admin/:id",
  authenticate,
  authorize("ADMIN"),
  validate(orderSchema.adminGetById),
  orderController.adminGetById,
);

router.get(
  "/:id",
  authenticate,
  validate(orderSchema.getById),
  orderController.getById,
);
router.patch(
  "/:id/cancel",
  authenticate,
  validate(orderSchema.cancel),
  orderController.cancel,
);
router.post(
  "/:id/returns",
  authenticate,
  validate(returnSchema.create),
  returnController.create,
);

export default router;
