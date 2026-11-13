import { notificationService } from "./notification.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const notificationController = {
  // why: not sendSuccess — client reads `pagination` at the response's top level, not
  // nested under `meta` (same convention as order.controller.js's list handler)
  list: asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await notificationService.list(req.userId, { page, limit });
    res.status(200).json({ success: true, message: "Notifications fetched", ...result });
  }),

  markRead: asyncHandler(async (req, res) => {
    await notificationService.markRead(req.userId, req.params.id);
    sendSuccess(res, { message: "Notification marked as read" });
  }),

  markAllRead: asyncHandler(async (req, res) => {
    await notificationService.markAllRead(req.userId);
    sendSuccess(res, { message: "All notifications marked as read" });
  }),
};
