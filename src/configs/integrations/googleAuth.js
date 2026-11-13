import { OAuth2Client } from "google-auth-library";
import { logger } from "../../shared/utils/logger.js";

// why: the SDK caches Google's public keys until expiry; no persistent connection is needed.
// Missing audience must be rejected by authService before calling verifyIdToken.
if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
  logger.warn("GOOGLE_CLIENT_ID is not set — Google sign-in is disabled");
}

const googleAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export default googleAuthClient;
