import { randomUUID } from "node:crypto";

export const requestId = (req, res, next) => {
  req.requestId = req.headers["x-request-id"] ?? randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
};
