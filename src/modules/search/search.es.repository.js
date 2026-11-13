import { esClient, INDEX } from "../../configs/integrations/elasticsearch.js";

const SORT_MAP = {
  price_asc: [{ minPrice: "asc" }],
  price_desc: [{ minPrice: "desc" }],
  rating: [{ "reviewStats.average": "desc" }, { "reviewStats.count": "desc" }],
  createdAt_desc: [{ createdAt: "desc" }],
  createdAt_asc: [{ createdAt: "asc" }],
  name_asc: [{ "name.keyword": "asc" }],
};

const buildSort = (sort, hasQuery) => {
  if (SORT_MAP[sort]) return SORT_MAP[sort];
  return hasQuery
    ? ["_score", { "reviewStats.average": "desc" }]
    : [{ createdAt: "desc" }];
};

// why: empty bool filter matches all docs — safe fallback when no clauses exist
const toFilter = (clauses) =>
  clauses.length ? { bool: { filter: clauses } } : { match_all: {} };

export const searchESRepository = {
  search: async ({ q, filters, sort, from, size }) => {
    const must = [];

    if (q) {
      // why: fuzziness rewrites the query into extra term variants — worth the CPU cost
      // on name/tags (where users actually mistype), but wasteful on free-text fields
      // like description that rarely benefit from it, especially at higher QPS
      must.push({
        bool: {
          should: [
            {
              multi_match: {
                query: q,
                fields: ["name^3", "tags^2"],
                type: "best_fields",
                fuzziness: "AUTO",
                prefix_length: 2,
                max_expansions: 50,
              },
            },
            {
              multi_match: {
                query: q,
                fields: ["description", "categoryName", "brandName"],
                type: "best_fields",
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    // why: split filters into groups so each aggregation can exclude its own group
    const categoryFilter = filters.categorySlugs?.length
      ? [{ terms: { categorySlug: filters.categorySlugs } }]
      : [];

    const brandFilter = filters.brandSlug
      ? [{ term: { brandSlug: filters.brandSlug } }]
      : [];

    const priceFilter = (() => {
      if (filters.minPrice === undefined && filters.maxPrice === undefined) return [];
      const range = {};
      if (filters.minPrice !== undefined) range.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) range.lte = filters.maxPrice;
      return [{ range: { minPrice: range } }];
    })();

    const otherFilters = [
      ...(filters.tags?.length ? [{ terms: { tags: filters.tags } }] : []),
      ...(filters.inStock ? [{ term: { inStock: true } }] : []),
      ...(filters.isFeatured ? [{ term: { isFeatured: true } }] : []),
      ...(filters.minRating ? [{ range: { "reviewStats.average": { gte: filters.minRating } } }] : []),
    ];

    const allFacetFilters = [...categoryFilter, ...brandFilter, ...priceFilter, ...otherFilters];

    return esClient.search({
      index: INDEX,
      from,
      size,
      query: {
        bool: {
          must: must.length ? must : [{ match_all: {} }],
          filter: [{ term: { isActive: true } }],
        },
      },
      // why: post_filter applies all facet filters to hits without touching aggregations
      ...(allFacetFilters.length && { post_filter: { bool: { filter: allFacetFilters } } }),
      sort: buildSort(sort, !!q),
      aggs: {
        // why: each agg filters by everything EXCEPT its own group, so its counts
        // reflect the current context while remaining adjustable by the user
        categories: {
          filter: toFilter([...brandFilter, ...priceFilter, ...otherFilters]),
          aggs: {
            inner: {
              terms: { field: "categorySlug", size: 50, shard_size: 200 },
              aggs: { name: { terms: { field: "categoryName.keyword", size: 1 } } },
            },
          },
        },

        brands: {
          filter: toFilter([...categoryFilter, ...priceFilter, ...otherFilters]),
          aggs: {
            inner: {
              terms: { field: "brandSlug", size: 50, shard_size: 200 },
              aggs: { name: { terms: { field: "brandName.keyword", size: 1 } } },
            },
          },
        },

        // why: excludes price itself so the slider always shows the full range
        // for the current context
        price_stats: {
          filter: toFilter([...categoryFilter, ...brandFilter, ...otherFilters]),
          aggs: { inner: { stats: { field: "minPrice" } } },
        },

        rating_dist: {
          range: {
            field: "reviewStats.average",
            ranges: [
              { key: "4+", from: 4 },
              { key: "3+", from: 3, to: 4 },
              { key: "2+", from: 2, to: 3 },
              { key: "1+", from: 1, to: 2 },
            ],
          },
        },
        in_stock: { filter: { term: { inStock: true } } },
      },
      highlight: {
        fields: {
          name: { pre_tags: ["<mark>"], post_tags: ["</mark>"] },
          description: {
            pre_tags: ["<mark>"],
            post_tags: ["</mark>"],
            fragment_size: 160,
            number_of_fragments: 2,
          },
        },
      },
      _source: [
        "slug", "name", "description",
        "categoryId", "categorySlug", "categoryName",
        "brandId", "brandSlug", "brandName", "tags",
        "thumbnail", "minPrice", "maxPrice", "minOriginalPrice", "inStock", "isFeatured", "firstVariantId",
        "reviewStats", "createdAt",
      ],
    });
  },

  suggest: async (q) => {
    const response = await esClient.search({
      index: INDEX,
      size: 8,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: q,
                fields: ["name^3", "categoryName", "brandName", "tags"],
                type: "phrase_prefix",
              },
            },
          ],
          filter: [{ term: { isActive: true } }],
        },
      },
      _source: ["slug", "name", "thumbnail", "minPrice", "categoryName"],
    });

    return response.hits.hits.map((h) => ({ ...h._source }));
  },

  trending: async (limit) => {
    const response = await esClient.search({
      index: INDEX,
      size: limit,
      query: { bool: { filter: [{ term: { isActive: true } }] } },
      sort: [{ "reviewStats.count": "desc" }, { "reviewStats.average": "desc" }],
      _source: ["slug", "name"],
    });
    return response.hits.hits.map((h) => ({ term: h._source.name, slug: h._source.slug }));
  },
};
