import { Router } from "express";
import { addressController } from "./address.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { addressSchema } from "./address.schema.js";

const router = Router();

router.post(
  "/",
  authenticate,
  validate(addressSchema.address),
  addressController.createAddress,
);
router.put(
  "/:id",
  authenticate,
  validate(addressSchema.address),
  addressController.updateAddress,
);
router.delete("/:id", authenticate, addressController.deleteAddress);
router.patch("/:id/default", authenticate, addressController.setDefaultAddress);

export default router;
