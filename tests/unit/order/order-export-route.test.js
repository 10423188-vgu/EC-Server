import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import express from "express";
import router from "../../../src/modules/order/order.routes.js";
import { orderService } from "../../../src/modules/order/order.service.js";
import {
  selectedOrdersCsvHeader,
  selectedOrderCsvRow,
} from "../../../src/modules/order/order.csv.js";

vi.mock("../../../src/modules/order/order.service.js", () => ({
  orderService: {
    adminValidateSelected: vi.fn(),
    adminExportSelectedCsv: vi.fn(),
  },
}));
vi.mock("../../../src/modules/return/return.controller.js", () => ({
  returnController: { create: vi.fn(), adminUpdateStatus: vi.fn() },
}));
vi.mock("../../../src/shared/middlewares/authenticate.middleware.js", () => ({
  authenticate: (req, res, next) =>
    req.get("x-role") ? next() : res.sendStatus(401),
  authorize: () => (req, res, next) =>
    req.get("x-role") === "ADMIN" ? next() : res.sendStatus(403),
}));

let server, url;
const id = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/orders", router);
  app.use((error, _req, res, _next) =>
    res
      .status(error.name === "ZodError" ? 400 : (error.statusCode ?? 500))
      .json({ message: error.message }),
  );
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  url = `http://127.0.0.1:${server.address().port}/orders/admin/export-selected.csv`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => vi.resetAllMocks());
const request = (ids = [id], role = "ADMIN") =>
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(role && { "x-role": role }),
    },
    body: JSON.stringify({ ids }),
  });

describe("selected order CSV route", () => {
  it("accepts the maximum selection within the existing JSON body limit", async () => {
    const ids = Array.from(
      { length: 2000 },
      (_, index) =>
        `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
    );
    orderService.adminValidateSelected.mockResolvedValue(undefined);
    orderService.adminExportSelectedCsv.mockImplementation(async function* () {
      yield selectedOrdersCsvHeader;
    });
    const response = await request(ids);
    expect(response.status).toBe(200);
    await response.text();
    expect(orderService.adminValidateSelected).toHaveBeenCalledWith(ids);
  });
  it("requires an admin and validates IDs before starting a download", async () => {
    expect((await request([id], null)).status).toBe(401);
    expect((await request([id], "CUSTOMER")).status).toBe(403);
    expect((await request(["bad-id"])).status).toBe(400);
    expect((await request([id, id])).status).toBe(400);
    expect(orderService.adminValidateSelected).not.toHaveBeenCalled();
  });
  it("returns a normal JSON error if a selected order is unavailable", async () => {
    orderService.adminValidateSelected.mockRejectedValue(
      Object.assign(new Error("Order unavailable"), { statusCode: 409 }),
    );
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "Order unavailable" });
    expect(orderService.adminExportSelectedCsv).not.toHaveBeenCalled();
  });
  it("streams UTF-8 CSV with selection columns and escaped user content", async () => {
    orderService.adminValidateSelected.mockResolvedValue(undefined);
    orderService.adminExportSelectedCsv.mockImplementation(async function* () {
      yield selectedOrdersCsvHeader;
      yield selectedOrderCsvRow({
        id,
        createdAt: new Date("2026-10-15"),
        user: { name: "=SUM(1)" },
      });
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "orders-selected.csv",
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    expect(buffer.toString()).toContain('"\'=SUM(1)"');
    expect(orderService.adminExportSelectedCsv).toHaveBeenCalledWith([id]);
  });
});
