import { wishlistService } from "./wishlist.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const wishlistController = {
  getPreferences: asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");
    sendSuccess(res, {
      data: await wishlistService.getPreferences(req.userId),
    });
  }),
  updatePreferences: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      data: await wishlistService.updatePreferences(
        req.userId,
        req.body.saleAlerts,
      ),
    });
  }),
  enableSharing: asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await wishlistService.enableSharing(req.userId) });
  }),
  disableSharing: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      data: await wishlistService.disableSharing(req.userId),
    });
  }),
  getSharedWishlist: asyncHandler(async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    });
    sendSuccess(res, {
      data: await wishlistService.getSharedWishlist(
        req.params.token,
        req.query,
      ),
    });
  }),
  getWishlist: asyncHandler(async (req, res) => {
    const result = await wishlistService.getPaginatedWishlist(req.userId, req.query);
    sendSuccess(res, { message: "Wishlist fetched successfully", data: result });
  }),

  clearWishlist: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      message: "Wishlist cleared successfully",
      data: await wishlistService.clearWishlist(req.userId),
    });
  }),

  getWishlistIds: asyncHandler(async (req, res) => {
    const ids = await wishlistService.getWishlistIds(req.userId, req.query.productIds);
    sendSuccess(res, { message: "Wishlist IDs fetched", data: ids });
  }),

  toggleWishlist: asyncHandler(async (req, res) => {
    const result = await wishlistService.toggleWishlist(
      req.userId,
      req.params.productId,
    );
    sendSuccess(res, {
      message: result.added ? "Added to wishlist" : "Removed from wishlist",
      data: result,
    });
  }),
};
