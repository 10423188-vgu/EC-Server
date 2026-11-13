import { beforeEach, describe, expect, it, vi } from "vitest";
import { Review } from "../../../src/models/review.model.js";
import { reviewMongoRepository } from "../../../src/modules/review/review.mongo.repository.js";

vi.mock("../../../src/models/review.model.js", () => ({
  Review: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../../../src/models/product.model.js", () => ({
  Product: {},
}));

describe("reviewMongoRepository.voteHelpful", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables Mongoose update pipelines for the atomic vote update", async () => {
    const updatedReview = {
      helpfulCount: 1,
      notHelpfulCount: 0,
      helpfulVoters: ["voter-1"],
      notHelpfulVoters: [],
    };
    const lean = vi.fn().mockResolvedValue(updatedReview);
    const select = vi.fn().mockReturnValue({ lean });
    const voterQuery = {
      lean: vi.fn().mockResolvedValue({ userId: "review-author" }),
    };

    Review.findById.mockReturnValue(voterQuery);
    Review.findByIdAndUpdate.mockReturnValue({ select });

    await expect(
      reviewMongoRepository.voteHelpful("review-1", "voter-1", "helpful"),
    ).resolves.toEqual({
      helpfulCount: 1,
      notHelpfulCount: 0,
      myVote: "helpful",
    });

    expect(Review.findByIdAndUpdate).toHaveBeenCalledWith(
      "review-1",
      expect.any(Array),
      { new: true, updatePipeline: true },
    );
    expect(select).toHaveBeenCalledWith("+helpfulVoters +notHelpfulVoters");
  });
});

describe("reviewMongoRepository.findByProductId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the current user's vote without exposing voter arrays", async () => {
    const review = {
      _id: "review-1",
      helpfulVoters: ["viewer-1"],
      notHelpfulVoters: [],
    };
    const reviewsQuery = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maxTimeMS: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([review]),
    };
    const countQuery = {
      maxTimeMS: vi.fn().mockResolvedValue(1),
    };
    Review.find.mockReturnValue(reviewsQuery);
    Review.countDocuments.mockReturnValue(countQuery);

    const result = await reviewMongoRepository.findByProductId({
      productId: "product-1",
      page: 1,
      limit: 10,
      sort: "helpful",
      userId: "viewer-1",
    });

    expect(reviewsQuery.select).toHaveBeenCalledWith(
      "+helpfulVoters +notHelpfulVoters",
    );
    expect(result.reviews).toEqual([{ _id: "review-1", myVote: "helpful" }]);
    expect(result.total).toBe(1);
  });
});
