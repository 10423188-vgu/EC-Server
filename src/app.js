import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import router from "./routes.js";
import { errorHandler } from "./shared/middlewares/error-handler.middleware.js";
import { requestId } from "./shared/middlewares/request-id.middleware.js";
import { httpLogger } from "./shared/middlewares/http-logger.middleware.js";
import { rateLimit } from "./shared/middlewares/rate-limit.middleware.js";
import { asyncHandler } from "./shared/middlewares/async-handler.middleware.js";
import { getHealthStatus } from "./shared/utils/health.util.js";

const app = express();

// why: required so req.ip returns the real client IP when running behind nginx/load balancer
app.set("trust proxy", 1);

app.use(helmet());
// why: fallback to localhost so CORS never silently allows all origins when CLIENT_URL is missing
app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173", credentials: true }));
app.use(requestId);
app.use(httpLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// why: outside /api/v1 so load balancer/k8s probes skip rate limiting and CORS entirely
app.get(
  "/healthz",
  asyncHandler(async (_req, res) => {
    const health = await getHealthStatus();
    res.status(health.healthy ? 200 : 503).json(health);
  })
);

// why: mount rate limit inside /api/v1 so req.path is stripped of prefix — rate-limit key becomes module name (auth, products...)
app.use("/api/v1", rateLimit(200, 60), router);

app.use((_req, res) => res.status(404).json({ success: false, code: "NOT_FOUND", message: "Route not found" }));
app.use(errorHandler);

export default app;
