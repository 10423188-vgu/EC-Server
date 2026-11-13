import { brandService } from "./brand.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const brandController = {
  overview: asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await brandService.overview() });
  }),
  listAdmin: asyncHandler(async (req, res) => {
    sendSuccess(res, await brandService.listAdmin(req.query));
  }),
  getBrands: asyncHandler(async (req, res) => {
    const brands = await brandService.getBrands(req.query);
    sendSuccess(res, { message: "Brands fetched successfully", data: brands });
  }),

  getBrandBySlug: asyncHandler(async (req, res) => {
    const brand = await brandService.getBrandBySlug(req.params.slug);
    sendSuccess(res, { message: "Brand fetched successfully", data: brand });
  }),

  getBrandById: asyncHandler(async (req, res) => {
    const brand = await brandService.getBrandById(req.params.id);
    sendSuccess(res, { message: "Brand fetched successfully", data: brand });
  }),

  createBrand: asyncHandler(async (req, res) => {
    const brand = await brandService.createBrand(req.body);
    sendSuccess(res, { statusCode: 201, message: "Brand created successfully", data: brand });
  }),

  updateBrand: asyncHandler(async (req, res) => {
    const brand = await brandService.updateBrand(req.params.id, req.body);
    sendSuccess(res, { message: "Brand updated successfully", data: brand });
  }),

  deleteBrand: asyncHandler(async (req, res) => {
    await brandService.deleteBrand(req.params.id);
    sendSuccess(res, { message: "Brand deleted successfully" });
  }),
};
