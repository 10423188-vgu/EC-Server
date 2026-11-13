import { Router } from "express";
import { searchController } from "./search.controller.js";
import { authenticate, authorize } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { searchSchema } from "./search.schema.js";

const router = Router();

router.get(
  "/",
  validate(searchSchema.search),
  searchController.search
);

router.get(
  "/suggest",
  validate(searchSchema.suggest),
  searchController.suggest
);

router.get("/trending", searchController.trending);

router.post(
  "/reindex",
  authenticate,
  authorize("ADMIN"),
  searchController.reindex
);

export default router;
