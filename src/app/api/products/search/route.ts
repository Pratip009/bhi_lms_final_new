import { NextRequest, NextResponse } from "next/server";
// ⚠️ Adjust these two imports to match your actual project paths/names —
// e.g. if your connection helper is `@/lib/mongodb` or `connectDB`, swap it in.
import db from "@/lib/db";
import Product from "@/models/Product";
// Registers the Category/Subcategory/SubSubcategory schemas with Mongoose.
// Not used directly here, but .populate("category"/"subcategory"/
// "subSubcategory") below needs each ref model already registered in this
// process — otherwise Mongoose throws "MissingSchemaError: Schema hasn't
// been registered for model 'Category'" the first time this route bundle
// runs without something else having imported them first.
import "@/models/Category";
import "@/models/Subcategory";
import "@/models/SubSubcategory";
import { buildProductSearchOr } from "@/lib/productSearchQuery";

export const dynamic = "force-dynamic";

// The matching rules (per-word AND across name/brand/model/gem/SKU/
// description/approxWeight, plus carat / gram / mm / WxH numeric matching)
// live in src/lib/productSearchQuery.ts so the dropship seller catalog
// searches exactly the same way this homepage search does.

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Capped at 200, not 50: this endpoint has no relevance sort (plain $or,
  // no text index), so Mongo returns matching documents in essentially
  // arbitrary order. The client re-ranks by relevance after fetching (see
  // scoreProduct in SearchBar.tsx) — but it can only rank documents that
  // actually made it into this response. A low cap here was silently
  // dropping genuinely relevant products whenever a query also (loosely)
  // matched a lot of unrelated ones, especially with the broad
  // name/description fallback regexes for mm/dimension queries.
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 30) || 30, 200);

  if (!q) return NextResponse.json({ data: [] });

  await db();

  const or = buildProductSearchOr(q);
  if (!or) return NextResponse.json({ data: [] });

  const products = await Product.find({
    isActive: { $ne: false },
    $or: or,
  })
    .select(
      "name slug price images image category subcategory subSubcategory productKind watchBrand watchModel gemstoneName legacySku description size caratWeight weight dimensions approxWeight shape color clarity certification"
    )
    // Product now has a real `slug` field (see Product.slug in the model) —
    // it's included above so the client can route straight to
    // /products/<slug> instead of falling back to a fuzzy
    // /products?search= listing for every result. Populating `category`
    // here (previously left as a bare ObjectId) also fixes the category
    // name shown under each result in the dropdown.
    //
    // `subcategory`/`subSubcategory` are populated too so the dropdown can
    // show the full taxonomy path a product lives under (e.g.
    // "Diamonds › White Diamonds"), not just the top-level category.
    .populate("category", "name slug")
    .populate("subcategory", "name slug")
    .populate("subSubcategory", "name slug")
    .limit(limit)
    .lean();

  return NextResponse.json({ data: products });
}