// Server-side "what counts as a match" for free-text product search.
//
// Extracted verbatim from app/api/products/search/route.ts (the homepage
// SearchBar's backend) so the dropship seller catalog
// (app/api/dropship/portal/[token]/catalog/route.ts) matches products with
// exactly the same rules as the homepage search — per-word AND matching
// across every searchable field, plus numeric carat / gram / mm / WxH
// dimension matching. Change the rules here and both searches follow.

import {
  extractCarat,
  extractWeight,
  extractMm,
  extractDimensions,
  buildDimensionRegex,
  escapeRegex,
  CARAT_MATCH_TOLERANCE,
  weightTolerance,
  mmTolerance,
} from "@/lib/search";

// Every field a query token is allowed to match against. `legacySku` and
// `watchModel` are what customers mean by "model number" (see the original
// comment history in app/api/products/search/route.ts).
export const SEARCHABLE_FIELDS = [
  "name",
  "watchBrand",
  "watchModel",
  "gemstoneName",
  "legacySku",
  "description",
  "approxWeight",
] as const;

/** Longest query we'll compile into regexes — protects the DB from pathological input. */
export const MAX_SEARCH_QUERY_LENGTH = 120;

/**
 * Builds the `$or` array for a free-text product query, or `null` for an
 * empty query. Callers AND it onto their own filter:
 *   { isActive: { $ne: false }, $or: buildProductSearchOr(q) }
 */
export function buildProductSearchOr(
  rawQuery: string
): Record<string, unknown>[] | null {
  const q = (rawQuery ?? "").trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (!q) return null;

  const carat = extractCarat(q);
  const gramWeight = extractWeight(q);
  // A "WxH" query like "14.5x9.3mm" also looks like a lone mm spec to
  // extractMm — check dimensions first and skip the single-number mm check.
  const dims = extractDimensions(q);
  const mmSize = dims ? null : extractMm(q);

  // AND across tokens (every word must be found somewhere), OR across
  // fields for each individual token (a word can live in any field).
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const tokenClauses = tokens.map((token) => {
    const rx = new RegExp(escapeRegex(token), "i");
    return { $or: SEARCHABLE_FIELDS.map((field) => ({ [field]: rx })) };
  });

  const wholePhraseRx = new RegExp(escapeRegex(q), "i");
  const wholePhraseClause = {
    $or: SEARCHABLE_FIELDS.map((field) => ({ [field]: wholePhraseRx })),
  };

  const or: Record<string, unknown>[] = [{ $and: tokenClauses }, wholePhraseClause];

  if (carat !== null) {
    const range = { $gte: carat - CARAT_MATCH_TOLERANCE, $lte: carat + CARAT_MATCH_TOLERANCE };
    or.push({ size: range });
    or.push({ caratWeight: range });
  }

  if (gramWeight !== null) {
    const tol = weightTolerance(gramWeight);
    or.push({ weight: { $gte: gramWeight - tol, $lte: gramWeight + tol } });
  }

  if (mmSize !== null) {
    const tol = mmTolerance(mmSize);
    or.push({ size: { $gte: mmSize - tol, $lte: mmSize + tol } });
    const mmTextRx = new RegExp(`${escapeRegex(String(mmSize))}\\s*mm`, "i");
    or.push({ name: mmTextRx });
    or.push({ description: mmTextRx });
  }

  if (dims !== null) {
    const dimRx = buildDimensionRegex(dims);
    or.push({ dimensions: dimRx });
    or.push({ name: dimRx });
    or.push({ description: dimRx });
  }

  return or;
}
