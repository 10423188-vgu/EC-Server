import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchService } from "../../../src/modules/search/search.service.js";
import { searchESRepository } from "../../../src/modules/search/search.es.repository.js";
import { Product } from "../../../src/models/product.model.js";

vi.mock("../../../src/configs/integrations/elasticsearch.js", () => ({
  esAvailable: true,
  esBreaker: { execute: (operation) => operation() },
}));
vi.mock("../../../src/modules/search/search.es.repository.js", () => ({
  searchESRepository: { search: vi.fn(), suggest: vi.fn(), trending: vi.fn() },
}));
vi.mock("../../../src/models/product.model.js", () => ({
  Product: { find: vi.fn(), countDocuments: vi.fn(), aggregate: vi.fn() },
}));
vi.mock("../../../src/configs/cache/redis.js", () => ({
  redisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
  },
  redisCircuit: { execute: (operation) => operation() },
}));
vi.mock("../../../src/shared/utils/es-sync.util.js", () => ({
  reindexAllProducts: vi.fn(),
}));
vi.mock("../../../src/shared/utils/logger.js", () => ({
  logger: { warn: vi.fn() },
}));

const live = {
  _id: "live-id",
  slug: "live",
  name: "Live product",
  variants: [{ _id: "live-variant", isActive: true, price: 100, stock: 2 }],
};
const request = { q: "", filters: {}, sort: "name_asc", page: 1, limit: 10 };
const esResponse = (slug, firstVariantId) => ({
  hits: {
    total: { value: 1 },
    hits: [{ _id: "es-id", _source: { slug, firstVariantId } }],
  },
  aggregations: {
    categories: { inner: { buckets: [] } },
    brands: { inner: { buckets: [] } },
    price_stats: { inner: {} },
    rating_dist: { buckets: [] },
    in_stock: { doc_count: 0 },
  },
});
const query = (rows) => {
  const chain = { lean: () => Promise.resolve(rows) };
  for (const method of ["sort", "skip", "limit", "maxTimeMS", "select"])
    chain[method] = () => chain;
  return chain;
};
beforeEach(() => {
  vi.clearAllMocks();
  Product.find.mockImplementation((filter) => query(filter.slug ? [] : [live]));
  Product.countDocuments.mockReturnValue({ maxTimeMS: () => Promise.resolve(1) });
  Product.aggregate.mockReturnValue({ option: () => Promise.resolve([]) });
});

describe("search visibility during asynchronous indexing", () => {
  it("shares one Mongo fallback query across identical concurrent requests", async () => {
    searchESRepository.search.mockRejectedValue(new Error("ES down"));
    const [first, second] = await Promise.all([
      searchService.search(request),
      searchService.search(request),
    ]);

    expect(first.source).toBe("mongodb");
    expect(second.source).toBe("mongodb");
    expect(Product.countDocuments).toHaveBeenCalledTimes(1);
    expect(Product.aggregate).toHaveBeenCalledTimes(2);
  });

  it("falls back to current Mongo results when ES still contains a deleted product", async () => {
    searchESRepository.search.mockResolvedValue(
      esResponse("deleted", "old-variant"),
    );
    const result = await searchService.search(request);
    expect(result.source).toBe("mongodb");
    expect(result.data.map((product) => product.slug)).toEqual(["live"]);
    expect(result.pagination.total).toBe(1);
    expect(Product.find).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true, deletedAt: null }),
      expect.any(Object),
    );
  });

  it("rejects an ES add-to-cart variant that has been soft deleted", async () => {
    searchESRepository.search.mockResolvedValue(
      esResponse("live", "deleted-variant"),
    );
    Product.find.mockImplementation((filter) =>
      query(
        filter.slug
          ? [
              {
                ...live,
                variants: [
                  {
                    _id: "deleted-variant",
                    isActive: true,
                    deletedAt: new Date(),
                  },
                ],
              },
            ]
          : [live],
      ),
    );
    const result = await searchService.search(request);
    expect(result.source).toBe("mongodb");
    expect(result.data[0].firstVariantId).toBe("live-variant");
  });

  it("uses one batched visibility read for valid ES results", async () => {
    searchESRepository.search.mockResolvedValue(
      esResponse("live", "live-variant"),
    );
    Product.find.mockReturnValue(query([live]));
    const result = await searchService.search(request);
    expect(result.source).toBe("elasticsearch");
    expect(Product.find).toHaveBeenCalledTimes(1);
    expect(Product.aggregate).not.toHaveBeenCalled();
  });

  it("keeps deleted products out of suggestions and trending during index lag", async () => {
    searchESRepository.suggest.mockResolvedValue([
      { slug: "deleted", name: "Deleted" },
    ]);
    searchESRepository.trending.mockResolvedValue([
      { slug: "deleted", term: "Deleted" },
    ]);
    expect(
      (await searchService.suggest("li")).map((product) => product.slug),
    ).toEqual(["live"]);
    expect(
      (await searchService.trending()).map((product) => product.slug),
    ).toEqual(["live"]);
  });
});
