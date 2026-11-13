import jwt from "jsonwebtoken";
import crypto from "crypto";

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("[jwt] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set");
}
// why: only hard-fail in production — development often uses short placeholder secrets
if (
  process.env.JWT_ACCESS_SECRET.length < 32 ||
  process.env.JWT_REFRESH_SECRET.length < 32
) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[jwt] JWT secrets must be at least 32 characters");
  }
  console.warn(
    "[jwt] WARNING: JWT secrets are shorter than 32 characters — unsafe for production",
  );
}

export const generateAccessToken = (userId, role, sessionVersion = 0, sessionId) => {
  return jwt.sign(
    { id: userId, role, sessionVersion, sessionId },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRATION ?? "15m",
    },
  );
};

export const generateRefreshToken = (userId, sessionVersion = 0, sessionId) => {
  return jwt.sign(
    { id: userId, sessionVersion, sessionId, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRATION ?? "7d",
    },
  );
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};
