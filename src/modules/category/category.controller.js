import { categoryService } from "./category.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const categoryController = {
  overview: asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await categoryService.overview() });
  }),
  listAdmin: asyncHandler(async (req, res) => {
    sendSuccess(res, await categoryService.listAdmin(req.query));
  }),

  parentOptions: asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await categoryService.parentOptions() });
  }),
  getCategories: asyncHandler(async (req, res) => {
    const categories = await categoryService.getCategories(req.query);
    sendSuccess(res, {
      message: "Categories fetched successfully",
      data: categories,
    });
  }),

  getCategoryBySlug: asyncHandler(async (req, res) => {
    const category = await categoryService.getCategoryBySlug(req.params.slug);
    sendSuccess(res, {
      message: "Category fetched successfully",
      data: category,
    });
  }),

  getCategoryById: asyncHandler(async (req, res) => {
    const category = await categoryService.getCategoryById(req.params.id);
    sendSuccess(res, {
      message: "Category fetched successfully",
      data: category,
    });
  }),

  createCategory: asyncHandler(async (req, res) => {
    const category = await categoryService.createCategory(req.body);
    sendSuccess(res, {
      statusCode: 201,
      message: "Category created successfully",
      data: category,
    });
  }),

  updateCategory: asyncHandler(async (req, res) => {
    const category = await categoryService.updateCategory(
      req.params.id,
      req.body,
    );
    sendSuccess(res, {
      message: "Category updated successfully",
      data: category,
    });
  }),

  deleteCategory: asyncHandler(async (req, res) => {
    await categoryService.deleteCategory(req.params.id);
    sendSuccess(res, { message: "Category deleted successfully" });
  }),
};
