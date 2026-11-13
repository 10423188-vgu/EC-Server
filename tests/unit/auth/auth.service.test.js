import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { authService } from "../../../src/modules/auth/auth.service.js";
import { authPrismaRepository } from "../../../src/modules/auth/auth.prisma.repository.js";
import { sessionRedisRepository } from "../../../src/modules/auth/session.redis.repository.js";
import { userService } from "../../../src/modules/user/user.service.js";
import { userPrismaRepository } from "../../../src/modules/user/user.prisma.repository.js";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../../src/shared/utils/jwt.util.js";
import {
  sendResetPasswordEmail,
  sendVerificationEmail,
} from "../../../src/shared/utils/mail.util.js";
import googleAuthClient from "../../../src/configs/integrations/googleAuth.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../../../src/shared/errors/app.error.js";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}));

vi.mock("../../../src/modules/auth/auth.prisma.repository.js", () => ({
  authPrismaRepository: {
    findByEmail: vi.fn(),
    findByEmailWithPassword: vi.fn(),
    findAccessState: vi.fn(),
    create: vi.fn(),
    findByGoogleId: vi.fn(),
    findByEmailForGoogle: vi.fn(),
    createFromGoogle: vi.fn(),
    linkGoogleId: vi.fn(),
  },
}));

vi.mock("../../../src/configs/integrations/googleAuth.js", () => ({
  default: { verifyIdToken: vi.fn() },
}));

vi.mock("../../../src/modules/auth/session.redis.repository.js", () => ({
  sessionRedisRepository: {
    createSession: vi.fn(),
    rotateSession: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
    listSessions: vi.fn(),
    deleteAllSessions: vi.fn(),
    saveResetToken: vi.fn(),
    consumeResetToken: vi.fn(),
    saveEmailVerifyToken: vi.fn(),
    consumeEmailVerifyToken: vi.fn(),
    saveTwoFactorChallenge: vi.fn(),
    getTwoFactorChallenge: vi.fn(),
    consumeTwoFactorChallenge: vi.fn(),
  },
}));

vi.mock("../../../src/shared/utils/jwt.util.js", () => ({
  generateAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
}));

vi.mock("../../../src/modules/user/user.service.js", () => ({
  userService: { getProfile: vi.fn() },
}));

vi.mock("../../../src/modules/user/user.prisma.repository.js", () => ({
  userPrismaRepository: {
    update: vi.fn(),
    findById: vi.fn(),
    findEmailOwner: vi.fn(),
    findEmailOwner: vi.fn(),
    findTwoFactorById: vi.fn(),
    consumeTwoFactorRecoveryCode: vi.fn(),
  },
}));

