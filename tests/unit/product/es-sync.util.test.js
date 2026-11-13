import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncProductsBatch } from "../../../src/shared/utils/es-sync.util.js";
import { esClient } from "../../../src/configs/integrations/elasticsearch.js";
import { Product } from "../../../src/models/product.model.js";

vi.mock("../../../src/configs/integrations/elasticsearch.js", () => ({
  esClient: { bulk: vi.fn() },
  esAvailable: true,
  INDEX: "products",
}));
vi.mock("../../../src/models/product.model.js", () => ({
  Product: { find: vi.fn() },
}));
vi.mock("../../../src/shared/utils/logger.js", () => ({
  logger: { warn: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  Product.find.mockReturnValue({
    lean: () => Promise.resolve([{ _id: "product-1", variants: [] }]),
  });
});

describe("Elasticsearch product sync", () => {
  it("reports failed bulk items so the worker can retry the batch", async () => {
    esClient.bulk.mockResolvedValue({
      errors: true,
      items: [{ index: { status: 429, error: { type: "rejected" } } }],
    });

    await expect(syncProductsBatch(["product-1"])).rejects.toThrow(
      "Elasticsearch bulk items failed",
    );
    expect(esClient.bulk).toHaveBeenCalledTimes(3);
  });

  it("accepts a missing delete target as an idempotent result", async () => {
    Product.find.mockReturnValue({ lean: () => Promise.resolve([]) });
    esClient.bulk.mockResolvedValue({
      errors: true,
      items: [{ delete: { status: 404, error: { type: "not_found" } } }],
    });

    await expect(syncProductsBatch(["product-1"])).resolves.toBeUndefined();
  });
});
