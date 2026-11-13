import { Router } from "express";
import { reviewController } from "./review.controller.js";
import {
  authenticate,
  authorize,
  optionalAuthenticate,
} from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { reviewSchema } from "./review.schema.js";

const router = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
router.get(
  "/products/:productId/reviews",
  optionalAuthenticate,
  validate(reviewSchema.getProductReviews),
  reviewController.getProductReviews
);

// ─── Authenticated user ───────────────────────────────────────────────────────
router.get(
  "/products/:productId/reviews/me",
  authenticate,
  reviewController.getMyReview
);

router.get(
  "/reviews/me",
  authenticate,
  validate(reviewSchema.getMyReviews),
  reviewController.getMyReviews
);

router.post(
  "/products/:productId/reviews",
  authenticate,
  validate(reviewSchema.createReview),
  reviewController.createReview
);

router.put(
  "/reviews/:reviewId",
  authenticate,
  validate(reviewSchema.updateReview),
  reviewController.updateReview
);

router.delete(
  "/reviews/:reviewId",
  authenticate,
  validate(reviewSchema.deleteReview),
  reviewController.deleteReview
);

router.post(
  "/reviews/:reviewId/vote",
  authenticate,
  validate(reviewSchema.voteHelpful),
  reviewController.voteHelpful
);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get(
  "/admin/reviews",
  authenticate,
  authorize("ADMIN"),
  validate(reviewSchema.adminListReviews),
  reviewController.adminListReviews
);

router.post(
  "/admin/reviews/:reviewId/response",
  authenticate,
  authorize("ADMIN"),
  validate(reviewSchema.adminResponse),
  reviewController.addAdminResponse
);

router.patch(
  "/admin/reviews/:reviewId/status",
  authenticate,
  authorize("ADMIN"),
  validate(reviewSchema.updateStatus),
  reviewController.updateStatus
);

export default router;
