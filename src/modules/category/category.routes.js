import { Router } from "express";
import { categoryController  } from "./category.controller.js";
import { authenticate, authorize } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { categorySchema } from "./category.schema.js";
import { catalogListSchema } from "../../shared/catalog/catalog-admin.js";

const router = Router();

router.get(
  "/admin/overview",
  authenticate,
  authorize("ADMIN"),
  categoryController.overview,
);

router.get(
  "/admin/list",
  authenticate,
  authorize("ADMIN"),
  validate(catalogListSchema),
  categoryController.listAdmin,
);
router.get(
  "/admin/options",
  authenticate,
  authorize("ADMIN"),
  categoryController.parentOptions,
);

router.get(
  "/",
  validate(categorySchema.getCategories),
  categoryController.getCategories,
);
router.get(
  "/:slug",
  validate(categorySchema.getCategoryBySlug),
  categoryController.getCategoryBySlug,
);

router.get(
  "/admin/:id",
  authenticate, authorize("ADMIN"),
  validate(categorySchema.getCategoryById),
  categoryController.getCategoryById,
);
router.post(
  "/",
  authenticate, authorize("ADMIN"),
  validate(categorySchema.createCategory),
  categoryController.createCategory,
);
router.put(
  "/:id",
  authenticate, authorize("ADMIN"),
  validate(categorySchema.updateCategory),
  categoryController.updateCategory,
);
router.delete(
  "/:id",
  authenticate, authorize("ADMIN"),
  validate(categorySchema.deleteCategory),
  categoryController.deleteCategory,
);

export default router;
