import { Review } from "../../models/review.model.js";
import { Product } from "../../models/product.model.js";

const EMPTY_STATS = {
  count: 0,
  average: 0,
  distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
};

const SORT_MAP = {
  recent: { createdAt: -1 },
  helpful: { helpfulCount: -1, createdAt: -1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
};

export const reviewMongoRepository = {
  productExists: (productId) =>
    Product.exists({ _id: productId, deletedAt: null }).then(Boolean),

  // why: aggregates live from Review collection instead of reading Product.reviewStats,
  // so counts are always fresh even if the cached denormalized field hasn't been refreshed yet
  getStats: async (productId) => {
    const [result] = await Review.aggregate([
      { $match: { productId, status: "APPROVED" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          average: { $avg: "$rating" },
          d1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
          d2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
          d3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
          d4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
          d5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
        },
      },
    ]).option({ maxTimeMS: 10_000 });
    if (!result) return EMPTY_STATS;
    return {
      count: result.count,
      average: parseFloat(result.average.toFixed(1)),
      distribution: {
        1: result.d1,
        2: result.d2,
        3: result.d3,
        4: result.d4,
        5: result.d5,
      },
    };
  },

  findByProductId: async ({
    productId,
    page,
    limit,
    sort,
    rating,
    userId,
    status = "APPROVED",
  }) => {
    const filter = { productId, status };
    if (rating) filter.rating = rating;

    const skip = (page - 1) * limit;
    const sortOpt = SORT_MAP[sort] ?? SORT_MAP.helpful;
    const reviewsQuery = Review.find(filter)
      .sort(sortOpt)
      .skip(skip)
      .limit(limit);
    if (userId) reviewsQuery.select("+helpfulVoters +notHelpfulVoters");

    const [reviews, total] = await Promise.all([
      reviewsQuery
        .maxTimeMS(10_000)
        .lean(),
      Review.countDocuments(filter).maxTimeMS(10_000),
    ]);

    return {
      reviews: reviews.map((review) => {
        const myVote = userId
          ? review.helpfulVoters?.includes(userId)
            ? "helpful"
            : review.notHelpfulVoters?.includes(userId)
              ? "not_helpful"
              : null
          : null;
        const { helpfulVoters, notHelpfulVoters, ...publicReview } = review;
        return { ...publicReview, myVote };
      }),
      total,
    };
  },

  findById: (id) => Review.findById(id).lean(),

  findByUserAndProduct: (userId, productId) =>
    Review.findOne({ userId, productId }).lean(),

  findMyReviews: async (userId, { page, limit }) => {
    const skip = (page - 1) * limit;
    const [reviews, total] = await Promise.all([
      Review.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .maxTimeMS(10_000)
        .lean(),
      Review.countDocuments({ userId }).maxTimeMS(10_000),
    ]);
    return { reviews, total };
  },

  countByUser: (userId) => Review.countDocuments({ userId }),

  create: (data) => Review.create(data),

  update: (id, data) =>
    Review.findByIdAndUpdate(id, { $set: data }, { new: true }).lean(),

  delete: (id) => Review.findByIdAndDelete(id).lean(),

  // why: submitting the same vote again clears it instead of being a no-op
  // NOTE: returns null when review not found, "SELF_VOTE" sentinel when the voter is the author
  // why: this is a single aggregation-pipeline update (not a read-then-write) so the toggle
  // and the recomputed counts are atomic against the document's *current* state — two
  // concurrent votes from the same user (e.g. a double-click) can no longer both read
  // "not voted yet" and both push/increment, which used to duplicate the voter id and
  // inflate the count.
  voteHelpful: async (reviewId, userId, vote) => {
    const review = await Review.findById(reviewId, { userId: 1 }).lean();
    if (!review) return null;

    if (review.userId === userId) return "SELF_VOTE";

    const [voteField, otherField] =
      vote === "helpful"
        ? ["helpfulVoters", "notHelpfulVoters"]
        : ["notHelpfulVoters", "helpfulVoters"];

    const updatedReview = await Review.findByIdAndUpdate(
      reviewId,
      [
        {
          $set: {
            [voteField]: {
              $cond: [
                { $in: [userId, `$${voteField}`] },
                {
                  $filter: {
                    input: `$${voteField}`,
                    cond: { $ne: ["$$this", userId] },
                  },
                },
                { $concatArrays: [`$${voteField}`, [userId]] },
              ],
            },
            [otherField]: {
              $filter: {
                input: `$${otherField}`,
                cond: { $ne: ["$$this", userId] },
              },
            },
          },
        },
        {
          $set: {
            helpfulCount: { $size: "$helpfulVoters" },
            notHelpfulCount: { $size: "$notHelpfulVoters" },
          },
        },
      ],
      { new: true, updatePipeline: true },
    )
      .select("+helpfulVoters +notHelpfulVoters")
      .lean();
    if (!updatedReview) return null;

    const myVote = updatedReview.helpfulVoters.includes(userId)
      ? "helpful"
      : updatedReview.notHelpfulVoters.includes(userId)
        ? "not_helpful"
        : null;

    return {
      helpfulCount: updatedReview.helpfulCount,
      notHelpfulCount: updatedReview.notHelpfulCount,
      myVote,
    };
  },

  updateProductStats: async (productId) => {
    const stats = await reviewMongoRepository.getStats(productId);
    await Product.findByIdAndUpdate(productId, {
      $set: { reviewStats: stats },
    });
    return stats;
  },

  addAdminResponse: (id, body) =>
    Review.findByIdAndUpdate(
      id,
      { $set: { adminResponse: { body, respondedAt: new Date() } } },
      { new: true },
    ).lean(),

  updateStatus: (id, status) =>
    Review.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean(),

  findAll: async ({ page, limit, status, productId, userId }) => {
    const filter = {};
    if (status) filter.status = status;
    if (productId) filter.productId = productId;
    if (userId) filter.userId = userId;

    const skip = (page - 1) * limit;
    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .maxTimeMS(10_000)
        .lean(),
      Review.countDocuments(filter).maxTimeMS(10_000),
    ]);
    return { reviews, total };
  },
};