vi.mock("../../../src/shared/utils/mail.util.js", () => ({
  sendResetPasswordEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.resetAllMocks();
  sessionRedisRepository.deleteAllSessions.mockResolvedValue(undefined);
  authPrismaRepository.findAccessState.mockResolvedValue({
    role: "CUSTOMER",
    suspendedAt: null,
    sessionVersion: 0,
  });
  sendResetPasswordEmail.mockResolvedValue(undefined);
  sendVerificationEmail.mockResolvedValue(undefined);
});

describe("authService.register", () => {
  it("throws ConflictError when the email is already registered", async () => {
    authPrismaRepository.findByEmail.mockResolvedValue({ id: "u1" });

    await expect(
      authService.register("Alice", "alice@test.com", "pw"),
    ).rejects.toThrow(ConflictError);
    expect(authPrismaRepository.create).not.toHaveBeenCalled();
  });

  it("hashes the password and creates the user when the email is new", async () => {
    authPrismaRepository.findByEmail.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue("hashed-pw");
    authPrismaRepository.create.mockResolvedValue({
      id: "u1",
      name: "Alice",
      email: "alice@test.com",
    });

    const result = await authService.register(
      "Alice",
      "alice@test.com",
      "plain-pw",
    );

    expect(bcrypt.hash).toHaveBeenCalledWith("plain-pw", 10);
    expect(authPrismaRepository.create).toHaveBeenCalledWith({
      name: "Alice",
      email: "alice@test.com",
      password: "hashed-pw",
      passwordChangedAt: expect.any(Date),
    });
    expect(result).toEqual({
      id: "u1",
      name: "Alice",
      email: "alice@test.com",
      verificationEmailSent: true,
    });
  });
});

describe("authService.login", () => {
  it("refuses a suspended customer before issuing a session or MFA challenge", async () => {
    authPrismaRepository.findByEmailWithPassword.mockResolvedValue({
      id: "u1",
      password: "hash",
      role: "CUSTOMER",
    });
    bcrypt.compare.mockResolvedValue(true);
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      suspendedAt: new Date(),
      twoFactorEnabled: true,
      sessionVersion: 1,
    });
    await expect(
      authService.login("alice@test.com", "password"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(sessionRedisRepository.createSession).not.toHaveBeenCalled();
    expect(
      sessionRedisRepository.saveTwoFactorChallenge,
    ).not.toHaveBeenCalled();
  });
  it("throws UnauthorizedError when no user exists for the email", async () => {
    authPrismaRepository.findByEmailWithPassword.mockResolvedValue(null);

    await expect(authService.login("ghost@test.com", "pw")).rejects.toThrow(
      UnauthorizedError,
    );
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when the password does not match — never reveals which check failed", async () => {
    authPrismaRepository.findByEmailWithPassword.mockResolvedValue({
      id: "u1",
      password: "hashed-pw",
    });
    bcrypt.compare.mockResolvedValue(false);

    await expect(
      authService.login("alice@test.com", "wrong-pw"),
    ).rejects.toThrow("Invalid email or password");
  });

  it("issues both tokens, returns the full derived profile, and persists the refresh token on success", async () => {
    authPrismaRepository.findByEmailWithPassword.mockResolvedValue({
      id: "u1",
      role: "CUSTOMER",
      password: "hashed-pw",
      name: "Alice",
      email: "alice@test.com",
    });
    bcrypt.compare.mockResolvedValue(true);
    generateAccessToken.mockReturnValue("access-tok");
    generateRefreshToken.mockReturnValue("refresh-tok");
    const derivedProfile = {
      id: "u1",
      role: "CUSTOMER",
      name: "Alice",
      email: "alice@test.com",
      frame: "BRONZE",
    };
    userService.getProfile.mockResolvedValue(derivedProfile);

    const result = await authService.login("alice@test.com", "correct-pw");

    expect(generateAccessToken).toHaveBeenCalledWith(
      "u1",
      "CUSTOMER",
      0,
      expect.any(String),
    );
    expect(generateRefreshToken).toHaveBeenCalledWith(
      "u1",
      0,
      expect.any(String),
    );
    expect(sessionRedisRepository.createSession).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
      "refresh-tok",
      "Browser · Device",
    );
    // why: login must return the same shape as a normal profile fetch (frame/unlockedFrames/
    // etc.), not just the bare user row — that's the whole point of this delegation
    expect(userService.getProfile).toHaveBeenCalledWith("u1");
    expect(result).toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      user: derivedProfile,
    });
    expect(result.user.password).toBeUndefined();
  });

  it("returns an expiring second-factor challenge instead of a session for protected accounts", async () => {
    authPrismaRepository.findByEmailWithPassword.mockResolvedValue({
      id: "u1",
      role: "CUSTOMER",
      password: "hashed-pw",
    });
    bcrypt.compare.mockResolvedValue(true);
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      twoFactorEnabled: true,
    });
    sessionRedisRepository.saveTwoFactorChallenge.mockResolvedValue(undefined);

    const result = await authService.login("alice@test.com", "correct-pw");

    expect(result).toMatchObject({ requiresTwoFactor: true });
    expect(result.challengeToken).toMatch(/^[A-Za-z\d_-]{40,60}$/);
    expect(sessionRedisRepository.saveTwoFactorChallenge).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
    );
    expect(sessionRedisRepository.createSession).not.toHaveBeenCalled();
  });
});

