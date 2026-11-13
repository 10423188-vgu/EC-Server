import { uploadService } from "./upload.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const uploadController = {
  getPresignedUrl: asyncHandler(async (req, res) => {
    const data = uploadService.getPresignedUpload(req.body.folder, req.userRole);
    sendSuccess(res, { data });
  }),

  uploadCategoryVideo: asyncHandler(async (req, res) => {
    const data = await uploadService.uploadCategoryVideo(req.file?.buffer);
    sendSuccess(res, { statusCode: 201, message: "Video uploaded successfully", data });
  }),
};
