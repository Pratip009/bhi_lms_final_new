"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchBar, { type SearchSelection } from "@/components/ui/SearchBar";

const GOLD = "#c9a84c";
const INK = "#1a1714";
const MUTED = "#4d463f";
const BORDER = "#e4dfd2";
const CREAM = "#fffdf9";
const RED = "#a6402b";
const GREEN = "#1f6b4a";

export type CatalogProduct = {
  _id: string;
  name: string;
  slug?: string;
  price: number;
  images?: string[];
  image?: string;
  productKind?: "diamond" | "gemstone" | "watch" | "jewelry";
  legacySku?: string;
  watchModel?: string;
  watchBrand?: string;
  gemstoneName?: string;
  size?: number;
  caratWeight?: number;
  dimensions?: string;
  approxWeight?: string;
  category?: { name: string; slug: string } | string | null;
  subcategory?: { name: string; slug: string } | string | null;
  subSubcategory?: { name: string; slug: string } | string | null;
  available: number;
};

type Category = {
  _id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  subcategories?: { _id: string; name: string; slug: string; isActive?: boolean }[];
};

type Sort = "relevance" | "newest" | "price_asc" | "price_desc" | "name_asc";

type Filters = {
  q: string;
  productKind: string;
  category: string;
  subcategory: string;
  priceMin: string;
  priceMax: string;
  inStock: boolean;
  sortBy: Sort | "";
  attrs: { param: string; value: string; label: string }[];
  page: number;
};

const INITIAL: Filters = {
  q: "",
  productKind: "",
  category: "",
  subcategory: "",
  priceMin: "",
  priceMax: "",
  inStock: true,
  sortBy: "",
  attrs: [],
  page: 1,
};

const PAGE_SIZE = 24;

const KINDS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "diamond", label: "Diamonds" },
  { value: "gemstone", label: "Gemstones" },
  { value: "jewelry", label: "Jewelry" },
  { value: "watch", label: "Watches" },
];

// SearchBar's filter chips use storefront URL param names — map them to the catalog API's.
const ATTR_PARAM_MAP: Record<string, string> = {
  shape: "shape",
  color: "color",
  clarity: "clarity",
  certification: "certification",
  brand: "watchBrand",
  movement: "watchMovement",
  strapType: "watchStrapType",
  caseMaterial: "watchCaseMaterial",
  dialColor: "watchDialColor",
  feature: "watchFeatures",
  style: "watchStyle",
  gender: "watchGender",
  caseSize: "watchCaseSize",
};

const SORT_LABELS: Record<Sort, string> = {
  relevance: "Best match",
  newest: "Newest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name_asc: "Name: A to Z",
};

