import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { orderService } from "./order.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";
import { BadRequestError } from "../../shared/errors/app.error.js";

export const orderController = {
  checkout: asyncHandler(async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new BadRequestError(
        "Idempotency-Key must be at most 128 characters",
      );
    }
    const result = await orderService.checkout({
      userId: req.userId,
      addressId: req.body.addressId,
      couponCode: req.body.couponCode,
      note: req.body.note,
      idempotencyKey,
    });
    sendSuccess(res, {
      statusCode: 201,
      message: "Order created",
      data: result,
    });
  }),

  list: asyncHandler(async (req, res) => {
    const { page, limit, status } = req.query;
    const result = await orderService.getOrders(req.userId, {
      page,
      limit,
      status,
    });
    res
      .status(200)
      .json({ success: true, message: "Orders fetched", ...result });
  }),

  getById: asyncHandler(async (req, res) => {
    const order = await orderService.getOrderById(req.params.id, req.userId);
    sendSuccess(res, { message: "Order fetched", data: order });
  }),

  cancel: asyncHandler(async (req, res) => {
    const result = await orderService.cancelOrder(req.params.id, req.userId);
    sendSuccess(res, { message: "Order cancelled", data: result });
  }),

  // ─── Admin ──────────────────────────────────────────────────────────────────
  adminList: asyncHandler(async (req, res) => {
    const result = await orderService.adminListOrders(req.query);
    res
      .status(200)
      .json({ success: true, message: "Orders fetched", ...result });
  }),

  adminMetrics: asyncHandler(async (req, res) => {
    const metrics = await orderService.adminGetMetrics(req.query);
    sendSuccess(res, { message: "Order metrics fetched", data: metrics });
  }),

  adminAnalytics: asyncHandler(async (req, res) => {
    const analytics = await orderService.adminGetAnalytics(req.query);
    sendSuccess(res, { message: "Analytics fetched", data: analytics });
  }),

  adminSelected: asyncHandler(async (req, res) => {
    const orders = await orderService.adminGetSelected(req.body.ids);
    sendSuccess(res, { message: "Selected orders fetched", data: orders });
  }),

  adminExportSelected: asyncHandler(async (req, res) => {
    await orderService.adminValidateSelected(req.body.ids);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="orders-selected.csv"',
    });
    try {
      await pipeline(
        Readable.from(orderService.adminExportSelectedCsv(req.body.ids)),
        res,
      );
    } catch (error) {
      if (error.code === "ERR_STREAM_PREMATURE_CLOSE") return;
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      throw error;
    }
  }),

  adminExport: asyncHandler(async (req, res) => {
    res.status(200).set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="orders.csv"',
    });
    try {
      await pipeline(
        Readable.from(orderService.adminExportCsv(req.query)),
        res,
      );
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      throw error;
    }
  }),

  adminGetById: asyncHandler(async (req, res) => {
    const order = await orderService.adminGetOrderById(req.params.id);
    sendSuccess(res, { message: "Order fetched", data: order });
  }),

  adminUpdateStatus: asyncHandler(async (req, res) => {
    const order = await orderService.adminUpdateStatus(
      req.params.id,
      req.body.status,
      req.userId,
      req.body.reason,
    );
    sendSuccess(res, { message: "Order status updated", data: order });
  }),

  adminUpdateShipping: asyncHandler(async (req, res) => {
    const order = await orderService.adminUpdateShipping(
      req.params.id,
      req.body,
    );
    sendSuccess(res, { message: "Shipping information updated", data: order });
  }),

  adminCancel: asyncHandler(async (req, res) => {
    const result = await orderService.adminCancelOrder(
      req.params.id,
      req.userId,
      req.body.reason,
    );
    sendSuccess(res, { message: "Order cancelled", data: result });
  }),

  adminRefund: asyncHandler(async (req, res) => {
    const order = await orderService.adminRefundOrder(
      req.params.id,
      req.body,
      req.userId,
    );
    sendSuccess(res, { message: "Refund recorded", data: order });
  }),
};
