import { userService } from "./user.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";
import { userSecurityService } from "./user.security.service.js";
import { clearAuthCookies } from "../../shared/utils/cookie.util.js";
import { authService } from "../auth/auth.service.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const userController = {
  adminCreateCustomer: asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const customer = await authService.register(name, email, password);
    sendSuccess(res, {
      statusCode: 201,
      message:
        "Customer created. Verification email sent if mail is available.",
      data: customer,
    });
  }),
  adminSetCustomerSuspension: asyncHandler(async (req, res) => {
    const data = await userService.adminSetCustomerSuspension(
      req.userId,
      req.params.id,
      req.body.suspended,
    );
    sendSuccess(res, {
      message: data.suspended
        ? "Customer account suspended"
        : "Customer account restored",
      data,
    });
  }),
  getTwoFactorStatus: asyncHandler(async (req, res) => {
    const data = await userSecurityService.getTwoFactorStatus(req.userId);
    sendSuccess(res, { message: "Two-factor status fetched", data });
  }),

  beginTwoFactorSetup: asyncHandler(async (req, res) => {
    const data = await userSecurityService.beginTwoFactorSetup(req.userId);
    sendSuccess(res, { message: "Authenticator setup started", data });
  }),

  enableTwoFactor: asyncHandler(async (req, res) => {
    const data = await userSecurityService.enableTwoFactor(
      req.userId,
      req.body.secret,
      req.body.code,
    );
    sendSuccess(res, { message: "Two-factor authentication enabled", data });
  }),

  disableTwoFactor: asyncHandler(async (req, res) => {
    const data = await userSecurityService.disableTwoFactor(
      req.userId,
      req.body.code,
    );
    sendSuccess(res, { message: "Two-factor authentication disabled", data });
  }),

  adminListCustomers: asyncHandler(async (req, res) => {
    const result = await userService.adminListCustomers(req.query);
    sendSuccess(res, { message: "Customers fetched", data: result });
  }),
  adminGetCustomer: asyncHandler(async (req, res) => {
    const result = await userService.adminGetCustomer(
      req.params.id,
      req.query.page,
    );
    sendSuccess(res, { message: "Customer fetched", data: result });
  }),

  adminCustomerOverview: asyncHandler(async (req, res) => {
    const result = await userService.adminCustomerOverview(req.query.days);
    sendSuccess(res, { message: "Customer overview fetched", data: result });
  }),

  adminExportCustomers: asyncHandler(async (req, res) => {
    await userService.adminValidateSelectedCustomers(req.body.ids);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="customers.csv"',
    );
    try {
      await pipeline(
        Readable.from(
          userService.adminExportCustomersCsv({
            ...req.query,
            ids: req.body.ids,
          }),
        ),
        res,
      );
    } catch (error) {
      if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
    }
  }),

  getProfile: asyncHandler(async (req, res) => {
    const user = await userService.getProfile(req.userId);
    sendSuccess(res, { message: "Profile fetched successfully", data: user });
  }),

  updateProfile: asyncHandler(async (req, res) => {
    const user = await userService.updateProfile(req.userId, req.body);
    sendSuccess(res, { message: "Profile updated successfully", data: user });
  }),

  requestEmailChange: asyncHandler(async (req, res) => {
    const result = await authService.requestEmailChange(
      req.userId,
      req.body.email,
    );
    sendSuccess(res, {
      message: result.verificationEmailSent
        ? "Verification email sent"
        : "Email change saved; verification email could not be sent",
      data: result,
    });
  }),

  cancelEmailChange: asyncHandler(async (req, res) => {
    const result = await authService.cancelEmailChange(req.userId);
    sendSuccess(res, {
      message: result.emailVerified
        ? "Email change canceled; current email remains verified"
        : result.verificationEmailSent
          ? "Email change canceled; verification email sent to current address"
          : "Email change canceled; verification email could not be sent",
      data: result,
    });
  }),

  updateReviewProfile: asyncHandler(async (req, res) => {
    const user = await userService.updateReviewProfile(req.userId, req.body);
    sendSuccess(res, {
      message: "Review profile updated successfully",
      data: user,
    });
  }),

  updateAvatar: asyncHandler(async (req, res) => {
    const user = await userService.updateAvatar(req.userId, req.body.url);
    sendSuccess(res, { message: "Avatar updated successfully", data: user });
  }),

  updateBanner: asyncHandler(async (req, res) => {
    const user = await userService.updateBanner(req.userId, req.body.url);
    sendSuccess(res, { message: "Banner updated successfully", data: user });
  }),

  setFrame: asyncHandler(async (req, res) => {
    const user = await userService.setFrame(req.userId, req.body.frame);
    sendSuccess(res, {
      message: "Avatar frame updated successfully",
      data: user,
    });
  }),

  changePassword: asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    await userService.changePassword(req.userId, oldPassword, newPassword);
    clearAuthCookies(res);
    sendSuccess(res, { message: "Password changed successfully" });
  }),
};
