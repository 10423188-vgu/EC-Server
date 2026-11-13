import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authPrismaRepository } from "./auth.prisma.repository.js";
import { sessionRedisRepository } from "./session.redis.repository.js";
import { userService } from "../user/user.service.js";
import { userPrismaRepository } from "../user/user.prisma.repository.js";
import googleAuthClient from "../../configs/integrations/googleAuth.js";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../shared/utils/jwt.util.js";
import {
  sendResetPasswordEmail,
  sendVerificationEmail,
} from "../../shared/utils/mail.util.js";
import { logger } from "../../shared/utils/logger.js";
import { decryptTotpSecret, verifyTotp } from "../../shared/utils/totp.util.js";
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
  AppError,
  ForbiddenError,
} from "../../shared/errors/app.error.js";

const googlePayloadSchema = z.object({
  sub: z.string().min(1).max(255).regex(/^\S+$/),
  email: z.email(),
  email_verified: z.boolean(),
  hd: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  picture: z.url({ protocol: /^https$/ }).nullish(),
});

// why: only the hash goes to Redis — the raw secret only ever exists in the email link
// and briefly in memory here, so a Redis read alone can't be used to consume the token
const hashToken = (secret) =>
  crypto.createHash("sha256").update(secret).digest("hex");

const getDeviceName = (userAgent = "") => {
  let browser = "Browser";
  if (/Edg\/|EdgiOS/.test(userAgent)) browser = "Edge";
  else if (/Chrome\/|CriOS/.test(userAgent)) browser = "Chrome";
  else if (/Firefox\/|FxiOS/.test(userAgent)) browser = "Firefox";
  else if (/Safari\//.test(userAgent)) browser = "Safari";

  let platform = "Device";
  if (/iPhone/.test(userAgent)) platform = "iPhone";
  else if (/iPad/.test(userAgent)) platform = "iPad";
  else if (/Android/.test(userAgent)) platform = "Android";
  else if (/Windows/.test(userAgent)) platform = "Windows";
  else if (/Mac OS/.test(userAgent)) platform = "Mac";
  else if (/Linux/.test(userAgent)) platform = "Linux";
  return `${browser} · ${platform}`;
};

const sendEmailVerification = async (user, email = user.email) => {
  const secret = crypto.randomBytes(32).toString("hex");
  await sessionRedisRepository.saveEmailVerifyToken(
    user.id,
    hashToken(secret),
    email,
  );
  const token = `${user.id}.${secret}.${Buffer.from(email).toString("base64url")}`;
  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  await sendVerificationEmail(email, verifyUrl);
};

const createLoginSession = async (
  userId,
  role,
  sessionVersion = 0,
  userAgent,
) => {
  const sessionId = crypto.randomUUID();
  const refreshToken = generateRefreshToken(userId, sessionVersion, sessionId);
  const [user] = await Promise.all([
    userService.getProfile(userId),
    sessionRedisRepository.createSession(
      userId,
      sessionId,
      refreshToken,
      getDeviceName(userAgent),
    ),
  ]);
  const accessToken = generateAccessToken(
    userId,
    role ?? user.role,
    sessionVersion,
    sessionId,
  );
  return { accessToken, refreshToken, user };
};

const beginLogin = async (userId, role, userAgent) => {
  const security = await userPrismaRepository.findTwoFactorById(userId);
  if (security?.suspendedAt)
    throw new ForbiddenError(
      "This account is suspended. Contact support for help.",
    );
  if (!security?.twoFactorEnabled)
    return createLoginSession(
      userId,
      role,
      security?.sessionVersion ?? 0,
      userAgent,
    );
  const challengeToken = crypto.randomBytes(32).toString("base64url");
  await sessionRedisRepository.saveTwoFactorChallenge(
    hashToken(challengeToken),
    userId,
  );
  return { requiresTwoFactor: true, challengeToken };
};

export const authService = {
  register: async (name, email, password) => {
    const existing = await authPrismaRepository.findByEmail(email);
    if (existing) throw new ConflictError("Email is already registered");

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await authPrismaRepository.create({
      name,
      email,
      password: hashedPassword,
      passwordChangedAt: new Date(),
    });

    try {
      await sendEmailVerification(user);
      return { ...user, verificationEmailSent: true };
    } catch (err) {
      logger.error({ err }, "[Mail] Failed to send verification email");
      return { ...user, verificationEmailSent: false };
    }
  },

  login: async (email, password, userAgent) => {
    const user = await authPrismaRepository.findByEmailWithPassword(email);
    // why: a Google-only account has no password hash to compare against — bcrypt.compare
    // throws on a null/undefined hash instead of just returning false
    const isPasswordValid =
      user?.password && (await bcrypt.compare(password, user.password));
    if (!isPasswordValid)
      throw new UnauthorizedError("Invalid email or password");

    return beginLogin(user.id, user.role, userAgent);
  },

  verifyTwoFactorChallenge: async (challengeToken, code, userAgent) => {
    const tokenHash = hashToken(challengeToken);
    const userId =
      await sessionRedisRepository.getTwoFactorChallenge(tokenHash);
    if (!userId)
      throw new UnauthorizedError("Invalid or expired authenticator challenge");
    const user = await userPrismaRepository.findTwoFactorById(userId);
    if (user?.suspendedAt)
      throw new ForbiddenError(
        "This account is suspended. Contact support for help.",
      );
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedError("Two-factor authentication is unavailable");
    }

    let isValid = false;
    if (/^\d{6}$/.test(code)) {
      isValid = verifyTotp(decryptTotpSecret(user.twoFactorSecret), code);
    }
    if (!isValid) {
      isValid = await userPrismaRepository.consumeTwoFactorRecoveryCode(
        userId,
        hashToken(code.toUpperCase()),
      );
    }
    if (!isValid)
      throw new UnauthorizedError("Invalid authenticator or recovery code");

    const consumed = await sessionRedisRepository.consumeTwoFactorChallenge(
      tokenHash,
      userId,
    );
    if (!consumed)
      throw new UnauthorizedError("Authenticator challenge was already used");
    return createLoginSession(
      userId,
      user.role,
      user.sessionVersion ?? 0,
      userAgent,
    );
  },

  logout: (userId, sessionId) =>
    sessionRedisRepository.revokeSession(userId, sessionId),

  listSessions: async (userId, currentSessionId) =>
    (await sessionRedisRepository.listSessions(userId)).map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    })),

  revokeSession: (userId, sessionId) =>
    sessionRedisRepository.revokeSession(userId, sessionId),

  revokeOtherSessions: (userId, currentSessionId) =>
    sessionRedisRepository.revokeOtherSessions(userId, currentSessionId),

  refreshToken: async (userId, sessionId, refreshToken, sessionVersion = 0) => {
    const state = await authPrismaRepository.findAccessState(userId);
    if (
      !sessionId ||
      !state ||
      state.suspendedAt ||
      (state.sessionVersion ?? 0) !== sessionVersion
    ) {
      throw new UnauthorizedError("Session revoked. Sign in again.");
    }
    // why: atomic compare-and-swap prevents replay when requests share a refresh token.
    const newRefreshToken = generateRefreshToken(
      userId,
      sessionVersion,
      sessionId,
    );
    const rotated = await sessionRedisRepository.rotateSession(
      userId,
      sessionId,
      refreshToken,
      newRefreshToken,
    );
    if (!rotated)
      throw new UnauthorizedError("Invalid or expired refresh token");

    const newAccessToken = generateAccessToken(
      userId,
      state.role,
      sessionVersion,
      sessionId,
    );

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  },

  forgotPassword: async (email) => {
    const user = await authPrismaRepository.findByEmail(email);
    // why: don't leak whether an email is registered — controller always responds the
    // same way regardless of what happens here
    if (!user) return;

    // why: token = "<userId>.<secret>" — the userId prefix lets resetPassword look up
    // the right Redis key without storing the raw secret anywhere server-side
    const secret = crypto.randomBytes(32).toString("hex");
    const token = `${user.id}.${secret}`;
    await sessionRedisRepository.saveResetToken(user.id, hashToken(secret));

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    await sendResetPasswordEmail(user.email, resetUrl).catch((err) =>
      logger.error({ err }, "[Mail] Failed to send reset password email"),
    );
  },

  resetPassword: async (token, newPassword) => {
    const separatorIndex = token.indexOf(".");
    if (separatorIndex === -1)
      throw new BadRequestError("Invalid or expired reset token");

    const userId = token.slice(0, separatorIndex);
    const secret = token.slice(separatorIndex + 1);
    const consumed = await sessionRedisRepository.consumeResetToken(
      userId,
      hashToken(secret),
    );
    if (!consumed) throw new BadRequestError("Invalid or expired reset token");

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await userPrismaRepository.update(userId, {
      password: hashedPassword,
      passwordChangedAt: new Date(),
      sessionVersion: { increment: 1 },
    });

    // why: sessionVersion already revokes access even if Redis cleanup fails.
    await sessionRedisRepository
      .deleteAllSessions(userId)
      .catch((err) =>
        logger.warn(
          { err, userId },
          "Password reset; session cleanup deferred",
        ),
      );
  },

  verifyEmail: async (token) => {
    const [userId, secret, encodedEmail] = token.split(".");
    if (!userId || !secret)
      throw new BadRequestError("Invalid or expired verification token");

    let targetEmail;
    try {
      targetEmail = encodedEmail
        ? Buffer.from(encodedEmail, "base64url").toString("utf8")
        : null;
    } catch {
      throw new BadRequestError("Invalid or expired verification token");
    }
    const user = await userPrismaRepository.findById(userId);
    if (!user)
      throw new BadRequestError("Invalid or expired verification token");
    targetEmail ??= user.email;
    const consumed = await sessionRedisRepository.consumeEmailVerifyToken(
      userId,
      hashToken(secret),
      targetEmail,
    );
    if (!consumed)
      throw new BadRequestError("Invalid or expired verification token");

    if (targetEmail === user.pendingEmail) {
      await userPrismaRepository.update(userId, {
        email: targetEmail,
        pendingEmail: null,
        emailVerifiedAt: new Date(),
      });
      return;
    }
    if (targetEmail !== user.email)
      throw new BadRequestError("Invalid or expired verification token");
    await userPrismaRepository.update(userId, { emailVerifiedAt: new Date() });
  },

  // why: direct user-triggered action (button click), not an anti-enumeration flow like
  // forgotPassword — awaited so a real send failure surfaces to the button as an error
  // instead of silently no-oping
  resendVerification: async (userId) => {
    const user = await userPrismaRepository.findById(userId);
    if (!user) throw new NotFoundError("User");
    if (user.emailVerifiedAt && !user.pendingEmail)
      throw new BadRequestError("Email is already verified");

    await sendEmailVerification(user, user.pendingEmail ?? user.email);
  },

  requestEmailChange: async (userId, email) => {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userPrismaRepository.findById(userId);
    if (!user) throw new NotFoundError("User");
    if (normalizedEmail === user.email.toLowerCase())
      throw new BadRequestError("This is already your current email address");

    const owner = await userPrismaRepository.findEmailOwner(normalizedEmail);
    if (owner && owner.id !== userId)
      throw new ConflictError("This email address is already in use");

    try {
      const updated = await userPrismaRepository.update(userId, {
        pendingEmail: normalizedEmail,
      });
      try {
        await sendEmailVerification(updated, normalizedEmail);
        return { pendingEmail: normalizedEmail, verificationEmailSent: true };
      } catch (err) {
        logger.error(
          { err, userId },
          "[Mail] Failed to send email change verification",
        );
        return { pendingEmail: normalizedEmail, verificationEmailSent: false };
      }
    } catch (error) {
      if (error.code === "P2002")
        throw new ConflictError("This email address is already in use");
      throw error;
    }
  },

  cancelEmailChange: async (userId) => {
    const user = await userPrismaRepository.findById(userId);
    if (!user) throw new NotFoundError("User");
    if (!user.pendingEmail)
      throw new BadRequestError("No email change is waiting for confirmation");

    await userPrismaRepository.update(userId, { pendingEmail: null });

    if (user.emailVerifiedAt) {
      return {
        currentEmail: user.email,
        pendingEmail: null,
        emailVerified: true,
        verificationEmailSent: false,
      };
    }

    try {
      await sendEmailVerification(user, user.email);
      return {
        currentEmail: user.email,
        pendingEmail: null,
        emailVerified: false,
        verificationEmailSent: true,
      };
    } catch (err) {
      logger.error(
        { err, userId },
        "[Mail] Failed to send current-email verification after canceling email change",
      );
      return {
        currentEmail: user.email,
        pendingEmail: null,
        emailVerified: false,
        verificationEmailSent: false,
      };
    }
  },

  googleLogin: async (credential, userAgent) => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new AppError(
        "Google sign-in is unavailable. Please use email and password or contact support.",
        503,
        "GOOGLE_LOGIN_UNAVAILABLE",
      );
    }
    if (typeof credential !== "string" || !credential.trim()) {
      throw new UnauthorizedError("Invalid Google credential");
    }

    let payload;
    try {
      const ticket = await googleAuthClient.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      payload = googlePayloadSchema.parse(ticket.getPayload());
    } catch {
      throw new UnauthorizedError("Invalid Google credential");
    }

    // why: third-party email ownership may have changed since Google verified it.
    const isGoogleEmailAuthoritative =
      payload.email_verified &&
      (payload.email.toLowerCase().endsWith("@gmail.com") || !!payload.hd);
    let user = await authPrismaRepository.findByGoogleId(payload.sub);

    if (!user) {
      const existing = await authPrismaRepository.findByEmailForGoogle(
        payload.email,
      );
      try {
        if (existing?.googleId === payload.sub) {
          user = existing;
        } else if (existing) {
          if (existing.googleId) {
            throw new ConflictError(
              "This account is linked to another Google account. Use the linked Google account or sign in with email and password.",
            );
          }
          if (!isGoogleEmailAuthoritative) {
            throw new ConflictError(
              "Sign in to your existing account with email and password first. Google account linking is not available yet; contact support for help.",
            );
          }
          user = await authPrismaRepository.linkGoogleId(existing.id, {
            email: payload.email,
            googleId: payload.sub,
            emailVerifiedAt: existing.emailVerifiedAt ? undefined : new Date(),
          });
        } else {
          user = await authPrismaRepository.createFromGoogle({
            name: payload.name ?? payload.email.split("@")[0],
            email: payload.email,
            googleId: payload.sub,
            avatar: payload.picture ?? null,
            emailVerifiedAt: isGoogleEmailAuthoritative ? new Date() : null,
          });
        }
      } catch (error) {
        if (error.code !== "P2002" && error.code !== "P2025") throw error;
        // why: another request may have created/linked the identity after our reads.
        // DO NOT: recover by email alone; the winner must own this exact Google sub.
        user = await authPrismaRepository.findByGoogleId(payload.sub);
        if (!user || user.googleId !== payload.sub) {
          throw new ConflictError(
            "The account changed during Google sign-in. Sign in with your existing account or try again.",
          );
        }
      }
    }

    return beginLogin(user.id, user.role, userAgent);
  },
};
