import { cartService } from "./cart.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const cartController = {
  getCart: asyncHandler(async (req, res) => {
    const items = await cartService.getCart(req.userId);
    sendSuccess(res, { message: "Cart fetched successfully", data: items });
  }),

  addItem: asyncHandler(async (req, res) => {
    const { variantId } = req.body;
    const result = await cartService.addItem(req.userId, variantId);
    sendSuccess(res, { message: "Item added to cart", data: result });
  }),

  upsertItem: asyncHandler(async (req, res) => {
    const { variantId, quantity } = req.body;
    const result = await cartService.upsertItem(req.userId, variantId, quantity);
    sendSuccess(res, { message: "Cart updated", data: result });
  }),

  removeItem: asyncHandler(async (req, res) => {
    await cartService.removeItem(req.userId, req.params.variantId);
    sendSuccess(res, { message: "Item removed from cart" });
  }),

  clearCart: asyncHandler(async (req, res) => {
    await cartService.clearCart(req.userId);
    sendSuccess(res, { message: "Cart cleared" });
  }),
};