describe("authService.verifyTwoFactorChallenge", () => {
  it("does not let a pending challenge bypass suspension", async () => {
    sessionRedisRepository.getTwoFactorChallenge.mockResolvedValue("u1");
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      suspendedAt: new Date(),
      twoFactorEnabled: true,
    });
    await expect(
      authService.verifyTwoFactorChallenge("token", "123456"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(sessionRedisRepository.createSession).not.toHaveBeenCalled();
  });
  it("consumes a one-time recovery code before issuing the session", async () => {
    sessionRedisRepository.getTwoFactorChallenge.mockResolvedValue("u1");
    userPrismaRepository.findTwoFactorById.mockResolvedValue({
      id: "u1",
      role: "CUSTOMER",
      twoFactorEnabled: true,
      twoFactorSecret: "encrypted-secret",
    });
    userPrismaRepository.consumeTwoFactorRecoveryCode.mockResolvedValue(true);
    sessionRedisRepository.consumeTwoFactorChallenge.mockResolvedValue(true);
    generateAccessToken.mockReturnValue("access-tok");
    generateRefreshToken.mockReturnValue("refresh-tok");
    userService.getProfile.mockResolvedValue({ id: "u1", role: "CUSTOMER" });

    const result = await authService.verifyTwoFactorChallenge(
      "challenge-token",
      "ABCD1234EF567890",
    );

    expect(
      userPrismaRepository.consumeTwoFactorRecoveryCode,
    ).toHaveBeenCalledWith("u1", expect.any(String));
    expect(
      sessionRedisRepository.consumeTwoFactorChallenge,
    ).toHaveBeenCalledWith(expect.any(String), "u1");
    expect(result).toMatchObject({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      user: { id: "u1" },
    });
  });
});

describe("authService.logout", () => {
  it("revokes only the current session", async () => {
    await authService.logout("u1", "session-1");

    expect(sessionRedisRepository.revokeSession).toHaveBeenCalledWith(
      "u1",
      "session-1",
    );
  });
});

describe("authService sessions", () => {
  it("marks only the requesting device as current", async () => {
    sessionRedisRepository.listSessions.mockResolvedValue([
      { id: "session-1", device: "Chrome · Windows" },
      { id: "session-2", device: "Safari · iPhone" },
    ]);

    await expect(authService.listSessions("u1", "session-1")).resolves.toEqual([
      { id: "session-1", device: "Chrome · Windows", current: true },
      { id: "session-2", device: "Safari · iPhone", current: false },
    ]);
    expect(sessionRedisRepository.listSessions).toHaveBeenCalledWith("u1");
  });

  it("revokes one device without revoking the others", async () => {
    await authService.revokeSession("u1", "session-2");

    expect(sessionRedisRepository.revokeSession).toHaveBeenCalledWith(
      "u1",
      "session-2",
    );
    expect(sessionRedisRepository.deleteAllSessions).not.toHaveBeenCalled();
  });

  it("preserves the current device when revoking other sessions", async () => {
    sessionRedisRepository.revokeOtherSessions.mockResolvedValue(2);

    await expect(
      authService.revokeOtherSessions("u1", "session-1"),
    ).resolves.toBe(2);
    expect(sessionRedisRepository.revokeOtherSessions).toHaveBeenCalledWith(
      "u1",
      "session-1",
    );
  });
});

