export const sendSuccess = (res, { statusCode = 200, message, data, meta } = {}) => {
  const payload = { success: true, message };
  if (data !== undefined) payload.data = data;
  if (meta !== undefined) payload.meta = meta;
  return res.status(statusCode).json(payload);
};