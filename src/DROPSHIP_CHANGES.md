# Dropship program — search, hardening, and admin Orders tab

## What changed for sellers (portal)
- **Product search is the homepage search bar** (`components/ui/SearchBar.tsx`, reused via new
  optional `onSelect` / `dropdownMode="inline"` props — homepage behaviour is unchanged).
- **New product browser** (`components/dropship/DropshipProductBrowser.tsx`): product-type tabs with
  counts, category → subcategory, price range, in-stock toggle, sort, removable filter chips,
  pagination, live "N in stock" per product. Backed by `GET /api/dropship/portal/[token]/catalog`,
  which uses the exact same matching rules as homepage search (`lib/productSearchQuery.ts`).
- Order form in 4 clear steps, quantity capped at real stock, "My orders" with tabs + search,
  cancel for unpaid orders, plain-language statuses.

## Bugs fixed
1. `/pay/capture` called the *initiate* function — PayPal payments were never captured.
2. Shipping price was trusted from the browser — now a server-signed quote bound to seller + address.
3. Portal API never sent `active`, so deactivated sellers still saw the portal.
4. Admin notes leaked to sellers via the portal API.
5. `/api/cron/sync-deliveries` had a hard-coded secret in the repo.

## Hardening
Duplicate-submit protection, payment capture lock, captured-amount check, no payment on cancelled
orders, stock re-reserved before a late payment, unpaid holds released after 60 min and orders
auto-cancelled after 7 days (existing hourly cron), dropship deliveries synced by cron + webhook,
duplicate applications prevented (approved sellers get their link re-sent).

## Admin
Dropship orders appear in **Orders** with a DROPSHIP badge; tabs All / Website / Dropship;
server-side search across all orders; status change, label purchase, tracking, invoice, delete all
work on dropship rows; clear "unpaid — do not ship" / "don't put prices in the box" guidance;
"needs attention" flags; private notes. Existing Dropship Orders page still works.

## Deploy checklist
- Env: `CRON_SECRET` (required for crons). Optional `DROPSHIP_QUOTE_SECRET` (falls back to `JWT_SECRET`).
- New Mongo indexes on `DropshipOrder` are created automatically by Mongoose on startup.
- Requires MongoDB 4.4+ (`$unionWith`) — any current Atlas cluster qualifies.
- Unpaid dropship orders created before this deploy: sellers just press "Pay" again; nothing to migrate.
