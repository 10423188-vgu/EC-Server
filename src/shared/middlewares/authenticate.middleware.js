import { verifyAccessToken } from "../utils/jwt.util.js";
import { sessionRedisRepository } from "../../modules/auth/session.redis.repository.js";
import { UnauthorizedError, ForbiddenError } from "../errors/app.error.js";
import { authPrismaRepository } from "../../modules/auth/auth.prisma.repository.js";

export const authenticate = async (req, res, next) => {
  const token = req.cookies?.access_token;
  if (!token) return next(new UnauthorizedError("No token provided"));

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    return next(new UnauthorizedError("Invalid or expired token"));
  }
  try {
    if (!decoded.sessionId)
      return next(new UnauthorizedError("Session revoked. Sign in again."));
    // why: DB state enforces immediate suspension/role changes. Running its read
    // with the Redis session check removes one serial network wait.
    const [state, isSessionActive] = await Promise.all([
      authPrismaRepository.findAccessState(decoded.id),
      sessionRedisRepository.isSessionActive(decoded.id, decoded.sessionId),
    ]);
    if (!isSessionActive)
      return next(new UnauthorizedError("Session revoked. Sign in again."));
    if (
      !state ||
      (decoded.sessionVersion ?? 0) !== (state.sessionVersion ?? 0)
    ) {
      return next(new UnauthorizedError("Session revoked. Sign in again."));
    }
    if (state.suspendedAt)
      return next(
        new ForbiddenError(
          "This account is suspended. Contact support for help.",
        ),
      );
    req.userId = decoded.id;
    req.userRole = state.role;
    req.sessionId = decoded.sessionId;
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuthenticate = (req, res, next) => {
  if (!req.cookies?.access_token) return next();

  return authenticate(req, res, (error) => {
    if (error instanceof UnauthorizedError) return next();
    next(error);
  });
};

export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return next(new ForbiddenError("Insufficient permissions"));
    }
    next();
  };
