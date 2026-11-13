import { Router } from "express";
import { uploadController } from "./upload.controller.js";
import { authenticate, authorize } from "../../shared/middlewares/authenticate.middleware.js";
import { uploadVideo } from "../../shared/middlewares/upload.middleware.js";

const router = Router();

router.post("/presign", authenticate, uploadController.getPresignedUrl);

router.post(
  "/video/category",
  authenticate, authorize("ADMIN"),
  uploadVideo,
  uploadController.uploadCategoryVideo,
);

export default router;
