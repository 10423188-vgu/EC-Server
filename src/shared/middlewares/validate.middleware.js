export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // why: delegate to errorHandler's ZodError branch so validation failures always return
  // the same {success:false, code:"VALIDATION_ERROR", errors} shape, whether Zod rejects here
  // or deeper in the stack
  if (!result.success) {
    return next(result.error);
  }

  req.body = result.data.body ?? req.body;
  // why: Express 5 defines req.query as a getter that re-parses the URL on every access,
  // so Object.assign(req.query, ...) silently no-ops — the transformed values (e.g. page/limit
  // coerced to numbers) never reach the controller. Overriding the property itself persists it.
  if (result.data.query) {
    Object.defineProperty(req, "query", {
      value: result.data.query,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  if (result.data.params) Object.assign(req.params, result.data.params);
  next();
};