describe("authService.refreshToken", () => {
  it("rejects a pre-suspension refresh token after account restoration", async () => {
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "CUSTOMER",
      suspendedAt: null,
      sessionVersion: 1,
    });
    await expect(
      authService.refreshToken("u1", "session-1", "old-token", 0),
    ).rejects.toThrow(UnauthorizedError);
    expect(sessionRedisRepository.rotateSession).not.toHaveBeenCalled();
  });

  it("issues tokens with the current account version after a fresh login", async () => {
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "CUSTOMER",
      suspendedAt: null,
      sessionVersion: 1,
    });
    sessionRedisRepository.rotateSession.mockResolvedValue(true);
    await authService.refreshToken("u1", "session-1", "new-token", 1);
    expect(generateAccessToken).toHaveBeenCalledWith(
      "u1",
      "CUSTOMER",
      1,
      "session-1",
    );
    expect(generateRefreshToken).toHaveBeenCalledWith("u1", 1, "session-1");
  });
  it("throws UnauthorizedError when the refresh token is invalid, expired, or already rotated", async () => {
    sessionRedisRepository.rotateSession.mockResolvedValue(false);

    await expect(
      authService.refreshToken("u1", "session-1", "stale-tok"),
    ).rejects.toThrow(UnauthorizedError);
    expect(sessionRedisRepository.createSession).not.toHaveBeenCalled();
  });

  it("rotates to a fresh access/refresh pair and persists the new refresh token", async () => {
    sessionRedisRepository.rotateSession.mockResolvedValue(true);
    authPrismaRepository.findAccessState.mockResolvedValue({
      role: "ADMIN",
      suspendedAt: null,
      sessionVersion: 0,
    });
    generateAccessToken.mockReturnValue("new-access-tok");
    generateRefreshToken.mockReturnValue("new-refresh-tok");

    const result = await authService.refreshToken(
      "u1",
      "session-1",
      "old-refresh-tok",
    );

    expect(sessionRedisRepository.rotateSession).toHaveBeenCalledWith(
      "u1",
      "session-1",
      "old-refresh-tok",
      "new-refresh-tok",
    );
    expect(generateAccessToken).toHaveBeenCalledWith(
      "u1",
      "ADMIN",
      0,
      "session-1",
    );
    expect(sessionRedisRepository.createSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      accessToken: "new-access-tok",
      refreshToken: "new-refresh-tok",
    });
  });
});

