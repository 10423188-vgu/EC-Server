import { Router } from "express";
import { cartController } from "./cart.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { cartSchema } from "./cart.schema.js";

const router = Router();

router.use(authenticate);

router.get("/", cartController.getCart);
router.post("/", validate(cartSchema.addItem), cartController.addItem);
router.put("/", validate(cartSchema.upsertItem), cartController.upsertItem);
router.delete("/", cartController.clearCart);
router.delete(
  "/:variantId",
  validate(cartSchema.removeItem),
  cartController.removeItem
);

export default router;
