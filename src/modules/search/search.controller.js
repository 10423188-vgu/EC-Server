import { searchService } from "./search.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const searchController = {
  search: asyncHandler(async (req, res) => {
    // NOTE: query params are already parsed/transformed by searchSchema (validate middleware)
    const { q, categorySlug, categorySlugs, brandSlug, tags, minPrice, maxPrice, minRating, inStock, isFeatured, sort, page, limit } = req.query;

    // why: categorySlugs (array) takes priority; categorySlug (single) kept for backwards compat
    const resolvedCategorySlugs = categorySlugs?.length
      ? categorySlugs
      : categorySlug
      ? [categorySlug]
      : undefined;

    const result = await searchService.search({
      q,
      filters: { categorySlugs: resolvedCategorySlugs, brandSlug, tags, minPrice, maxPrice, minRating, inStock, isFeatured },
      sort,
      page,
      limit,
    });

    res.status(200).json({ success: true, message: "Search results", ...result });
  }),

  suggest: asyncHandler(async (req, res) => {
    const suggestions = await searchService.suggest(req.query.q);
    sendSuccess(res, { message: "Suggestions fetched", data: suggestions });
  }),

  trending: asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 6, 12);
    const data = await searchService.trending(limit);
    sendSuccess(res, { message: "Trending searches", data });
  }),

  reindex: asyncHandler(async (req, res) => {
    const result = await searchService.reindex();
    sendSuccess(res, { message: "Reindex completed", data: result });
  }),
};
