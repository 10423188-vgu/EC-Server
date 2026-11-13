import { reviewMongoRepository } from "./review.mongo.repository.js";
import { userPrismaRepository } from "../user/user.prisma.repository.js";
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  ConflictError,
} from "../../shared/errors/app.error.js";

// why: callers await this before responding so Product.reviewStats is fresh when the client
// refetches after cache invalidation — ES sync happens separately via the Change Stream worker
// (server/src/workers/es-sync.worker.js), no need to trigger it here
const refreshStats = (productId) => reviewMongoRepository.updateProductStats(productId);

const withCurrentReviewerProfiles = async (reviews) => {
  if (!reviews.length) return reviews;
  const userIds = [...new Set(reviews.map((review) => review.userId))];
  const profiles = await userPrismaRepository.findPublicReviewProfiles(userIds);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return reviews.map((review) => {
    const profile = profileById.get(review.userId);
    if (!profile) return review;
    return {
      ...review,
      userName: profile.reviewDisplayName || profile.name || review.userName,
      userAvatar: profile.reviewAvatar ?? profile.avatar ?? null,
    };
  });
};

export const reviewService = {
  getProductReviews: async ({ productId, page, limit, sort, rating, userId }) => {
    const [exists, { reviews, total }, reviewStats] = await Promise.all([
      reviewMongoRepository.productExists(productId),
      reviewMongoRepository.findByProductId({
        productId,
        page,
        limit,
        sort,
        rating,
        status: "APPROVED",
        userId,
      }),
      reviewMongoRepository.getStats(productId),
    ]);

    if (!exists) throw new NotFoundError("Product");

    return {
      data: await withCurrentReviewerProfiles(reviews),
      reviewStats,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  getMyReview: async (userId, productId) => {
    const review = await reviewMongoRepository.findByUserAndProduct(userId, productId);
    return review ? (await withCurrentReviewerProfiles([review]))[0] : null;
  },

  getMyReviews: async (userId, { page, limit }) => {
    const { reviews, total } = await reviewMongoRepository.findMyReviews(userId, { page, limit });
    return {
      data: await withCurrentReviewerProfiles(reviews),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  createReview: async ({ userId, productId, data }) => {
    // why: product-existence, duplicate-review, and the reviewer's own profile (for the
    // userName/userAvatar denormalized onto the review) are independent reads — run concurrently
    const [exists, existing, user] = await Promise.all([
      reviewMongoRepository.productExists(productId),
      reviewMongoRepository.findByUserAndProduct(userId, productId),
      userPrismaRepository.findById(userId),
    ]);
    if (!exists) throw new NotFoundError("Product");
    if (existing) throw new ConflictError("You have already reviewed this product");
    if (!user) throw new NotFoundError("User");

    const review = await reviewMongoRepository.create({
      productId,
      userId,
      userName: user.reviewDisplayName || user.name,
      userAvatar: user.reviewAvatar ?? user.avatar ?? null,
      ...data,
    });

    await refreshStats(productId);
    return review;
  },

  updateReview: async ({ reviewId, userId, data }) => {
    const review = await reviewMongoRepository.findById(reviewId);
    if (!review) throw new NotFoundError("Review");
    if (review.userId !== userId) throw new ForbiddenError("You can only edit your own reviews");

    const updated = await reviewMongoRepository.update(reviewId, data);
    if (data.rating !== undefined && data.rating !== review.rating) {
      await refreshStats(review.productId);
    }
    return updated;
  },

  deleteReview: async ({ reviewId, userId, userRole }) => {
    const review = await reviewMongoRepository.findById(reviewId);
    if (!review) throw new NotFoundError("Review");
    if (review.userId !== userId && userRole !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own reviews");
    }

    await reviewMongoRepository.delete(reviewId);
    await refreshStats(review.productId);
  },

  voteHelpful: async ({ reviewId, userId, vote }) => {
    const result = await reviewMongoRepository.voteHelpful(reviewId, userId, vote);
    if (!result) throw new NotFoundError("Review");
    if (result === "SELF_VOTE") throw new BadRequestError("You cannot vote on your own review");
    return {
      helpfulCount: result.helpfulCount,
      notHelpfulCount: result.notHelpfulCount,
      myVote: result.myVote,
    };
  },

  addAdminResponse: async ({ reviewId, body }) => {
    const review = await reviewMongoRepository.findById(reviewId);
    if (!review) throw new NotFoundError("Review");
    return reviewMongoRepository.addAdminResponse(reviewId, body);
  },

  updateStatus: async ({ reviewId, status }) => {
    const review = await reviewMongoRepository.findById(reviewId);
    if (!review) throw new NotFoundError("Review");

    const updated = await reviewMongoRepository.updateStatus(reviewId, status);
    await refreshStats(review.productId);
    return updated;
  },

  adminListReviews: async ({ page, limit, status, productId, userId }) => {
    const { reviews, total } = await reviewMongoRepository.findAll({
      page,
      limit,
      status,
      productId,
      userId,
    });
    return {
      data: await withCurrentReviewerProfiles(reviews),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },
};
