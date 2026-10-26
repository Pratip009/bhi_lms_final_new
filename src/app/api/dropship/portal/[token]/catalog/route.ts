import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { requireActiveDropshipSeller, DropshipError } from '@/services/dropship.service';
import {
  searchDropshipCatalog,
  getDropshipCatalogProduct,
  CatalogSort,
} from '@/services/dropshipCatalog.service';

export const dynamic = 'force-dynamic';

const SORTS: CatalogSort[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'name_asc'];
const MULTI = [
  'shape', 'color', 'clarity', 'certification',
  'watchBrand', 'watchMovement', 'watchStrapType', 'watchCaseMaterial',
  'watchDialColor', 'watchFeatures', 'watchStyle',
] as const;

function list(sp: URLSearchParams, key: string): string[] | undefined {
  const vals = sp.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  return vals.length ? vals.slice(0, 20).map((v) => v.slice(0, 60)) : undefined;
}

function num(v: string | null): string | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
}

/**
 * GET /api/dropship/portal/[token]/catalog
 *   ?q=&category=&subcategory=&productKind=&priceMin=&priceMax=
 *   &inStock=true|false&sortBy=&page=&limit=&shape=…&color=…&watchBrand=…
 *   or ?id=<productId> for one product with live availability.
 *
 * Approved, active sellers only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const rate = await rateLimit(req, {
      id: 'dropship-catalog',
      limit: 900,
      windowSec: 3600,
      extraKey: token,
      scope: 'key',
    });
    if (!rate.success) return rateLimitResponse(rate);

    await requireActiveDropshipSeller(token);
    const sp = req.nextUrl.searchParams;

    const id = sp.get('id');
    if (id) {
      const product = await getDropshipCatalogProduct(id);
      if (!product) return errorResponse('That product is no longer available.', 404);
      return successResponse({ product });
    }

    const sortRaw = sp.get('sortBy') as CatalogSort | null;
    const attrs: Record<string, string[] | undefined> = {};
    for (const key of MULTI) attrs[key] = list(sp, key);

    const result = await searchDropshipCatalog({
      q: sp.get('q') ?? undefined,
      category: sp.get('category') ?? undefined,
      subcategory: sp.get('subcategory') ?? undefined,
      productKind: sp.get('productKind') ?? undefined,
      priceMin: num(sp.get('priceMin')),
      priceMax: num(sp.get('priceMax')),
      inStock: sp.get('inStock') !== 'false',
      sortBy: sortRaw && SORTS.includes(sortRaw) ? sortRaw : undefined,
      page: Number(sp.get('page')) || 1,
      limit: Number(sp.get('limit')) || 24,
      watchGender: sp.get('watchGender')?.slice(0, 40) || undefined,
      watchCaseSize: sp.get('watchCaseSize')?.slice(0, 40) || undefined,
      ...attrs,
    });

    return successResponse(result);
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    console.error('GET /api/dropship/portal/[token]/catalog error:', err);
    return errorResponse('Could not load products. Please try again.', 500);
  }
}
