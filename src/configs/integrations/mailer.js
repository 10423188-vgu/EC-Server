import { Resend } from "resend";
import { logger } from "../../shared/utils/logger.js";

// why: Resend is a plain HTTP API, no persistent connection to verify on boot like the old
// SMTP transporter — checking the API key is set is the only boot-time signal available
if (!process.env.RESEND_API_KEY) {
  logger.warn("RESEND_API_KEY is not set — emails will fail to send");
}

const resend = new Resend(process.env.RESEND_API_KEY);

export default resend;
