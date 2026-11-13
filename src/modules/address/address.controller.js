import { addressService } from "./address.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const addressController = {
  createAddress: asyncHandler(async (req, res) => {
    const address = await addressService.createAddress(req.userId, req.body);
    sendSuccess(res, {
      statusCode: 201,
      message: "Address created successfully",
      data: address,
    });
  }),

  updateAddress: asyncHandler(async (req, res) => {
    const address = await addressService.updateAddress(
      req.userId,
      req.params.id,
      req.body,
    );
    sendSuccess(res, {
      message: "Address updated successfully",
      data: address,
    });
  }),

  deleteAddress: asyncHandler(async (req, res) => {
    const result = await addressService.deleteAddress(req.userId, req.params.id);
    sendSuccess(res, { message: "Address deleted successfully", data: result });
  }),

  setDefaultAddress: asyncHandler(async (req, res) => {
    const address = await addressService.setDefaultAddress(
      req.userId,
      req.params.id,
    );
    sendSuccess(res, {
      message: "Default address updated successfully",
      data: address,
    });
  }),
};
