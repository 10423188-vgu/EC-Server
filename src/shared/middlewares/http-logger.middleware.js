import { trace } from "@opentelemetry/api";
import { logger } from "../utils/logger.js";

export const httpLogger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    // why: lets a log line be pasted straight into the trace backend to see the full request timeline
    const spanContext = trace.getActiveSpan()?.spanContext();

    logger[level]({
      requestId: req.requestId,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: ms,
      ip: req.ip,
    });
  });

  next();
};
