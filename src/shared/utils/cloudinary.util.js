import cloudinary from "../../configs/integrations/cloudinary.js";
import { logger } from "./logger.js";

const CLOUDINARY_HOST = "res.cloudinary.com";

// why: splitting by filename alone breaks with versioned URLs (e.g. /upload/v1234/folder/file.jpg)
// and nested folder paths — must parse from the /upload/ boundary instead
const extractPublicId = (url) => {
  const uploadIndex = url.indexOf("/upload/");
  if (uploadIndex === -1) return null;
  const afterUpload = url
    .slice(uploadIndex + 8)
    .replace(/^(?:[^/]+,)+[^/]+\//, "");
  const withoutVersion = afterUpload.replace(/^v\d+\//, "");
  const dotIndex = withoutVersion.lastIndexOf(".");
  return dotIndex !== -1 ? withoutVersion.slice(0, dotIndex) : withoutVersion;
};

// why: a client-supplied URL must never be trusted at face value for a destructive
// operation — restrict to our own Cloudinary cloud AND the folder the caller expects,
// so it can't point at an external host or at another module's/user's asset.
export const isOwnCloudinaryUrl = (url, folder) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== CLOUDINARY_HOST) return false;
    if (parsed.pathname.split("/")[1] !== process.env.CLOUDINARY_CLOUD_NAME) return false;
    const publicId = extractPublicId(url);
    return !!publicId && publicId.startsWith(`${folder}/`);
  } catch {
    return false;
  }
};

export const deleteFromCloudinary = async (url, folder) => {
  try {
    if (!isOwnCloudinaryUrl(url, folder)) {
      logger.warn(
        { url, folder },
        "[Cloudinary] deletion skipped — URL is not our own asset in the expected folder",
      );
      return;
    }
    const publicId = extractPublicId(url);
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    logger.error({ err: error }, "[Cloudinary] deletion error");
  }
};


export const uploadVideoToCloudinary = (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder,
        transformation: [
          { width: 1280, height: 720, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(fileBuffer);
  });
};
