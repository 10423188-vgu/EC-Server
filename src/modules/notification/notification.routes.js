import { Router } from "express";
import { notificationController } from "./notification.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { notificationSchema } from "./notification.schema.js";

const router = Router();

router.get("/", authenticate, validate(notificationSchema.list), notificationController.list);
router.patch("/read-all", authenticate, notificationController.markAllRead);
router.patch("/:id/read", authenticate, validate(notificationSchema.markRead), notificationController.markRead);

export default router;
