import mongoose, { PipelineStage } from 'mongoose';
import Product from '@/models/Product';
import '@/lib/registerModels';
import {
  buildProductFilterQuery,
  resolveSlugFilters,
  ProductFilterParams,
} from './productFilter.service';
import { buildProductSearchOr, MAX_SEARCH_QUERY_LENGTH } from '@/lib/productSearchQuery';
import { escapeRegex } from '@/lib/search';

/**
 * The seller-facing catalog behind the dropship portal's product browser.
 *
 *  - Search uses the exact rules as the homepage search bar
 *    (src/lib/productSearchQuery.ts): every word, any field, plus carat /
 *    grams / mm / WxH matching.
 *  - Filters reuse the storefront filter builder (category, subcategory,
 *    kind, price, shape, colour, clarity, certification, watch attributes).
 *  - "In stock" means stock that can actually be ordered — stock minus units
 *    held for memos — the same rule the order submit enforces.
 *  - With a query, results are ranked by relevance across the WHOLE result
 *    set (exact model/SKU first, then name prefix, name, SKU, stone name),
 *    not just re-sorted page by page.
 */

export type CatalogSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'name_asc';

export interface CatalogParams {
  q?: string;
  category?: string;
  subcategory?: string;
  productKind?: string;
  priceMin?: string;
  priceMax?: string;
  inStock?: boolean;
  sortBy?: CatalogSort;
  page?: number;
  limit?: number;
  // Attribute filters (same names as the storefront /products filters)
  shape?: string[];
  color?: string[];
  clarity?: string[];
  certification?: string[];
  watchBrand?: string[];
  watchMovement?: string[];
  watchStrapType?: string[];
  watchCaseMaterial?: string[];
  watchDialColor?: string[];
  watchFeatures?: string[];
  watchStyle?: string[];
  watchGender?: string;
  watchCaseSize?: string;
}

export const CATALOG_MAX_LIMIT = 48;
const PRODUCT_KINDS = ['diamond', 'gemstone', 'watch', 'jewelry'];
const SLUG_RX = /^[a-z0-9-]{1,120}$/;

const LIST_PROJECTION = {
  name: 1,
  slug: 1,
  price: 1,
  images: { $slice: ['$images', 1] },
  image: 1,
  productKind: 1,
  legacySku: 1,
  watchModel: 1,
  watchBrand: 1,
  gemstoneName: 1,
  category: 1,
  subcategory: 1,
  subSubcategory: 1,
  size: 1,
  caratWeight: 1,
  shape: 1,
  color: 1,
  clarity: 1,
  dimensions: 1,
  approxWeight: 1,
  createdAt: 1,
  available: 1,
};