describe("authService.forgotPassword", () => {
  it("does nothing when no user exists for the email — never reveals whether it's registered", async () => {
    authPrismaRepository.findByEmail.mockResolvedValue(null);

    await authService.forgotPassword("ghost@test.com");

    expect(sessionRedisRepository.saveResetToken).not.toHaveBeenCalled();
    expect(sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it("saves a hashed reset token keyed by userId and emails the reset link when the user exists", async () => {
    authPrismaRepository.findByEmail.mockResolvedValue({
      id: "u1",
      email: "alice@test.com",
    });

    await authService.forgotPassword("alice@test.com");

    // why: value must be a hash, never the raw secret that goes out in the email
    expect(sessionRedisRepository.saveResetToken).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
    );
    const [, storedHash] = sessionRedisRepository.saveResetToken.mock.calls[0];
    const [, emailedUrl] = sendResetPasswordEmail.mock.calls[0];
    const emailedToken = emailedUrl.split("token=")[1];
    expect(emailedToken.startsWith("u1.")).toBe(true);
    expect(storedHash).not.toBe(emailedToken.slice("u1.".length));

    expect(sendResetPasswordEmail).toHaveBeenCalledWith(
      "alice@test.com",
      expect.stringContaining("/reset-password?token="),
    );
  });
});

describe("authService.resetPassword", () => {
  it("throws BadRequestError without touching Redis when the token has no userId prefix", async () => {
    await expect(
      authService.resetPassword("malformed-token", "newpassword"),
    ).rejects.toThrow(BadRequestError);
    expect(sessionRedisRepository.consumeResetToken).not.toHaveBeenCalled();
    expect(userPrismaRepository.update).not.toHaveBeenCalled();
  });

  it("throws BadRequestError when the token is invalid or expired", async () => {
    sessionRedisRepository.consumeResetToken.mockResolvedValue(false);

    await expect(
      authService.resetPassword("u1.bad-secret", "newpassword"),
    ).rejects.toThrow(BadRequestError);
    expect(userPrismaRepository.update).not.toHaveBeenCalled();
  });

  it("hashes the new password, updates the user, and revokes the active session", async () => {
    sessionRedisRepository.consumeResetToken.mockResolvedValue(true);
    bcrypt.hash.mockResolvedValue("hashed-new-pw");

    await authService.resetPassword("u1.good-secret", "newpassword");

    expect(sessionRedisRepository.consumeResetToken).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
    );
    expect(bcrypt.hash).toHaveBeenCalledWith("newpassword", 10);
    expect(userPrismaRepository.update).toHaveBeenCalledWith("u1", {
      password: "hashed-new-pw",
      passwordChangedAt: expect.any(Date),
      sessionVersion: { increment: 1 },
    });
    expect(sessionRedisRepository.deleteAllSessions).toHaveBeenCalledWith("u1");
  });
});

describe("authService.verifyEmail", () => {
  it("throws BadRequestError without touching Redis when the token has no userId prefix", async () => {
    await expect(authService.verifyEmail("malformed-token")).rejects.toThrow(
      BadRequestError,
    );
    expect(
      sessionRedisRepository.consumeEmailVerifyToken,
    ).not.toHaveBeenCalled();
    expect(userPrismaRepository.update).not.toHaveBeenCalled();
  });

  it("throws BadRequestError when the token is invalid or expired", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "alice@test.com",
    });
    sessionRedisRepository.consumeEmailVerifyToken.mockResolvedValue(false);

    await expect(authService.verifyEmail("u1.bad-secret")).rejects.toThrow(
      BadRequestError,
    );
    expect(userPrismaRepository.update).not.toHaveBeenCalled();
  });

  it("sets emailVerifiedAt when the token is valid", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "alice@test.com",
      pendingEmail: null,
    });
    sessionRedisRepository.consumeEmailVerifyToken.mockResolvedValue(true);

    await authService.verifyEmail("u1.good-secret");

    expect(sessionRedisRepository.consumeEmailVerifyToken).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
      "alice@test.com",
    );
    expect(userPrismaRepository.update).toHaveBeenCalledWith("u1", {
      emailVerifiedAt: expect.any(Date),
    });
  });

  it("promotes a pending email only when its matching address token is verified", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "old@test.com",
      pendingEmail: "new@test.com",
    });
    sessionRedisRepository.consumeEmailVerifyToken.mockResolvedValue(true);
    const encodedEmail = Buffer.from("new@test.com").toString("base64url");

    await authService.verifyEmail(`u1.good-secret.${encodedEmail}`);

    expect(sessionRedisRepository.consumeEmailVerifyToken).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
      "new@test.com",
    );
    expect(userPrismaRepository.update).toHaveBeenCalledWith("u1", {
      email: "new@test.com",
      pendingEmail: null,
      emailVerifiedAt: expect.any(Date),
    });
  });
});

describe("authService.resendVerification", () => {
  it("throws NotFoundError when the user does not exist", async () => {
    userPrismaRepository.findById.mockResolvedValue(null);

    await expect(authService.resendVerification("ghost")).rejects.toThrow(
      NotFoundError,
    );
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("throws BadRequestError when the email is already verified", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "alice@test.com",
      emailVerifiedAt: new Date(),
    });

    await expect(authService.resendVerification("u1")).rejects.toThrow(
      BadRequestError,
    );
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("saves a new hashed token and emails the verification link when not yet verified", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "alice@test.com",
      emailVerifiedAt: null,
      pendingEmail: null,
    });

    await authService.resendVerification("u1");

    expect(sessionRedisRepository.saveEmailVerifyToken).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
      "alice@test.com",
    );
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      "alice@test.com",
      expect.stringContaining("/verify-email?token=u1."),
    );
  });

  it("resends to a pending address before the current address", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "old@test.com",
      pendingEmail: "new@test.com",
      emailVerifiedAt: new Date(),
    });

    await authService.resendVerification("u1");

    expect(sendVerificationEmail).toHaveBeenCalledWith(
      "new@test.com",
      expect.stringContaining("/verify-email?token=u1."),
    );
  });
});

