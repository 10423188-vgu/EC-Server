import cloudinary from "../../configs/integrations/cloudinary.js";
import { uploadVideoToCloudinary } from "../../shared/utils/cloudinary.util.js";
import { BadRequestError, ForbiddenError } from "../../shared/errors/app.error.js";

export const ALLOWED_FOLDERS = [
  "avatars",
  "banners",
  "categories",
  "brands",
  "products",
  "returns",
];
// why: avatars/banners are self-service (any authenticated user uploads their own);
// categories/brands/products are platform content and stay admin-only
const ADMIN_ONLY_FOLDERS = ["categories", "brands", "products"];

export const uploadService = {
  getPresignedUpload: (folder, userRole) => {
    if (!ALLOWED_FOLDERS.includes(folder)) {
      throw new BadRequestError(`Folder must be one of: ${ALLOWED_FOLDERS.join(", ")}`);
    }
    if (ADMIN_ONLY_FOLDERS.includes(folder) && userRole !== "ADMIN") {
      throw new ForbiddenError("Insufficient permissions");
    }

    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET,
    );

    return {
      timestamp,
      signature,
      folder,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
    };
  },

  uploadCategoryVideo: async (fileBuffer) => {
    if (!fileBuffer) throw new BadRequestError("No video file provided");
    const result = await uploadVideoToCloudinary(fileBuffer, "categories");
    return { url: result.secure_url };
  },
};