const AVAILABLE_EXPR = {
  $max: [0, { $subtract: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$reservedForMemo', 0] }] }],
};

function relevanceScoreExpr(q: string) {
  const qEsc = escapeRegex(q);
  const has = (field: string, regex: string) => ({
    $cond: [{ $regexMatch: { input: { $ifNull: [field, ''] }, regex, options: 'i' } }, 1, 0],
  });
  return {
    $add: [
      { $multiply: [has('$legacySku', `^${qEsc}$`), 120] },
      { $multiply: [has('$watchModel', `^${qEsc}$`), 120] },
      { $multiply: [has('$name', `^${qEsc}`), 60] },
      { $multiply: [has('$name', qEsc), 35] },
      { $multiply: [has('$legacySku', qEsc), 30] },
      { $multiply: [has('$watchModel', qEsc), 30] },
      { $multiply: [has('$gemstoneName', qEsc), 18] },
      { $multiply: [has('$watchBrand', qEsc), 15] },
    ],
  };
}

async function buildMatch(params: CatalogParams, { omitKind = false } = {}) {
  const filterParams: ProductFilterParams = {
    category: params.category && SLUG_RX.test(params.category) ? params.category : undefined,
    subcategory: params.subcategory && SLUG_RX.test(params.subcategory) ? params.subcategory : undefined,
    productKind:
      !omitKind && params.productKind && PRODUCT_KINDS.includes(params.productKind)
        ? params.productKind
        : undefined,
    priceMin: params.priceMin,
    priceMax: params.priceMax,
    shape: params.shape,
    color: params.color,
    clarity: params.clarity,
    certification: params.certification,
    watchBrand: params.watchBrand,
    watchMovement: params.watchMovement,
    watchStrapType: params.watchStrapType,
    watchCaseMaterial: params.watchCaseMaterial,
    watchDialColor: params.watchDialColor,
    watchFeatures: params.watchFeatures,
    watchStyle: params.watchStyle,
    watchGender: params.watchGender,
    watchCaseSize: params.watchCaseSize,
  };

  // Unknown slugs resolve to a never-matching id (see lookupCategoryId),
  // so a bad filter shows "no results" rather than the whole catalog.
  const resolved = await resolveSlugFilters(filterParams);

  const { query } = buildProductFilterQuery(resolved);
  const match: Record<string, any> = { ...query };
  const and: Record<string, unknown>[] = Array.isArray(match.$and) ? [...match.$and] : [];

  const searchOr = buildProductSearchOr(params.q ?? '');
  if (searchOr) and.push({ $or: searchOr });

  if (params.inStock !== false) {
    and.push({
      $expr: {
        $gt: [{ $subtract: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$reservedForMemo', 0] }] }, 0],
      },
    });
  }
  if (and.length) match.$and = and;
  return match;
}

export async function searchDropshipCatalog(params: CatalogParams) {
  const q = (params.q ?? '').trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  const page = Math.max(1, Math.floor(params.page || 1));
  const limit = Math.min(CATALOG_MAX_LIMIT, Math.max(1, Math.floor(params.limit || 24)));
  const sortBy: CatalogSort = params.sortBy || (q ? 'relevance' : 'newest');

  const [match, kindMatch] = await Promise.all([
    buildMatch({ ...params, q }),
    buildMatch({ ...params, q }, { omitKind: true }),
  ]);

  const sortStage: Record<string, 1 | -1> =
    sortBy === 'price_asc' ? { price: 1, _id: 1 }
    : sortBy === 'price_desc' ? { price: -1, _id: 1 }
    : sortBy === 'name_asc' ? { name: 1, _id: 1 }
    : sortBy === 'relevance' && q ? { _score: -1, createdAt: -1, _id: 1 }
    : { createdAt: -1, _id: 1 };

  const pipeline: PipelineStage[] = [{ $match: match }];
  if (sortBy === 'relevance' && q) pipeline.push({ $addFields: { _score: relevanceScoreExpr(q) } });
  pipeline.push(
    { $sort: sortStage },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $addFields: { available: AVAILABLE_EXPR } },
    { $project: LIST_PROJECTION }
  );

  const [rows, total, kindCounts] = await Promise.all([
    Product.aggregate(pipeline),
    Product.countDocuments(match),
    Product.aggregate([
      { $match: kindMatch },
      { $group: { _id: '$productKind', count: { $sum: 1 } } },
    ]),
  ]);

  const products = await Product.populate(rows, [
    { path: 'category', select: 'name slug' },
    { path: 'subcategory', select: 'name slug' },
    { path: 'subSubcategory', select: 'name slug' },
  ]);

  const kinds: Record<string, number> = { all: 0 };
  for (const k of kindCounts as Array<{ _id: string | null; count: number }>) {
    kinds.all += k.count;
    if (k._id) kinds[k._id] = k.count;
  }

  return {
    products,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    kinds,
    sortBy,
  };
}

/** One product with its live orderable quantity — used after picking a product from the search dropdown. */
export async function getDropshipCatalogProduct(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  const rows = await Product.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(id), isActive: { $ne: false } } },
    { $addFields: { available: AVAILABLE_EXPR } },
    { $project: LIST_PROJECTION },
  ]);
  if (!rows.length) return null;
  const [product] = await Product.populate(rows, [
    { path: 'category', select: 'name slug' },
    { path: 'subcategory', select: 'name slug' },
    { path: 'subSubcategory', select: 'name slug' },
  ]);
  return product;
}
