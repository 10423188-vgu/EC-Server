import { Router } from "express";
import { paymentController } from "./payment.controller.js";
import { authenticate, authorize } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { paymentSchema } from "./payment.schema.js";

const router = Router();

// ─── Admin ────────────────────────────────────────────────────────────────────
router.patch(
  "/:orderId/confirm",
  authenticate,
  authorize("ADMIN"),
  validate(paymentSchema.confirm),
  paymentController.confirm
);

export default router;