describe("authService.requestEmailChange", () => {
  it("rejects an email already owned by another account", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "old@test.com",
    });
    userPrismaRepository.findEmailOwner.mockResolvedValue({ id: "u2" });

    await expect(
      authService.requestEmailChange("u1", "taken@test.com"),
    ).rejects.toThrow(ConflictError);
    expect(userPrismaRepository.update).not.toHaveBeenCalled();
  });

  it("stores and sends a verification link for the pending address", async () => {
    userPrismaRepository.findById.mockResolvedValue({
      id: "u1",
      email: "old@test.com",
    });
    userPrismaRepository.findEmailOwner.mockResolvedValue(null);
    userPrismaRepository.update.mockResolvedValue({
      id: "u1",
      email: "old@test.com",
      pendingEmail: "new@test.com",
    });

    const result = await authService.requestEmailChange("u1", " New@Test.com ");

    expect(userPrismaRepository.update).toHaveBeenCalledWith("u1", {
      pendingEmail: "new@test.com",
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      "new@test.com",
      expect.stringContaining("/verify-email?token=u1."),
    );
    expect(result).toEqual({
      pendingEmail: "new@test.com",
      verificationEmailSent: true,
    });
  });
});

describe("authService.googleLogin", () => {
  const payload = (overrides = {}) => ({
    sub: "google-sub-1",
    email: "alice@gmail.com",
    email_verified: true,
    name: "Alice",
    picture: "https://example.com/pic.jpg",
    ...overrides,
  });
  const googleUser = { id: "u1", role: "CUSTOMER", googleId: "google-sub-1" };
  const profile = { id: "u1", name: "Alice", frame: "BRONZE" };
  const verifyPayload = (value) =>
    googleAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => value,
    });
  const expectNoSession = () => {
    expect(generateAccessToken).not.toHaveBeenCalled();
    expect(generateRefreshToken).not.toHaveBeenCalled();
    expect(sessionRedisRepository.createSession).not.toHaveBeenCalled();
    expect(userService.getProfile).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    verifyPayload(payload());
    authPrismaRepository.findByGoogleId.mockResolvedValue(null);
    authPrismaRepository.findByEmailForGoogle.mockResolvedValue(null);
    authPrismaRepository.createFromGoogle.mockResolvedValue(googleUser);
    authPrismaRepository.linkGoogleId.mockResolvedValue(googleUser);
    userService.getProfile.mockResolvedValue(profile);
    generateAccessToken.mockReturnValue("access-tok");
    generateRefreshToken.mockReturnValue("refresh-tok");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "   "])(
    "fails closed with missing client ID (%s)",
    async (clientId) => {
      vi.stubEnv("GOOGLE_CLIENT_ID", clientId);
      await expect(authService.googleLogin("credential")).rejects.toMatchObject(
        { statusCode: 503, code: "GOOGLE_LOGIN_UNAVAILABLE" },
      );
      expect(googleAuthClient.verifyIdToken).not.toHaveBeenCalled();
      expect(authPrismaRepository.findByGoogleId).not.toHaveBeenCalled();
      expectNoSession();
    },
  );

  it.each([undefined, null, "", "  ", 42])(
    "rejects malformed credential %s before verification",
    async (credential) => {
      await expect(authService.googleLogin(credential)).rejects.toThrow(
        UnauthorizedError,
      );
      expect(googleAuthClient.verifyIdToken).not.toHaveBeenCalled();
      expectNoSession();
    },
  );

  it.each(["bad signature", "expired", "wrong audience", "wrong issuer"])(
    "rejects SDK verification failure: %s",
    async (reason) => {
      googleAuthClient.verifyIdToken.mockRejectedValue(new Error(reason));
      await expect(authService.googleLogin("bad-token")).rejects.toThrow(
        "Invalid Google credential",
      );
      expect(googleAuthClient.verifyIdToken).toHaveBeenCalledWith({
        idToken: "bad-token",
        audience: "test-client.apps.googleusercontent.com",
      });
      expect(authPrismaRepository.findByGoogleId).not.toHaveBeenCalled();
      expectNoSession();
    },
  );

  it.each([
    undefined,
    null,
    {},
    payload({ sub: undefined }),
    payload({ sub: "" }),
    payload({ sub: " " }),
    payload({ sub: 123 }),
    payload({ email: undefined }),
    payload({ email: "bad-email" }),
    payload({ email_verified: "true" }),
    payload({ email_verified: undefined }),
    payload({ name: {} }),
    payload({ picture: "javascript:alert(1)" }),
    payload({ hd: 123 }),
  ])("rejects malformed payload before any user query (%#)", async (value) => {
    verifyPayload(value);
    await expect(authService.googleLogin("credential")).rejects.toThrow(
      UnauthorizedError,
    );
    expect(authPrismaRepository.findByGoogleId).not.toHaveBeenCalled();
    expect(authPrismaRepository.findByEmailForGoogle).not.toHaveBeenCalled();
    expect(authPrismaRepository.createFromGoogle).not.toHaveBeenCalled();
    expectNoSession();
  });

  it("recognizes sub before email, returns the full profile and persists the session", async () => {
    verifyPayload(
      payload({ email: "changed@third-party.test", email_verified: false }),
    );
    authPrismaRepository.findByGoogleId.mockResolvedValue(googleUser);
    await expect(authService.googleLogin("credential")).resolves.toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      user: profile,
    });
    expect(authPrismaRepository.findByGoogleId).toHaveBeenCalledWith(
      "google-sub-1",
    );
    expect(authPrismaRepository.findByEmailForGoogle).not.toHaveBeenCalled();
    expect(authPrismaRepository.linkGoogleId).not.toHaveBeenCalled();
    expect(authPrismaRepository.createFromGoogle).not.toHaveBeenCalled();
    expect(generateAccessToken).toHaveBeenCalledWith(
      "u1",
      "CUSTOMER",
      0,
      expect.any(String),
    );
    expect(generateRefreshToken).toHaveBeenCalledWith(
      "u1",
      0,
      expect.any(String),
    );
    expect(sessionRedisRepository.createSession).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
      "refresh-tok",
      "Browser · Device",
    );
    expect(userService.getProfile).toHaveBeenCalledWith("u1");
  });

  it("creates a Gmail user with verified email in one write", async () => {
    await authService.googleLogin("credential");
    expect(authPrismaRepository.createFromGoogle).toHaveBeenCalledWith({
      name: "Alice",
      email: "alice@gmail.com",
      googleId: "google-sub-1",
      avatar: "https://example.com/pic.jpg",
      emailVerifiedAt: expect.any(Date),
    });
  });

  it("accepts absent optional profile fields and does not verify third-party email", async () => {
    verifyPayload(
      payload({
        name: undefined,
        picture: undefined,
        email: "alice@example.com",
      }),
    );
    await authService.googleLogin("credential");
    expect(authPrismaRepository.createFromGoogle).toHaveBeenCalledWith({
      name: "alice",
      email: "alice@example.com",
      googleId: "google-sub-1",
      avatar: null,
      emailVerifiedAt: null,
    });
  });

  it.each([
    { email: "alice@gmail.com", email_verified: false },
    { email: "alice@example.com", email_verified: true },
    { email: "alice@example.com", email_verified: false, hd: "example.com" },
    { email: "alice@gmail.com.attacker.test", email_verified: true },
  ])("refuses unsafe email linking (%j)", async (claims) => {
    verifyPayload(payload(claims));
    authPrismaRepository.findByEmailForGoogle.mockResolvedValue({
      id: "existing",
      googleId: null,
      emailVerifiedAt: new Date(),
    });
    await expect(authService.googleLogin("credential")).rejects.toThrow(
      "Sign in to your existing account with email and password first",
    );
    expect(authPrismaRepository.linkGoogleId).not.toHaveBeenCalled();
    expect(authPrismaRepository.createFromGoogle).not.toHaveBeenCalled();
    expectNoSession();
  });

  it.each([{}, { email: "alice@workspace.test", hd: "workspace.test" }])(
    "links authoritative email without overwriting its verification date (%j)",
    async (claims) => {
      verifyPayload(payload(claims));
      authPrismaRepository.findByEmailForGoogle.mockResolvedValue({
        id: "u1",
        googleId: null,
        emailVerifiedAt: new Date("2020-01-01"),
      });
      await authService.googleLogin("credential");
      expect(authPrismaRepository.linkGoogleId).toHaveBeenCalledWith("u1", {
        email: claims.email ?? "alice@gmail.com",
        googleId: "google-sub-1",
        emailVerifiedAt: undefined,
      });
    },
  );

  it("backfills verification only for authoritative email", async () => {
    authPrismaRepository.findByEmailForGoogle.mockResolvedValue({
      id: "u1",
      googleId: null,
      emailVerifiedAt: null,
    });
    await authService.googleLogin("credential");
    expect(authPrismaRepository.linkGoogleId).toHaveBeenCalledWith("u1", {
      email: "alice@gmail.com",
      googleId: "google-sub-1",
      emailVerifiedAt: expect.any(Date),
    });
  });

  it("never overwrites a different linked Google identity", async () => {
    authPrismaRepository.findByEmailForGoogle.mockResolvedValue({
      id: "other",
      googleId: "other-sub",
    });
    await expect(authService.googleLogin("credential")).rejects.toThrow(
      "linked to another Google account",
    );
    expect(authPrismaRepository.linkGoogleId).not.toHaveBeenCalled();
    expectNoSession();
  });

  it("accepts the same sub found during the email read without linking again", async () => {
    authPrismaRepository.findByEmailForGoogle.mockResolvedValue(googleUser);
    await expect(authService.googleLogin("credential")).resolves.toMatchObject({
      user: profile,
    });
    expect(authPrismaRepository.linkGoogleId).not.toHaveBeenCalled();
  });

  it("allows simultaneous first logins after one insert wins the unique constraint", async () => {
    let winner = null;
    authPrismaRepository.findByGoogleId.mockImplementation(async () => winner);
    authPrismaRepository.createFromGoogle.mockImplementation(async () => {
      if (winner) throw { code: "P2002" };
      winner = googleUser;
      return winner;
    });
    const results = await Promise.all([
      authService.googleLogin("credential"),
      authService.googleLogin("credential"),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.user.id === "u1")).toBe(true);
    expect(authPrismaRepository.createFromGoogle).toHaveBeenCalledTimes(2);
    expect(authPrismaRepository.findByGoogleId).toHaveBeenCalledTimes(3);
    expect(sessionRedisRepository.createSession).toHaveBeenCalledTimes(2);
  });

  it.each(["P2002", "P2025"])(
    "recovers a concurrent link only for the same identity (%s)",
    async (code) => {
      authPrismaRepository.findByEmailForGoogle.mockResolvedValue({
        id: "u1",
        googleId: null,
      });
      authPrismaRepository.linkGoogleId.mockRejectedValue({ code });
      authPrismaRepository.findByGoogleId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(googleUser);
      await expect(
        authService.googleLogin("credential"),
      ).resolves.toMatchObject({ user: profile });
    },
  );

  it.each([null, { id: "other", googleId: "other-sub" }])(
    "does not authenticate an unconfirmed unique-conflict winner (%j)",
    async (winner) => {
      authPrismaRepository.createFromGoogle.mockRejectedValue({
        code: "P2002",
      });
      authPrismaRepository.findByGoogleId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      await expect(authService.googleLogin("credential")).rejects.toThrow(
        ConflictError,
      );
      expectNoSession();
    },
  );

  it("rejects a link lost to another identity", async () => {
    authPrismaRepository.findByEmailForGoogle.mockResolvedValue({
      id: "u1",
      googleId: null,
    });
    authPrismaRepository.linkGoogleId.mockRejectedValue({ code: "P2025" });
    await expect(authService.googleLogin("credential")).rejects.toThrow(
      ConflictError,
    );
    expectNoSession();
  });

  it("does not disguise unrelated database failures as a successful login", async () => {
    authPrismaRepository.createFromGoogle.mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(authService.googleLogin("credential")).rejects.toThrow(
      "database unavailable",
    );
    expectNoSession();
  });
});
