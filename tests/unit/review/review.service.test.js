import { describe, it, expect, vi, beforeEach } from "vitest";
import { reviewService } from "../../../src/modules/review/review.service.js";
import { reviewMongoRepository } from "../../../src/modules/review/review.mongo.repository.js";
import { userPrismaRepository } from "../../../src/modules/user/user.prisma.repository.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/review/review.mongo.repository.js", () => ({
  reviewMongoRepository: {
    productExists: vi.fn(),
    findByUserAndProduct: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    voteHelpful: vi.fn(),
    addAdminResponse: vi.fn(),
    updateStatus: vi.fn(),
    findAll: vi.fn(),
    updateProductStats: vi.fn(),
    findByProductId: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock("../../../src/modules/user/user.prisma.repository.js", () => ({
  userPrismaRepository: { findById: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  reviewMongoRepository.updateProductStats.mockResolvedValue({});
});

describe("reviewService.getProductReviews", () => {
  it("passes the optional viewer id to the repository for vote highlighting", async () => {
    reviewMongoRepository.productExists.mockResolvedValue(true);
    reviewMongoRepository.findByProductId.mockResolvedValue({
      reviews: [],
      total: 0,
    });
    reviewMongoRepository.getStats.mockResolvedValue({ count: 0, average: 0 });

    await reviewService.getProductReviews({
      productId: "product-1",
      page: 1,
      limit: 10,
      sort: "helpful",
      userId: "viewer-1",
    });

    expect(reviewMongoRepository.findByProductId).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "product-1",
        userId: "viewer-1",
        status: "APPROVED",
      }),
    );
  });
});

describe("reviewService.createReview", () => {
  it("denormalizes the reviewer's name/avatar from Postgres onto the created review", async () => {
    reviewMongoRepository.productExists.mockResolvedValue(true);
    reviewMongoRepository.findByUserAndProduct.mockResolvedValue(null);
    userPrismaRepository.findById.mockResolvedValue({
      name: "Alice",
      avatar: "a.png",
    });
    reviewMongoRepository.create.mockResolvedValue({ id: "r1" });

    await reviewService.createReview({
      userId: "u1",
      productId: "p1",
      data: { rating: 5, comment: "Great" },
    });

    expect(reviewMongoRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "p1",
        userId: "u1",
        userName: "Alice",
        userAvatar: "a.png",
      }),
    );
    expect(reviewMongoRepository.updateProductStats).toHaveBeenCalledWith("p1");
  });

  it("throws NotFoundError when the product does not exist", async () => {
    reviewMongoRepository.productExists.mockResolvedValue(false);
    reviewMongoRepository.findByUserAndProduct.mockResolvedValue(null);
    userPrismaRepository.findById.mockResolvedValue({
      name: "Alice",
      avatar: null,
    });

    await expect(
      reviewService.createReview({
        userId: "u1",
        productId: "missing",
        data: {},
      }),
    ).rejects.toThrow(NotFoundError);
    expect(reviewMongoRepository.create).not.toHaveBeenCalled();
  });

  it("throws ConflictError when the user already reviewed this product", async () => {
    reviewMongoRepository.productExists.mockResolvedValue(true);
    reviewMongoRepository.findByUserAndProduct.mockResolvedValue({
      id: "existing",
    });
    userPrismaRepository.findById.mockResolvedValue({
      name: "Alice",
      avatar: null,
    });

    await expect(
      reviewService.createReview({ userId: "u1", productId: "p1", data: {} }),
    ).rejects.toThrow(ConflictError);
    expect(reviewMongoRepository.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the reviewing user no longer exists", async () => {
    reviewMongoRepository.productExists.mockResolvedValue(true);
    reviewMongoRepository.findByUserAndProduct.mockResolvedValue(null);
    userPrismaRepository.findById.mockResolvedValue(null);

    await expect(
      reviewService.createReview({ userId: "gone", productId: "p1", data: {} }),
    ).rejects.toThrow(NotFoundError);
    expect(reviewMongoRepository.create).not.toHaveBeenCalled();
  });
});

describe("reviewService moderation and voting", () => {
  it("refreshes product aggregates after a rating changes", async () => {
    reviewMongoRepository.findById.mockResolvedValue({
      id: "r1",
      productId: "p1",
      userId: "u1",
      rating: 3,
    });
    reviewMongoRepository.update.mockResolvedValue({ id: "r1", rating: 5 });

    await expect(
      reviewService.updateReview({
        reviewId: "r1",
        userId: "u1",
        data: { rating: 5 },
      }),
    ).resolves.toEqual({ id: "r1", rating: 5 });
    expect(reviewMongoRepository.updateProductStats).toHaveBeenCalledWith("p1");
  });

  it("prevents editing another user's review", async () => {
    reviewMongoRepository.findById.mockResolvedValue({
      id: "r1",
      productId: "p1",
      userId: "owner",
    });

    await expect(
      reviewService.updateReview({
        reviewId: "r1",
        userId: "other",
        data: { comment: "changed" },
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(reviewMongoRepository.update).not.toHaveBeenCalled();
  });

  it("allows an admin to remove another user's review and refreshes stats", async () => {
    reviewMongoRepository.findById.mockResolvedValue({
      id: "r1",
      productId: "p1",
      userId: "owner",
    });

    await reviewService.deleteReview({
      reviewId: "r1",
      userId: "admin",
      userRole: "ADMIN",
    });

    expect(reviewMongoRepository.delete).toHaveBeenCalledWith("r1");
    expect(reviewMongoRepository.updateProductStats).toHaveBeenCalledWith("p1");
  });

  it("rejects self-votes and returns aggregate vote counts", async () => {
    reviewMongoRepository.voteHelpful.mockResolvedValue("SELF_VOTE");
    await expect(
      reviewService.voteHelpful({ reviewId: "r1", userId: "u1", vote: true }),
    ).rejects.toThrow(BadRequestError);

    reviewMongoRepository.voteHelpful.mockResolvedValue({
      helpfulCount: 4,
      notHelpfulCount: 1,
      myVote: "helpful",
    });
    await expect(
      reviewService.voteHelpful({ reviewId: "r1", userId: "u2", vote: true }),
    ).resolves.toEqual({
      helpfulCount: 4,
      notHelpfulCount: 1,
      myVote: "helpful",
    });
  });

  it("updates review status and refreshes product stats", async () => {
    reviewMongoRepository.findById.mockResolvedValue({
      id: "r1",
      productId: "p1",
    });
    reviewMongoRepository.updateStatus.mockResolvedValue({
      id: "r1",
      status: "APPROVED",
    });

    await reviewService.updateStatus({ reviewId: "r1", status: "APPROVED" });

    expect(reviewMongoRepository.updateStatus).toHaveBeenCalledWith(
      "r1",
      "APPROVED",
    );
    expect(reviewMongoRepository.updateProductStats).toHaveBeenCalledWith("p1");
  });
});
