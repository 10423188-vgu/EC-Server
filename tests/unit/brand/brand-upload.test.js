import { describe, expect, it, vi } from "vitest";
import { uploadService } from "../../../src/modules/upload/upload.service.js";
vi.mock("../../../src/configs/integrations/cloudinary.js", () => ({
  default: {
    utils: { api_sign_request: vi.fn().mockReturnValue("signature") },
  },
}));
vi.mock("../../../src/shared/utils/cloudinary.util.js", () => ({
  uploadVideoToCloudinary: vi.fn(),
}));
describe("brand logo upload permission", () => {
  it("allows admin to obtain a signed brand folder upload", () => {
    expect(uploadService.getPresignedUpload("brands", "ADMIN")).toMatchObject({
      folder: "brands",
      signature: "signature",
    });
  });
  it("rejects self-service users uploading brand logos", () => {
    expect(() => uploadService.getPresignedUpload("brands", "USER")).toThrow(
      "Insufficient permissions",
    );
  });
});
