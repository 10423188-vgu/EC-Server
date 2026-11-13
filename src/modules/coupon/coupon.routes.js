import { Router } from "express";
import { couponController } from "./coupon.controller.js";
import {
  authenticate,
  authorize,
} from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { couponSchema } from "./coupon.schema.js";

const router = Router();

// ─── Authenticated user ────────────────────────────────────────────────────────
router.post(
  "/validate",
  authenticate,
  validate(couponSchema.validate),
  couponController.validate
);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate(couponSchema.list),
  couponController.list
);

router.get(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate(couponSchema.getById),
  couponController.getById
);

router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate(couponSchema.create),
  couponController.create
);

router.put(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate(couponSchema.update),
  couponController.update
);

router.delete(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate(couponSchema.deleteById),
  couponController.delete
);

export default router;