export function productImageOf(p: { images?: string[]; image?: string }): string | undefined {
  return p.images?.[0] || p.image || undefined;
}
export function productCodeOf(p: { legacySku?: string; watchModel?: string }): string | undefined {
  return p.legacySku || p.watchModel || undefined;
}
export function productPathOf(p: CatalogProduct): string {
  return [p.category, p.subcategory, p.subSubcategory]
    .map((l) => (l && typeof l === "object" ? l.name : null))
    .filter(Boolean)
    .join(" › ");
}
const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  const rx = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return (
    <>
      {text.split(rx).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} style={{ background: "#f6e7b8", color: INK, borderRadius: 2, padding: "0 1px" }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function StockPill({ available }: { available: number }) {
  if (available <= 0)
    return <span className="text-[11px] font-semibold" style={{ color: RED }}>Out of stock</span>;
  if (available <= 3)
    return <span className="text-[11px] font-semibold" style={{ color: "#9c6a12" }}>Only {available} left</span>;
  return <span className="text-[11px] font-semibold" style={{ color: GREEN }}>{available} in stock</span>;
}

export default function DropshipProductBrowser({
  token,
  onSelect,
  selectedId,
}: {
  token: string;
  onSelect: (product: CatalogProduct) => void;
  selectedId?: string | null;
}) {
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [kinds, setKinds] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceDraft, setPriceDraft] = useState({ min: "", max: "" });
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const update = useCallback((patch: Partial<Filters>, keepPage = false) => {
    setFilters((f) => ({ ...f, ...patch, page: keepPage ? (patch.page ?? f.page) : 1 }));
  }, []);

  // Categories for the dropdowns (same public endpoint the homepage search uses).
  useEffect(() => {
    fetch("/api/categories?withSubcategories=true")
      .then((r) => r.json())
      .then((d) => {
        const list: Category[] = Array.isArray(d) ? d : d?.data ?? d?.categories ?? [];
        setCategories(
          list
            .filter((c) => c.isActive !== false)
            .map((c) => ({ ...c, subcategories: (c.subcategories ?? []).filter((s) => s.isActive !== false) }))
        );
      })
      .catch(() => {});
  }, []);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.productKind) sp.set("productKind", filters.productKind);
    if (filters.category) sp.set("category", filters.category);
    if (filters.subcategory) sp.set("subcategory", filters.subcategory);
    if (filters.priceMin) sp.set("priceMin", filters.priceMin);
    if (filters.priceMax) sp.set("priceMax", filters.priceMax);
    if (!filters.inStock) sp.set("inStock", "false");
    if (filters.sortBy) sp.set("sortBy", filters.sortBy);
    for (const a of filters.attrs) sp.append(a.param, a.value);
    sp.set("page", String(filters.page));
    sp.set("limit", String(PAGE_SIZE));
    return sp.toString();
  }, [filters]);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dropship/portal/${token}/catalog?${queryString}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Could not load products.");
        setProducts(data.data.products ?? []);
        setTotal(data.data.total ?? 0);
        setPages(data.data.pages ?? 1);
        setKinds(data.data.kinds ?? {});
        setLoading(false);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Could not load products.");
        setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [token, queryString, reloadKey]);

  // Search bar: same component as the homepage, but picks drive this screen.
  const handleSearchSelect = useCallback(
    async (sel: SearchSelection) => {
      setNotice(null);
      if (sel.type === "query") {
        update({ q: sel.q, sortBy: "" });
      } else if (sel.type === "category") {
        update({ category: sel.categorySlug, subcategory: "" });
      } else if (sel.type === "subcategory") {
        update({ category: sel.categorySlug, subcategory: sel.subcategorySlug });
      } else if (sel.type === "attr") {
        const param = ATTR_PARAM_MAP[sel.param] ?? sel.param;
        setFilters((f) => ({
          ...f,
          page: 1,
          productKind: sel.isWatch ? "watch" : f.productKind,
          attrs: f.attrs.some((a) => a.param === param && a.value === sel.value)
            ? f.attrs
            : [...f.attrs, { param, value: sel.value, label: sel.label }],
        }));
      } else if (sel.type === "product") {
        // Fetch live availability before selecting — the dropdown doesn't carry stock.
        setPickingId(sel.product._id);
        try {
          const res = await fetch(`/api/dropship/portal/${token}/catalog?id=${sel.product._id}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "That product is no longer available.");
          const product: CatalogProduct = data.data.product;
          if (product.available <= 0) {
            setNotice(`“${product.name}” is out of stock right now.`);
          } else {
            onSelect(product);
          }
        } catch (err: any) {
          setNotice(err?.message || "That product is no longer available.");
        } finally {
          setPickingId(null);
        }
      }
    },
    [onSelect, token, update]
  );

  const goToPage = (p: number) => {
    update({ page: Math.min(Math.max(1, p), pages) }, true);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const applyPrice = () => {
    const clean = (v: string) => (v && Number(v) >= 0 ? String(Number(v)) : "");
    let min = clean(priceDraft.min);
    let max = clean(priceDraft.max);
    if (min && max && Number(min) > Number(max)) [min, max] = [max, min];
    setPriceDraft({ min, max });
    update({ priceMin: min, priceMax: max });
  };

  const selectedCategory = categories.find((c) => c.slug === filters.category);
  const categoryName = selectedCategory?.name ?? filters.category;
  const subcategoryName =
    selectedCategory?.subcategories?.find((s) => s.slug === filters.subcategory)?.name ?? filters.subcategory;

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”`, clear: () => update({ q: "" }) });
  if (filters.category)
    chips.push({ key: "cat", label: categoryName, clear: () => update({ category: "", subcategory: "" }) });
  if (filters.subcategory)
    chips.push({ key: "sub", label: subcategoryName, clear: () => update({ subcategory: "" }) });
  if (filters.priceMin || filters.priceMax)
    chips.push({
      key: "price",
      label: `${filters.priceMin ? money(Number(filters.priceMin)) : "$0"} – ${filters.priceMax ? money(Number(filters.priceMax)) : "any"}`,
      clear: () => {
        setPriceDraft({ min: "", max: "" });
        update({ priceMin: "", priceMax: "" });
      },
    });
  for (const a of filters.attrs)
    chips.push({
      key: `${a.param}:${a.value}`,
      label: a.label,
      clear: () => setFilters((f) => ({ ...f, page: 1, attrs: f.attrs.filter((x) => x !== a) })),
    });
  const hasFilters = chips.length > 0 || !!filters.productKind || !filters.inStock;

  const clearAll = () => {
    setPriceDraft({ min: "", max: "" });
    setFilters(INITIAL);
  };

  const from = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, filters.page * PAGE_SIZE);
  const effectiveSort: Sort = filters.sortBy || (filters.q ? "relevance" : "newest");
  const selectClass = "rounded-lg border px-3 py-2 text-[13px] outline-none bg-white focus:border-[#c9a84c]";

  return (
    <div ref={topRef} className="scroll-mt-24">
      {/* Search — the homepage search bar, reused */}
      <div className="relative z-30">
        <SearchBar
          dropdownMode="inline"
          enableShortcut={false}
          recentStorageKey="dropship_recent_searches"
          keepQueryOnSubmit
          placeholder="Search by name, stone, carat (0.5 ct), size (6mm), model / SKU…"
          onSelect={handleSearchSelect}
        />
      </div>
      <p className="text-[12px] mt-2" style={{ color: MUTED }}>
        Pick a product from the suggestions, or press Enter to see every match below. Browse with the filters if you’re not sure what to search for.
      </p>

      {notice && (
        <div className="mt-3 rounded-lg border px-4 py-2.5 text-[13px]" style={{ borderColor: "#e5b8ab", background: "#fbede8", color: RED }}>
          {notice}
        </div>
      )}
      {pickingId && (
        <p className="mt-3 text-[12px]" style={{ color: MUTED }}>Checking availability…</p>
      )}

      {/* Kind tabs */}
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Product type">
        {KINDS.map((k) => {
          const active = filters.productKind === k.value;
          const count = k.value ? kinds[k.value] ?? 0 : kinds.all ?? 0;
          return (
            <button
              key={k.value || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => update({ productKind: k.value })}
              className="rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors"
              style={active ? { background: INK, color: "#fff", borderColor: INK } : { background: "#fff", color: MUTED, borderColor: BORDER }}
            >
              {k.label}
              <span className="ml-1.5 text-[11px] font-normal opacity-70">{loading && !Object.keys(kinds).length ? "…" : count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3 rounded-xl border p-3" style={{ borderColor: BORDER, background: CREAM }}>
        <label className="col-span-2 lg:col-span-1">
          <span className="block text-[11px] font-semibold mb-1" style={{ color: MUTED }}>Category</span>
          <select
            value={filters.category}
            onChange={(e) => update({ category: e.target.value, subcategory: "" })}
            className={`${selectClass} w-full`}
            style={{ borderColor: BORDER }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c._id} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 lg:col-span-1">
          <span className="block text-[11px] font-semibold mb-1" style={{ color: MUTED }}>Subcategory</span>
          <select
            value={filters.subcategory}
            onChange={(e) => update({ subcategory: e.target.value })}
            disabled={!selectedCategory?.subcategories?.length}
            className={`${selectClass} w-full disabled:opacity-50`}
            style={{ borderColor: BORDER }}
          >
            <option value="">{selectedCategory ? "All in " + selectedCategory.name : "Choose a category first"}</option>
            {selectedCategory?.subcategories?.map((s) => (
              <option key={s._id} value={s.slug}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="col-span-2 lg:col-span-1">
          <span className="block text-[11px] font-semibold mb-1" style={{ color: MUTED }}>Price (USD)</span>
          <div className="flex items-center gap-1.5">
            <input
              inputMode="decimal"
              placeholder="Min"
              value={priceDraft.min}
              onChange={(e) => setPriceDraft((p) => ({ ...p, min: e.target.value.replace(/[^\d.]/g, "") }))}
              onBlur={applyPrice}
              onKeyDown={(e) => e.key === "Enter" && applyPrice()}
              className={`${selectClass} w-full min-w-0`}
              style={{ borderColor: BORDER }}
              aria-label="Minimum price"
            />
            <span style={{ color: MUTED }}>–</span>
            <input
              inputMode="decimal"
              placeholder="Max"
              value={priceDraft.max}
              onChange={(e) => setPriceDraft((p) => ({ ...p, max: e.target.value.replace(/[^\d.]/g, "") }))}
              onBlur={applyPrice}
              onKeyDown={(e) => e.key === "Enter" && applyPrice()}
              className={`${selectClass} w-full min-w-0`}
              style={{ borderColor: BORDER }}
              aria-label="Maximum price"
            />
          </div>
        </div>
        <label>
          <span className="block text-[11px] font-semibold mb-1" style={{ color: MUTED }}>Sort by</span>
          <select
            value={effectiveSort}
            onChange={(e) => update({ sortBy: e.target.value as Sort })}
            className={`${selectClass} w-full`}
            style={{ borderColor: BORDER }}
          >
            {(Object.keys(SORT_LABELS) as Sort[])
              .filter((s) => s !== "relevance" || filters.q)
              .map((s) => (
                <option key={s} value={s}>{SORT_LABELS[s]}</option>
              ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.inStock}
            onChange={(e) => update({ inStock: e.target.checked })}
            className="w-4 h-4 accent-[#c9a84c]"
          />
          <span className="text-[13px]" style={{ color: INK }}>In stock only</span>
        </label>
      </div>

      {/* Active filter chips + count */}
      <div className="mt-3 flex flex-wrap items-center gap-2 min-h-[28px]">
        <span className="text-[13px] mr-1" style={{ color: MUTED }} aria-live="polite">
          {loading ? "Searching…" : total === 0 ? "No products" : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.clear}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px]"
            style={{ borderColor: `${GOLD}66`, background: `${GOLD}14`, color: INK }}
            aria-label={`Remove filter ${c.label}`}
          >
            {c.label} <span aria-hidden style={{ color: MUTED }}>×</span>
          </button>
        ))}
        {hasFilters && (
          <button type="button" onClick={clearAll} className="text-[12px] font-semibold underline" style={{ color: MUTED }}>
            Clear all
          </button>
        )}
      </div>

      {/* Results */}
      {error ? (
        <div className="mt-4 rounded-xl border px-5 py-8 text-center" style={{ borderColor: "#e5b8ab", background: "#fbede8" }}>
          <p className="text-[14px] font-semibold" style={{ color: RED }}>{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-md px-4 py-2 text-[13px] font-bold"
            style={{ background: RED, color: "#fff" }}
          >
            Try again
          </button>
        </div>
      ) : loading && products.length === 0 ? (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border overflow-hidden animate-pulse" style={{ borderColor: BORDER }}>
              <div className="aspect-square" style={{ background: "#f3efe6" }} />
              <div className="p-3 space-y-2">
                <div className="h-3 rounded" style={{ background: "#f3efe6", width: "85%" }} />
                <div className="h-3 rounded" style={{ background: "#f3efe6", width: "50%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="mt-4 rounded-xl border px-5 py-10 text-center" style={{ borderColor: BORDER, background: CREAM }}>
          <p className="text-[15px] font-semibold" style={{ color: INK }}>No products match these filters.</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>
            {filters.inStock ? "Try fewer filters, a shorter search, or include out-of-stock items." : "Try fewer filters or a shorter search — just the model number often works best."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {filters.inStock && (
              <button type="button" onClick={() => update({ inStock: false })} className="rounded-md border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: GOLD, color: INK }}>
                Include out-of-stock
              </button>
            )}
            {hasFilters && (
              <button type="button" onClick={clearAll} className="rounded-md px-4 py-2 text-[13px] font-semibold" style={{ background: INK, color: "#fff" }}>
                Clear all filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={`mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {products.map((p) => {
            const img = productImageOf(p);
            const code = productCodeOf(p);
            const path = productPathOf(p);
            const soldOut = p.available <= 0;
            const isSelected = selectedId === p._id;
            return (
              <div
                key={p._id}
                className="rounded-xl border overflow-hidden flex flex-col bg-white"
                style={{ borderColor: isSelected ? GOLD : BORDER, boxShadow: isSelected ? `0 0 0 2px ${GOLD}` : undefined }}
              >
                <div className="relative aspect-square" style={{ background: "#f7f4ec" }}>
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={p.name} loading="lazy" className={`w-full h-full object-cover ${soldOut ? "opacity-50" : ""}`} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[12px]" style={{ color: MUTED }}>No photo</div>
                  )}
                  {p.productKind && (
                    <span className="absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize" style={{ background: "rgba(255,255,255,0.92)", color: INK }}>
                      {p.productKind}
                    </span>
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col">
                  <p className="text-[13px] leading-snug line-clamp-2" style={{ color: INK }} title={p.name}>
                    <Highlight text={p.name} q={filters.q} />
                  </p>
                  {code && (
                    <p className="text-[11px] mt-1" style={{ color: MUTED }}>
                      Model / SKU: <Highlight text={code} q={filters.q} />
                    </p>
                  )}
                  {path && <p className="text-[11px] mt-0.5 truncate" style={{ color: "#8f877c" }} title={path}>{path}</p>}
                  <div className="mt-auto pt-2 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-[15px] font-bold" style={{ color: INK }}>{money(p.price)}</p>
                      <StockPill available={p.available} />
                    </div>
                    {p.slug && (
                      <a
                        href={`/products/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] underline"
                        style={{ color: MUTED }}
                        title="Open the full product page in a new tab"
                      >
                        Details
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => onSelect(p)}
                    className="mt-2 w-full rounded-md py-2 text-[12px] font-bold uppercase tracking-wide disabled:cursor-not-allowed"
                    style={
                      soldOut
                        ? { background: "#eee9df", color: "#9a9287" }
                        : isSelected
                          ? { background: INK, color: GOLD }
                          : { background: GOLD, color: INK }
                    }
                  >
                    {soldOut ? "Out of stock" : isSelected ? "Selected ✓" : "Order this"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!error && pages > 1 && (
        <nav className="mt-5 flex flex-wrap items-center justify-center gap-1.5" aria-label="Product pages">
          <button
            type="button"
            onClick={() => goToPage(filters.page - 1)}
            disabled={filters.page <= 1}
            className="rounded-md border px-3 py-1.5 text-[13px] disabled:opacity-40"
            style={{ borderColor: BORDER, color: INK }}
          >
            ‹ Prev
          </button>
          {Array.from({ length: Math.min(7, pages) }, (_, i) => {
            const start = Math.min(Math.max(1, filters.page - 3), Math.max(1, pages - 6));
            const p = start + i;
            const active = p === filters.page;
            return (
              <button
                key={p}
                type="button"
                onClick={() => goToPage(p)}
                aria-current={active ? "page" : undefined}
                className="rounded-md border px-3 py-1.5 text-[13px] min-w-[36px]"
                style={active ? { background: INK, color: GOLD, borderColor: INK } : { borderColor: BORDER, color: INK }}
              >
                {p}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => goToPage(filters.page + 1)}
            disabled={filters.page >= pages}
            className="rounded-md border px-3 py-1.5 text-[13px] disabled:opacity-40"
            style={{ borderColor: BORDER, color: INK }}
          >
            Next ›
          </button>
        </nav>
      )}
    </div>
  );
}
