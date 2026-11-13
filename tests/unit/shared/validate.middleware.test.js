import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../../../src/shared/middlewares/validate.middleware.js";

// why: Express 5 defines req.query as a getter that re-parses the raw query string on
// every access, so a plain object assigned once won't reflect what the framework actually
// does — this mock reproduces that re-parse-per-access behavior to catch the regression
// where Object.assign(req.query, ...) silently no-ops.
function makeReq({ rawQuery = {}, body = {}, params = {} } = {}) {
  const req = { body, params };
  Object.defineProperty(req, "query", {
    configurable: true,
    enumerable: true,
    get: () => ({ ...rawQuery }),
  });
  return req;
}

describe("validate middleware", () => {
  it("persists transformed query values onto req.query for later handlers", () => {
    const schema = z.object({
      query: z.object({
        page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
        limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 10)),
      }),
    });

    const req = makeReq({ rawQuery: { page: "3", limit: "20" } });
    const next = vi.fn();

    validate(schema)(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ page: 3, limit: 20 });
    expect(typeof req.query.page).toBe("number");
    expect(typeof req.query.limit).toBe("number");
  });

  it("passes the ZodError to next() when validation fails, without touching req.query", () => {
    const schema = z.object({
      query: z.object({ page: z.string().regex(/^\d+$/) }),
    });

    const req = makeReq({ rawQuery: { page: "not-a-number" } });
    const next = vi.fn();

    validate(schema)(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(z.ZodError);
  });

  it("still overwrites req.body directly (unaffected by the query getter fix)", () => {
    const schema = z.object({
      body: z.object({ name: z.string().trim() }),
    });

    const req = makeReq({ body: { name: "  Alice  " } });
    const next = vi.fn();

    validate(schema)(req, {}, next);

    expect(req.body.name).toBe("Alice");
  });
});
