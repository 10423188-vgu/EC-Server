import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../errors/app.error.js";
import { logger } from "../utils/logger.js";

const PRISMA_ERROR_MAP = {
  P2002: { statusCode: 409, code: "CONFLICT", message: "Resource already exists" },
  P2025: { statusCode: 404, code: "NOT_FOUND", message: "Resource not found" },
  P2003: { statusCode: 400, code: "BAD_REQUEST", message: "Related resource not found" },
};

export const errorHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: error.flatten().fieldErrors,
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  const prismaError = error instanceof Prisma.PrismaClientKnownRequestError
    ? PRISMA_ERROR_MAP[error.code]
    : undefined;
  if (prismaError) {
    return res.status(prismaError.statusCode).json({
      success: false,
      code: prismaError.code,
      message: prismaError.message,
    });
  }

  // NOTE: Mongo error code 11000 = duplicate key (e.g. slug/SKU unique index)
  // why: field name only surfaces in development, to avoid leaking internal schema details in prod responses
  if (error.name === "MongoServerError" && error.code === 11000) {
    const field = process.env.NODE_ENV === "development"
      ? Object.keys(error.keyValue ?? {})[0] ?? "field"
      : null;
    return res.status(409).json({
      success: false,
      code: "CONFLICT",
      message: field ? `Duplicate value for ${field}` : "Resource already exists",
    });
  }

  if (error.name === "CastError") {
    const path = process.env.NODE_ENV === "development" ? ` "${error.path}"` : "";
    return res.status(400).json({
      success: false,
      code: "BAD_REQUEST",
      message: `Invalid value${path}`,
    });
  }

  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: messages.join(", "),
    });
  }

  logger.error({ err: error, requestId: req.requestId, url: req.originalUrl });

  return res.status(500).json({
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
  });
};
