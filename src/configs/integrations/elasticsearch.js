import { Client } from "@elastic/elasticsearch";
import { logger } from "../../shared/utils/logger.js";
import { CircuitBreaker } from "../../shared/utils/circuit-breaker.js";

export const INDEX = "products";

const MAPPING = {
  settings: {
    max_result_window: 50_000,
    analysis: {
      analyzer: {
        product_analyzer: {
          type: "custom",
          tokenizer: "standard",
          filter: ["lowercase", "asciifolding", "word_delimiter_graph"],
        },
      },
    },
  },
  mappings: {
    dynamic: "strict",
    properties: {
      name: {
        type: "text",
        analyzer: "product_analyzer",
        fields: { keyword: { type: "keyword" } },
      },
      slug: { type: "keyword" },
      description: { type: "text", analyzer: "product_analyzer" },
      categoryId: { type: "keyword" },
      categorySlug: { type: "keyword" },
      categoryName: {
        type: "text",
        analyzer: "product_analyzer",
        fields: { keyword: { type: "keyword" } },
      },
      brandId: { type: "keyword" },
      brandSlug: { type: "keyword" },
      brandName: {
        type: "text",
        analyzer: "product_analyzer",
        fields: { keyword: { type: "keyword" } },
      },
      tags: { type: "keyword" },
      isActive: { type: "boolean" },
      isFeatured: { type: "boolean" },
      thumbnail: { type: "keyword", index: false, doc_values: false },
      minPrice: { type: "float" },
      maxPrice: { type: "float" },
      minOriginalPrice: { type: "float" },
      inStock: { type: "boolean" },
      firstVariantId: { type: "keyword" },
      reviewStats: {
        properties: {
          count: { type: "integer" },
          average: { type: "float" },
        },
      },
      createdAt: { type: "date" },
      updatedAt: { type: "date" },
    },
  },
};

export let esClient = null;
export let esAvailable = false;

// why: single breaker instance shared across all ES search calls — opens after 5 failures, probes after 30s
export const esBreaker = new CircuitBreaker("elasticsearch", {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30_000,
});

export const connectES = async () => {
  const url = process.env.ELASTICSEARCH_URL;
  if (!url) {
    logger.warn("[ES] ELASTICSEARCH_URL not set -- search will fall back to MongoDB");
    return;
  }

  try {
    // why: maxRetries: 0 — the transport layer's own retries would otherwise happen
    // underneath esBreaker/withRetry, so "1 failure" the breaker counts could already
    // be 3 real round-trips, slowing down failure detection
    esClient = new Client({ node: url, maxRetries: 0 });
    await esClient.ping();

    const exists = await esClient.indices.exists({ index: INDEX });
    if (!exists) {
      await esClient.indices.create({ index: INDEX, ...MAPPING });
      logger.info("[ES] products index created");
    }

    esAvailable = true;
    logger.info("[ES] connected successfully");
  } catch (err) {
    logger.error({ err }, "[ES] connection failed -- search will fall back to MongoDB");
    esAvailable = false;
  }
};
