import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authenticate,
  authorize,
} from "../../../src/shared/middlewares/authenticate.middleware.js";
import { sessionRedisRepository } from "../../../src/modules/auth/session.redis.repository.js";
import { verifyAccessToken } from "../../../src/shared/utils/jwt.util.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../../../src/shared/errors/app.error.js";
import { authPrismaRepository } from "../../../src/modules/auth/auth.prisma.repository.js";

vi.mock("../../../src/modules/auth/auth.prisma.repository.js", () => ({
  authPrismaRepository: { findAccessState: vi.fn() },
}));

vi.mock("../../../src/modules/auth/session.redis.repository.js", () => ({
  sessionRedisRepository: { isSessionActive: vi.fn() },
}));

vi.mock("../../../src/shared/utils/jwt.util.js", () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock("../../../src/shared/utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const makeReq = (token) => ({ cookies: token ? { access_token: token } : {} });

beforeEach(() => {
  vi.resetAllMocks();
  verifyAccessToken.mockReturnValue({ id: "u1", role: "CUSTOMER", sessionId: "s1" });
  sessionRedisRepository.isSessionActive.mockResolvedValue(1);
  authPrismaRepository.findAccessState.mockResolvedValue({
    role: "CUSTOMER",
    suspendedAt: null,
    sessionVersion: 0,
  });
});

describe("authenticate", () => {
  it("starts the session check while the account-state query is still pending", async () => {
    let resolveState;
    authPrismaRepository.findAccessState.mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve;
      }),
    );
    const next = vi.fn();
    const request = authenticate(makeReq("valid-tok"), {}, next);
    expect(sessionRedisRepository.isSessionActive).toHaveBeenCalledWith(
      "u1",
      "s1",
    );
    expect(next).not.toHaveBeenCalled();
    resolveState({ role: "CUSTOMER", suspendedAt: null, sessionVersion: 0 });
    await request;
    expect(next).toHaveBeenCalledWith();
  });
  it("rejects suspended accounts even with a valid JWT", async () => {
    verifyAccessToken.mockReturnValue({ id: "u1", role: "CUSTOMER", sessionId: "s1" });
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "CUSTOMER",
      suspendedAt: new Date(),
      sessionVersion: 0,
    });
    const next = vi.fn();
    await authenticate(makeReq("valid-tok"), {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("rejects sessions issued before a suspension even after restoration", async () => {
    verifyAccessToken.mockReturnValue({
      id: "u1",
      role: "CUSTOMER",
      sessionVersion: 0,
      sessionId: "s1",
    });
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "CUSTOMER",
      suspendedAt: null,
      sessionVersion: 1,
    });
    const next = vi.fn();
    await authenticate(makeReq("old-tok"), {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("uses the database role instead of a stale admin role in the JWT", async () => {
    verifyAccessToken.mockReturnValue({ id: "u1", role: "ADMIN", sessionId: "s1" });
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "CUSTOMER",
      suspendedAt: null,
      sessionVersion: 0,
    });
    const request = makeReq("valid-tok");
    await authenticate(request, {}, vi.fn());
    expect(request.userRole).toBe("CUSTOMER");
  });

  it("passes database outages to the error handler instead of authenticating", async () => {
    verifyAccessToken.mockReturnValue({ id: "u1", role: "CUSTOMER", sessionId: "s1" });
    const error = new Error("Database unavailable");
    authPrismaRepository.findAccessState.mockRejectedValue(error);
    const next = vi.fn();
    await authenticate(makeReq("valid-tok"), {}, next);
    expect(next).toHaveBeenCalledWith(error);
  });
  it("rejects when no access token cookie is present", async () => {
    const next = vi.fn();

    await authenticate(makeReq(null), {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("requires a session ID in the access token", async () => {
    verifyAccessToken.mockReturnValue({ id: "u1", role: "CUSTOMER" });
    const next = vi.fn();

    await authenticate(makeReq("legacy-tok"), {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(sessionRedisRepository.isSessionActive).not.toHaveBeenCalled();
  });

  it("rejects an access token after its session is revoked", async () => {
    sessionRedisRepository.isSessionActive.mockResolvedValue(0);
    const next = vi.fn();

    await authenticate(makeReq("logged-out-tok"), {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Session revoked. Sign in again." }),
    );
    expect(verifyAccessToken).toHaveBeenCalledWith("logged-out-tok");
  });

  it("fails closed when session storage is unavailable", async () => {
    const error = new Error("ECONNREFUSED");
    sessionRedisRepository.isSessionActive.mockRejectedValue(error);
    verifyAccessToken.mockReturnValue({ id: "u1", role: "CUSTOMER", sessionId: "s1" });
    const req = makeReq("valid-tok");
    const next = vi.fn();

    await authenticate(req, {}, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(req.userId).toBeUndefined();
  });

  it("rejects an invalid or expired token", async () => {
    verifyAccessToken.mockImplementation(() => {
      throw new Error("jwt expired");
    });
    const next = vi.fn();

    await authenticate(makeReq("expired-tok"), {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid or expired token" }),
    );
    expect(authPrismaRepository.findAccessState).not.toHaveBeenCalled();
    expect(
      sessionRedisRepository.isSessionActive,
    ).not.toHaveBeenCalled();
  });

  it("attaches userId, role and sessionId on a valid token", async () => {
    verifyAccessToken.mockReturnValue({ id: "u1", role: "ADMIN", sessionId: "s1" });
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "ADMIN",
      suspendedAt: null,
      sessionVersion: 0,
    });
    const req = makeReq("valid-tok");
    const next = vi.fn();

    await authenticate(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.userId).toBe("u1");
    expect(req.userRole).toBe("ADMIN");
    expect(req.sessionId).toBe("s1");
  });
});

describe("authorize", () => {
  it("rejects a role that is not in the allowed list", () => {
    const next = vi.fn();

    authorize("ADMIN")({ userRole: "CUSTOMER" }, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("allows a role that is in the allowed list", () => {
    const next = vi.fn();

    authorize("ADMIN", "CUSTOMER")({ userRole: "CUSTOMER" }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
