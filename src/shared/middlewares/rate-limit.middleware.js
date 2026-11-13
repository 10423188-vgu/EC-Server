import { redisClient, redisCircuit } from "../../configs/cache/redis.js";
import { logger } from "../utils/logger.js";

// why: fixed window chosen over sliding window — simpler atomics, acceptable burst at boundary
// Lua script makes INCR + conditional EXPIRE atomic — prevents keys living forever if process crashes between the two commands
const INCREMENT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

export const rateLimit = (maxRequests = 100, windowSeconds = 60) => {
  return async (req, res, next) => {
    try {
      const ip = req.ip ?? req.socket.remoteAddress;
      const routeKey = req.path.split("/")[1] ?? "root";
      const redisKey = `rate:${ip}:${routeKey}`;

      const count = await redisCircuit.execute(() =>
        redisClient.eval(INCREMENT_SCRIPT, {
          keys: [redisKey],
          arguments: [String(windowSeconds)],
        }),
      );

      if (count > maxRequests) {
        const waitMinutes = Math.ceil(windowSeconds / 60);
        return res.status(429).json({
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: `Too many requests. Try again in up to ${waitMinutes} minutes.`,
        });
      }

      next();
    } catch (err) {
      logger.warn({ err }, "[rate-limit] Redis failure — failing open");
      next();
    }
  };
};
