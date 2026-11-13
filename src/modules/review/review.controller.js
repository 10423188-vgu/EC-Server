import { reviewService } from "./review.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const reviewController = {
  getProductReviews: asyncHandler(async (req, res) => {
    const { page, limit, sort, rating } = req.query;
    const result = await reviewService.getProductReviews({
      productId: req.params.productId,
      page,
      limit,
      sort,
      rating,
      userId: req.userId,
    });
    res.status(200).json({ success: true, message: "Reviews fetched", ...result });
  }),

  getMyReview: asyncHandler(async (req, res) => {
    const review = await reviewService.getMyReview(req.userId, req.params.productId);
    sendSuccess(res, { message: "Review fetched", data: review });
  }),

  getMyReviews: asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await reviewService.getMyReviews(req.userId, { page, limit });
    res.status(200).json({ success: true, message: "Reviews fetched", ...result });
  }),

  createReview: asyncHandler(async (req, res) => {
    const review = await reviewService.createReview({
      userId: req.userId,
      productId: req.params.productId,
      data: req.body,
    });
    sendSuccess(res, { statusCode: 201, message: "Review created", data: review });
  }),

  updateReview: asyncHandler(async (req, res) => {
    const review = await reviewService.updateReview({
      reviewId: req.params.reviewId,
      userId: req.userId,
      data: req.body,
    });
    sendSuccess(res, { message: "Review updated", data: review });
  }),

  deleteReview: asyncHandler(async (req, res) => {
    await reviewService.deleteReview({
      reviewId: req.params.reviewId,
      userId: req.userId,
      userRole: req.userRole,
    });
    sendSuccess(res, { message: "Review deleted" });
  }),

  voteHelpful: asyncHandler(async (req, res) => {
    const result = await reviewService.voteHelpful({
      reviewId: req.params.reviewId,
      userId: req.userId,
      vote: req.body.vote,
    });
    sendSuccess(res, { message: "Vote recorded", data: result });
  }),

  addAdminResponse: asyncHandler(async (req, res) => {
    const review = await reviewService.addAdminResponse({
      reviewId: req.params.reviewId,
      body: req.body.body,
    });
    sendSuccess(res, { message: "Response added", data: review });
  }),

  updateStatus: asyncHandler(async (req, res) => {
    const review = await reviewService.updateStatus({
      reviewId: req.params.reviewId,
      status: req.body.status,
    });
    sendSuccess(res, { message: "Review status updated", data: review });
  }),

  adminListReviews: asyncHandler(async (req, res) => {
    const { page, limit, status, productId, userId } = req.query;
    const result = await reviewService.adminListReviews({
      page,
      limit,
      status,
      productId,
      userId,
    });
    res.status(200).json({ success: true, message: "Reviews fetched", ...result });
  }),
};
