import { Router } from "express";
import { wishlistController } from "./wishlist.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { wishlistSchema } from "./wishlist.schema.js";
import { rateLimit } from "../../shared/middlewares/rate-limit.middleware.js";

const router = Router();

router.get(
  "/shared/:token",
  rateLimit(60, 60),
  validate(wishlistSchema.shared),
  wishlistController.getSharedWishlist,
);

router.use(authenticate);

router.get("/preferences", wishlistController.getPreferences);
router.patch(
  "/preferences",
  validate(wishlistSchema.preferences),
  wishlistController.updatePreferences,
);
router.put("/share", wishlistController.enableSharing);
router.delete("/share", wishlistController.disableSharing);

router.get("/", validate(wishlistSchema.list), wishlistController.getWishlist);
router.delete("/", wishlistController.clearWishlist);
router.get("/ids", validate(wishlistSchema.ids), wishlistController.getWishlistIds);
router.post(
  "/:productId/toggle",
  validate(wishlistSchema.toggleItem),
  wishlistController.toggleWishlist,
);

export default router;
