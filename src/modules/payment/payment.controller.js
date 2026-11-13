import { paymentService } from "./payment.service.js";
import { asyncHandler } from "../../shared/middlewares/async-handler.middleware.js";
import { sendSuccess } from "../../shared/utils/response.util.js";

export const paymentController = {
  // why: no automated bank webhook — admin checks their own bank app and confirms manually
  confirm: asyncHandler(async (req, res) => {
    const result = await paymentService.confirmPayment(req.params.orderId, req.userId);
    sendSuccess(res, { message: "Payment confirmed", data: result });
  }),
};
