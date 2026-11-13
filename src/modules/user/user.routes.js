import { Router } from "express";
import { userController } from "./user.controller.js";
import {
  authenticate,
  authorize,
} from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { userSchema } from "./user.schema.js";
import { rateLimit } from "../../shared/middlewares/rate-limit.middleware.js";

const router = Router();
const twoFactorActionLimiter = rateLimit(10, 900);
const emailChangeLimiter = rateLimit(3, 3600);

router.post(
  "/admin/customers",
  authenticate,
  authorize("ADMIN"),
  validate(userSchema.adminCreateCustomer),
  userController.adminCreateCustomer,
);

router.patch(
  "/admin/customers/:id/suspension",
  authenticate,
  authorize("ADMIN"),
  validate(userSchema.adminCustomerSuspension),
  userController.adminSetCustomerSuspension,
);

router.get(
  "/admin/customers",
  authenticate,
  authorize("ADMIN"),
  validate(userSchema.adminCustomers),
  userController.adminListCustomers,
);

router.get(
  "/admin/customers/overview",
  authenticate,
  authorize("ADMIN"),
  validate(userSchema.adminCustomerOverview),
  userController.adminCustomerOverview,
);

router.get(
  "/admin/customers/:id",
  authenticate,
  authorize("ADMIN"),
  validate(userSchema.adminCustomerDetails),
  userController.adminGetCustomer,
);

router.post(
  "/admin/customers/export.csv",
  authenticate,
  authorize("ADMIN"),
  validate(userSchema.adminCustomerExport),
  userController.adminExportCustomers,
);

router.get("/me/two-factor", authenticate, userController.getTwoFactorStatus);
router.post(
  "/me/two-factor/setup",
  authenticate,
  userController.beginTwoFactorSetup,
);
router.post(
  "/me/two-factor/confirm",
  authenticate,
  twoFactorActionLimiter,
  validate(userSchema.twoFactorConfirm),
  userController.enableTwoFactor,
);
router.delete(
  "/me/two-factor",
  authenticate,
  twoFactorActionLimiter,
  validate(userSchema.twoFactorDisable),
  userController.disableTwoFactor,
);

router.get("/me", authenticate, userController.getProfile);
router.patch(
  "/me",
  authenticate,
  validate(userSchema.updateProfile),
  userController.updateProfile,
);
router.patch(
  "/me/email",
  authenticate,
  emailChangeLimiter,
  validate(userSchema.requestEmailChange),
  userController.requestEmailChange,
);
router.delete(
  "/me/email-change",
  authenticate,
  emailChangeLimiter,
  userController.cancelEmailChange,
);
router.patch(
  "/me/review-profile",
  authenticate,
  validate(userSchema.updateReviewProfile),
  userController.updateReviewProfile,
);
router.put(
  "/me/password",
  authenticate,
  validate(userSchema.changePassword),
  userController.changePassword,
);
router.patch(
  "/me/avatar",
  authenticate,
  validate(userSchema.updateAvatar),
  userController.updateAvatar,
);
router.patch(
  "/me/banner",
  authenticate,
  validate(userSchema.updateBanner),
  userController.updateBanner,
);
router.patch(
  "/me/frame",
  authenticate,
  validate(userSchema.setFrame),
  userController.setFrame,
);

export default router;
