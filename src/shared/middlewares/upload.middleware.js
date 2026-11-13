import multer from "multer";
import { BadRequestError } from "../errors/app.error.js";

const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

// why: memoryStorage buffers the file so it can be piped straight to Cloudinary with no temp
// file on disk; MAX_VIDEO_SIZE bounds how much memory a single request can hold
const storage = multer.memoryStorage();

export const uploadVideo = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      return cb(
        new BadRequestError("Only MP4, WebM and MOV videos are allowed"),
      );
    }
    cb(null, true);
  },
}).single("file");
