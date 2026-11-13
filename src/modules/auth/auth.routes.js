import { Router } from "express";
import { authController } from "./auth.controller.js";
import { authenticate } from "../../shared/middlewares/authenticate.middleware.js";
import { validate } from "../../shared/middlewares/validate.middleware.js";
import { rateLimit } from "../../shared/middlewares/rate-limit.middleware.js";
import { authSchema } from "./auth.schema.js";

const router = Router();

// why: login is the primary brute-force target — 5 attempts / 15 min per IP
const loginLimiter    = rateLimit(5,  900);
// why: register abuse creates spam accounts — 5 accounts / hour per IP is generous enough for legit use
const registerLimiter = rateLimit(5,  3600);
// why: refresh rotates tokens, not passwords — higher limit to avoid locking out active users
const refreshLimiter  = rateLimit(20, 60);
// why: prevent email-bombing a victim's inbox with reset requests
const forgotPasswordLimiter = rateLimit(5, 3600);
const resetPasswordLimiter  = rateLimit(10, 3600);
const verifyEmailLimiter    = rateLimit(10, 3600);
// why: prevent inbox-bombing via repeated resend clicks
const resendVerificationLimiter = rateLimit(3, 3600);
// why: not brute-forceable like password login (the credential is a Google-signed JWT,
// not a guessable secret) — generous limit is just abuse-prevention, not a security gate
const googleLoginLimiter = rateLimit(20, 900);
const twoFactorLimiter = rateLimit(5, 900);

router.post("/register", registerLimiter, validate(authSchema.register), authController.register);
router.post("/login",    loginLimiter,    validate(authSchema.login),    authController.login);
router.post(
  "/two-factor/verify",
  twoFactorLimiter,
  validate(authSchema.twoFactorChallenge),
  authController.verifyTwoFactor,
);
router.post("/logout",   authenticate,                                   authController.logout);
router.get("/sessions", authenticate, authController.listSessions);
router.post(
  "/sessions/revoke-others",
  authenticate,
  authController.revokeOtherSessions,
);
router.delete(
  "/sessions/:id",
  authenticate,
  validate(authSchema.sessionId),
  authController.revokeSession,
);
router.post("/refresh",  refreshLimiter,                                 authController.refreshToken);
router.post("/forgot-password", forgotPasswordLimiter, validate(authSchema.forgotPassword), authController.forgotPassword);
router.post("/reset-password",  resetPasswordLimiter,  validate(authSchema.resetPassword),  authController.resetPassword);
router.post("/verify-email",       verifyEmailLimiter,       validate(authSchema.verifyEmail), authController.verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, authenticate,                  authController.resendVerification);
router.post("/google", googleLoginLimiter, validate(authSchema.googleLogin), authController.googleLogin);

export default router;
