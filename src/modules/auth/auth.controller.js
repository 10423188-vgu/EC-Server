import { authService } from "./auth.service.js";
import {
  setAuthCookie,
  clearAuthCookies,
} from "../../shared/utils/cookie.util.js";
import { verifyRefreshToken } from "../../shared/utils/jwt.util.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";
import { UnauthorizedError } from "../../shared/errors/app.error.js";

export const authController = {
  register: asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const user = await authService.register(name, email, password);
    sendSuccess(res, {
      statusCode: 201,
      message: "Registration successful",
      data: user,
    });
  }),

  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login(
      email,
      password,
      req.get("user-agent"),
    );
    if (result.requiresTwoFactor) {
      sendSuccess(res, {
        message: "Authenticator verification required",
        data: result,
      });
      return;
    }
    const { accessToken, refreshToken, user } = result;
    setAuthCookie(res, accessToken, refreshToken);
    sendSuccess(res, { message: "Login successful", data: user });
  }),

  verifyTwoFactor: asyncHandler(async (req, res) => {
    const { challengeToken, code } = req.body;
    const { accessToken, refreshToken, user } =
      await authService.verifyTwoFactorChallenge(
        challengeToken,
        code,
        req.get("user-agent"),
      );
    setAuthCookie(res, accessToken, refreshToken);
    sendSuccess(res, { message: "Login successful", data: user });
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.userId, req.sessionId);
    clearAuthCookies(res);
    sendSuccess(res, { message: "Logout successful" });
  }),

  refreshToken: asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) throw new UnauthorizedError("Refresh token is required");

    const {
      id: userId,
      sessionId,
      sessionVersion = 0,
    } = verifyRefreshToken(refreshToken);
    const tokens = await authService.refreshToken(
      userId,
      sessionId,
      refreshToken,
      sessionVersion,
    );

    setAuthCookie(res, tokens.accessToken, tokens.refreshToken);
    sendSuccess(res, { message: "Token refreshed successfully" });
  }),

  forgotPassword: asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body.email);
    sendSuccess(res, {
      message: "If that email is registered, a reset link has been sent",
    });
  }),

  resetPassword: asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    await authService.resetPassword(token, password);
    sendSuccess(res, { message: "Password reset successful" });
  }),

  verifyEmail: asyncHandler(async (req, res) => {
    await authService.verifyEmail(req.body.token);
    sendSuccess(res, { message: "Email verified successfully" });
  }),

  resendVerification: asyncHandler(async (req, res) => {
    await authService.resendVerification(req.userId);
    sendSuccess(res, { message: "Verification email sent" });
  }),

  googleLogin: asyncHandler(async (req, res) => {
    const result = await authService.googleLogin(
      req.body.credential,
      req.get("user-agent"),
    );
    if (result.requiresTwoFactor) {
      sendSuccess(res, {
        message: "Authenticator verification required",
        data: result,
      });
      return;
    }
    const { accessToken, refreshToken, user } = result;
    setAuthCookie(res, accessToken, refreshToken);
    sendSuccess(res, { message: "Login successful", data: user });
  }),

  listSessions: asyncHandler(async (req, res) => {
    const sessions = await authService.listSessions(req.userId, req.sessionId);
    sendSuccess(res, { message: "Sessions fetched", data: sessions });
  }),

  revokeSession: asyncHandler(async (req, res) => {
    await authService.revokeSession(req.userId, req.params.id);
    if (req.params.id === req.sessionId) clearAuthCookies(res);
    sendSuccess(res, { message: "Session revoked" });
  }),

  revokeOtherSessions: asyncHandler(async (req, res) => {
    const count = await authService.revokeOtherSessions(
      req.userId,
      req.sessionId,
    );
    sendSuccess(res, { message: "Other sessions revoked", data: { count } });
  }),
};
