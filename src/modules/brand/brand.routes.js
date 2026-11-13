import { Router } from "express";
import { brandController } from "./brand.controller.js";
import { authenticate, authorize } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { brandSchema } from "./brand.schema.js";
import { catalogListSchema } from "../../shared/catalog/catalog-admin.js";

const router = Router();

router.get(
  "/admin/overview",
  authenticate,
  authorize("ADMIN"),
  brandController.overview,
);

router.get(
  "/admin/list",
  authenticate,
  authorize("ADMIN"),
  validate(catalogListSchema),
  brandController.listAdmin,
);

router.get("/", validate(brandSchema.getBrands), brandController.getBrands);
router.get("/:slug", validate(brandSchema.getBrandBySlug), brandController.getBrandBySlug);

router.get(
  "/admin/:id",
  authenticate, authorize("ADMIN"),
  validate(brandSchema.getBrandById),
  brandController.getBrandById,
);
router.post(
  "/",
  authenticate, authorize("ADMIN"),
  validate(brandSchema.createBrand),
  brandController.createBrand,
);
router.put(
  "/:id",
  authenticate, authorize("ADMIN"),
  validate(brandSchema.updateBrand),
  brandController.updateBrand,
);
router.delete(
  "/:id",
  authenticate, authorize("ADMIN"),
  validate(brandSchema.deleteBrand),
  brandController.deleteBrand,
);

export default router;
