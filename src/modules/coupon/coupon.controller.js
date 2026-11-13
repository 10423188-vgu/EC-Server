import { couponService } from "./coupon.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const couponController = {
  validate: asyncHandler(async (req, res) => {
    const result = await couponService.validate({
      userId: req.userId,
      code: req.body.code,
    });
    sendSuccess(res, { message: "Coupon is valid", data: result });
  }),

  create: asyncHandler(async (req, res) => {
    const coupon = await couponService.create(req.body);
    sendSuccess(res, { statusCode: 201, message: "Coupon created", data: coupon });
  }),

  update: asyncHandler(async (req, res) => {
    const coupon = await couponService.update(req.params.id, req.body);
    sendSuccess(res, { message: "Coupon updated", data: coupon });
  }),

  delete: asyncHandler(async (req, res) => {
    await couponService.delete(req.params.id);
    sendSuccess(res, { message: "Coupon deleted" });
  }),

  getById: asyncHandler(async (req, res) => {
    const coupon = await couponService.getById(req.params.id);
    sendSuccess(res, { message: "Coupon fetched", data: coupon });
  }),

  list: asyncHandler(async (req, res) => {
    const { page, limit, isActive, type } = req.query;
    const result = await couponService.list({ page, limit, isActive, type });
    res.status(200).json({ success: true, message: "Coupons fetched", ...result });
  }),
};
