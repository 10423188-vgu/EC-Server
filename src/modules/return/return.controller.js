import { returnService } from "./return.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const returnController = {
  create: asyncHandler(async (req, res) => {
    const request = await returnService.create(
      req.params.id,
      req.userId,
      req.body,
    );
    sendSuccess(res, {
      statusCode: 201,
      message: "Return requested",
      data: request,
    });
  }),

  adminUpdateStatus: asyncHandler(async (req, res) => {
    const request = await returnService.adminUpdateStatus(
      req.params.returnId,
      req.userId,
      req.body,
    );
    sendSuccess(res, { message: "Return status updated", data: request });
  }),
};
