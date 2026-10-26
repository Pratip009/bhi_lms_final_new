"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import DropshipProductBrowser, {
  type CatalogProduct,
  productImageOf,
  productCodeOf,
  productPathOf,
} from "./DropshipProductBrowser";

const GOLD = "#c9a84c";
const INK = "#1a1714";
const MUTED = "#4d463f";
const BORDER = "#e4dfd2";
const CREAM = "#fffdf9";
const RED = "#a6402b";
const GREEN = "#1f6b4a";

const money = (n: number) =>
  `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Same lists as the main checkout — a real dropdown makes invalid
// ShipStation state codes impossible.
const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"], ["DC", "Washington D.C."],
];
const CA_PROVINCES = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"],
  ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

type Application = {
  fullName: string;
  businessName?: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  active: boolean;
  createdAt: string;
};

type Order = {
  _id: string;
  productName: string;
  productImage?: string;
  unitPrice: number;
  quantity: number;
  productAmount: number;
  amount: number;
  shippingCarrier?: string;
  shippingService?: string;
  shippingCost: number;
  serviceFee: number;
  customerName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  status: "pending_payment" | "processing" | "shipped" | "delivered" | "cancelled";
  paymentStatus: "pending" | "completed" | "failed";
  stockReserved?: boolean;
  trackingNumber?: string;
  trackingUrl?: string;
  createdAt: string;
};

type ShippingRate = {
  carrier: string;
  service: string;
  serviceCode: string;
  rateId: string;
  rate: number;
  costWithFee: number;
  estimatedDays: number | null;
  estimatedDelivery: string | null;
  quoteToken: string;
};

const ADDRESS_FIELDS = ["addressLine1", "addressLine2", "city", "state", "postalCode", "country"];

const FORM_INITIAL = {
  quantity: "1",
  specifications: "",
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  specialInstructions: "",
};
type FormState = typeof FORM_INITIAL;

/** Plain-language status for sellers — what it means for them, not our internal state name. */
function describeOrder(o: Order): { label: string; color: string; hint?: string } {
  if (o.status === "cancelled") return { label: "Cancelled", color: RED };
  if (o.paymentStatus !== "completed") {
    return {
      label: o.paymentStatus === "failed" ? "Payment failed — try again" : "Awaiting your payment",
      color: "#9c6a12",
      hint:
        o.stockReserved === false
          ? "This item is no longer on hold for you. Paying will check it’s still in stock."
          : "We’re holding this item for you. Pay within an hour to keep the hold.",
    };
  }
  if (o.status === "processing") return { label: "Paid — Alpha is preparing it", color: "#1f5f8b" };
  if (o.status === "shipped") return { label: "Shipped to your customer", color: GREEN };
  return { label: "Delivered", color: GREEN };
}

const ORDER_TABS: { key: string; label: string; test: (o: Order) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "unpaid", label: "Needs payment", test: (o) => o.status === "pending_payment" && o.paymentStatus !== "completed" },
  { key: "progress", label: "Being prepared", test: (o) => o.status === "processing" },
  { key: "shipped", label: "Shipped / delivered", test: (o) => o.status === "shipped" || o.status === "delivered" },
  { key: "cancelled", label: "Cancelled", test: (o) => o.status === "cancelled" },
];

const paypalOptions = {
  clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!,
  currency: "USD",
};

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function validateForm(form: FormState, maxQty: number): Record<string, string> {
  const e: Record<string, string> = {};
  const qty = Number(form.quantity);
  if (!Number.isInteger(qty) || qty < 1) e.quantity = "Enter a whole number of at least 1.";
  else if (qty > maxQty) e.quantity = `You can order up to ${maxQty}.`;
  if (form.customerName.trim().length < 2) e.customerName = "Enter your customer’s full name.";
  if (form.customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim()))
    e.customerEmail = "That email doesn’t look right — fix it or leave it blank.";
  if (form.addressLine1.trim().length < 2) e.addressLine1 = "Enter the street address.";
  if (!form.city.trim()) e.city = "Enter the city.";
  if (!form.state) e.state = form.country === "CA" ? "Choose a province." : "Choose a state.";
  if (form.postalCode.trim().length < 3) e.postalCode = form.country === "CA" ? "Enter the postal code." : "Enter the ZIP code.";
  return e;
}

export default function DropshipPortal({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"notfound" | "network" | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [maxQuantity, setMaxQuantity] = useState(50);
  const [view, setView] = useState<"new" | "orders">("orders");

  // New order
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [form, setForm] = useState<FormState>(FORM_INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const requestIdRef = useRef<string>(newRequestId());

  const [rates, setRates] = useState<ShippingRate[] | null>(null);
  const [fetchingRates, setFetchingRates] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null);

  // Orders list
  const [orderTab, setOrderTab] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const productStepRef = useRef<HTMLDivElement>(null);
  const detailsStepRef = useRef<HTMLDivElement>(null);

  const loadPortal = useCallback(async () => {
    try {
      const res = await fetch(`/api/dropship/portal/${token}`, { cache: "no-store" });
      if (res.status === 404) {
        setLoadError("notfound");
        return null;
      }
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setApplication(data.data.application);
      setOrders(data.data.orders ?? []);
      if (data.data.limits?.maxQuantity) setMaxQuantity(data.data.limits.maxQuantity);
      setLoadError(null);
      return data.data as { orders: Order[] };
    } catch {
      setLoadError((prev) => prev ?? "network");
      return null;
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPortal().then((d) => {
      if (d && d.orders.length === 0) setView("new");
    });
  }, [loadPortal]);

  const showNotice = (kind: "ok" | "error", text: string, ms = 7000) => {
    setNotice({ kind, text });
    if (ms) setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), ms);
  };

  const invalidateRates = () => {
    setRates(null);
    setSelectedRate(null);
    setRatesError(null);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value, ...(name === "country" ? { state: "" } : {}) }));
    if (errors[name]) setErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
    // Any address edit invalidates quoted rates — shipping must match the destination.
    if (ADDRESS_FIELDS.includes(name)) invalidateRates();
    setServerError(null);
  };

  const pickProduct = (p: CatalogProduct) => {
    setProduct(p);
    setServerError(null);
    const cap = Math.max(1, Math.min(p.available, maxQuantity));
    setForm((f) => ({ ...f, quantity: String(Math.min(Math.max(1, Number(f.quantity) || 1), cap)) }));
    setTimeout(() => detailsStepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const maxQty = product ? Math.max(1, Math.min(product.available, maxQuantity)) : maxQuantity;
  const addressComplete =
    form.addressLine1.trim().length >= 2 && form.city.trim() && form.state && form.postalCode.trim().length >= 3;

  const fetchRates = async () => {
    const addrErrors = validateForm(form, maxQty);
    const relevant = ["addressLine1", "city", "state", "postalCode"].filter((k) => addrErrors[k]);
    if (relevant.length) {
      setErrors((prev) => ({ ...prev, ...Object.fromEntries(relevant.map((k) => [k, addrErrors[k]])) }));
      return;
    }
    setFetchingRates(true);
    invalidateRates();
    try {
      const res = await fetch(`/api/dropship/portal/${token}/shipping-rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          street1: form.addressLine1,
          street2: form.addressLine2 || undefined,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          country: form.country,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRatesError(data.message || "Could not get shipping rates for this address.");
        return;
      }
      const list: ShippingRate[] = data.data.rates || [];
      setRates(list);
      if (list.length === 1) setSelectedRate(list[0]);
    } catch {
      setRatesError("Network problem while getting rates. Please try again.");
    } finally {
      setFetchingRates(false);
    }
  };

  const resetNewOrder = () => {
    setForm(FORM_INITIAL);
    setProduct(null);
    invalidateRates();
    setErrors({});
    setServerError(null);
    requestIdRef.current = newRequestId();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);

    if (!product) {
      setServerError("Choose a product first.");
      productStepRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const v = validateForm(form, maxQty);
    setErrors(v);
    if (Object.keys(v).length) {
      setServerError("Please fix the highlighted fields.");
      return;
    }
    if (!selectedRate) {
      setServerError("Choose a shipping method.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/dropship/portal/${token}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product._id,
          quantity: Number(form.quantity),
          specifications: form.specifications || undefined,
          customerName: form.customerName,
          customerEmail: form.customerEmail || "",
          customerPhone: form.customerPhone || undefined,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || undefined,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          country: form.country,
          specialInstructions: form.specialInstructions || undefined,
          shippingQuote: selectedRate.quoteToken,
          // Same id on every retry of THIS order, so a double-click or a
          // dropped connection can never create two orders.
          clientRequestId: requestIdRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 422 && data.errors) {
          const flat: Record<string, string> = {};
          for (const [k, v] of Object.entries(data.errors as Record<string, string[]>)) flat[k] = v?.[0];
          setErrors(flat);
        }
        const msg: string = data.message || "Something went wrong. Please try again.";
        if (/shipping|quote|rates/i.test(msg)) invalidateRates();
        if (res.status === 409) {
          // Stock changed — refresh what we know about this product.
          fetch(`/api/dropship/portal/${token}/catalog?id=${product._id}`)
            .then((r) => r.json())
            .then((d) => d?.data?.product && setProduct(d.data.product))
            .catch(() => {});
        }
        setServerError(msg);
        return;
      }

      const newOrderId: string = data.data.orderId;
      resetNewOrder();
      await loadPortal();
      setView("orders");
      setOrderTab("all");
      setPayingOrderId(newOrderId);
      showNotice("ok", "Order created. Pay below to send it to Alpha for shipping.", 9000);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setServerError("Network problem — your order may not have been sent. Press the button again; you won’t be charged twice or get a duplicate order.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (o: Order) => {
    if (!window.confirm(`Cancel the order for ${o.customerName}? The item is released and nothing is charged.`)) return;
    setCancellingId(o._id);
    try {
      const res = await fetch(`/api/dropship/portal/${token}/orders/${o._id}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) showNotice("error", data.message || "Could not cancel this order.");
      else showNotice("ok", "Order cancelled.");
      if (payingOrderId === o._id) setPayingOrderId(null);
      await loadPortal();
    } finally {
      setCancellingId(null);
    }
  };

  const tabCounts = useMemo(
    () => Object.fromEntries(ORDER_TABS.map((t) => [t.key, orders.filter(t.test).length])),
    [orders]
  );
  const visibleOrders = useMemo(() => {
    const tab = ORDER_TABS.find((t) => t.key === orderTab) ?? ORDER_TABS[0];
    const q = orderSearch.trim().toLowerCase();
    return orders.filter(
      (o) =>
        tab.test(o) &&
        (!q ||
          o.customerName.toLowerCase().includes(q) ||
          o.productName.toLowerCase().includes(q) ||
          o._id.toLowerCase().endsWith(q.replace(/^#/, "")) ||
          (o.trackingNumber || "").toLowerCase().includes(q))
    );
  }, [orders, orderTab, orderSearch]);

  // ── Non-approved states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24 text-center" style={{ color: MUTED }}>
        Loading your portal…
      </div>
    );
  }

  const Message = ({ icon, title, children }: { icon?: string; title: string; children: React.ReactNode }) => (
    <div className="max-w-lg mx-auto px-6 py-24 text-center">
      {icon && (
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl" style={{ background: `${GOLD}18` }}>
          {icon}
        </div>
      )}
      <h1 className="font-serif text-2xl mb-4" style={{ color: INK }}>{title}</h1>
      <div style={{ color: MUTED }}>{children}</div>
    </div>
  );
  const contact = (
    <a href="mailto:info@alphagemimports.com" style={{ color: GOLD }}>info@alphagemimports.com</a>
  );

  if (loadError === "network" && !application) {
    return (
      <Message title="We couldn’t load your portal">
        <p>Check your internet connection and try again.</p>
        <button onClick={() => { setLoading(true); loadPortal(); }} className="mt-5 rounded-md px-5 py-2.5 text-sm font-bold" style={{ background: GOLD, color: INK }}>
          Try again
        </button>
      </Message>
    );
  }
  if (loadError === "notfound" || !application) {
    return (
      <Message title="Portal link not found">
        <p>
          This dropship portal link isn’t valid. If you lost your link, apply again with the same email on the{" "}
          <a href="/drop-shipping/apply" style={{ color: GOLD }}>dropship page</a> and we’ll email it to you, or contact {contact}.
        </p>
      </Message>
    );
  }
  if (application.status === "pending") {
    return (
      <Message icon="⏳" title="Application under review">
        <p>
          Thanks, {application.fullName.split(" ")[0]}. Your dropship application is still being reviewed. We’ll email{" "}
          <strong>{application.email}</strong> as soon as a decision is made — usually within 1–2 business days.
        </p>
      </Message>
    );
  }
  if (application.status === "rejected") {
    return (
      <Message title="Application not approved">
        <p>Your dropship application wasn’t approved at this time. If you have questions, reach out to {contact}.</p>
      </Message>
    );
  }
  if (application.active === false) {
    return (
      <Message icon="🔒" title="This link is no longer active">
        <p>Your dropship portal access has been turned off. If you believe this is a mistake, please contact {contact}.</p>
      </Message>
    );
  }

  // ── Approved + active ───────────────────────────────────────────────────
  const fieldClass =
    "w-full rounded-lg border px-4 py-2.5 text-[14px] outline-none transition-colors focus:border-[#c9a84c] bg-white";
  const fieldStyle = (name: string) => ({ borderColor: errors[name] ? RED : BORDER });
  const FieldError = ({ name }: { name: string }) =>
    errors[name] ? <p className="text-[12px] mt-1" style={{ color: RED }}>{errors[name]}</p> : null;
  const Label = ({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) => (
    <label htmlFor={htmlFor} className="block text-[12px] font-semibold mb-1.5" style={{ color: INK }}>{children}</label>
  );
  const StepTitle = ({ n, title, done }: { n: number; title: string; done?: boolean }) => (
    <div className="flex items-center gap-3 mb-4">
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0"
        style={done ? { background: GREEN, color: "#fff" } : { background: INK, color: GOLD }}
      >
        {done ? "✓" : n}
      </span>
      <h3 className="text-[17px] font-semibold" style={{ color: INK }}>{title}</h3>
    </div>
  );

  const qtyNum = Math.max(1, Number(form.quantity) || 1);
  const productAmount = product ? product.price * qtyNum : 0;
  const grandTotal = productAmount + (selectedRate?.costWithFee || 0);
  const unpaidCount = tabCounts.unpaid ?? 0;

  return (
    <PayPalScriptProvider options={paypalOptions}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[13px] font-semibold mb-1" style={{ color: GOLD }}>Seller portal</p>
            <h1 className="font-serif text-3xl" style={{ color: INK }}>
              {application.businessName || application.fullName}
            </h1>
            <p className="text-sm mt-1" style={{ color: MUTED }}>{application.email}</p>
          </div>
          <div className="flex rounded-xl border p-1" style={{ borderColor: BORDER, background: CREAM }} role="tablist">
            {([
              { key: "new", label: "Place an order" },
              { key: "orders", label: `My orders${orders.length ? ` (${orders.length})` : ""}` },
            ] as const).map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={view === t.key}
                onClick={() => setView(t.key)}
                className="relative rounded-lg px-5 py-2.5 text-[14px] font-semibold transition-colors"
                style={view === t.key ? { background: INK, color: "#fff" } : { color: MUTED }}
              >
                {t.label}
                {t.key === "orders" && unpaidCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-bold" style={{ background: GOLD, color: INK }}>
                    {unpaidCount} to pay
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {notice && (
          <div
            className="mb-6 rounded-lg border px-4 py-3 text-sm"
            role="status"
            style={notice.kind === "ok"
              ? { borderColor: `${GREEN}55`, background: "#eef7f1", color: GREEN }
              : { borderColor: "#e5b8ab", background: "#fbede8", color: RED }}
          >
            {notice.text}
          </div>
        )}

        {view === "new" ? (
          <div className="space-y-6">
            {/* Step 1 — product (kept OUTSIDE the <form> so searching/filtering can never submit the order) */}
            <section ref={productStepRef} className="rounded-2xl border p-5 sm:p-7 scroll-mt-24" style={{ borderColor: BORDER }}>
              <StepTitle n={1} title="Choose the product" done={!!product} />
              {product ? (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3" style={{ borderColor: GOLD, background: `${GOLD}0d` }}>
                  {productImageOf(product) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={productImageOf(product)} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border" style={{ borderColor: BORDER }} />
                  ) : null}
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-[15px] font-semibold" style={{ color: INK }}>{product.name}</p>
                    <p className="text-[13px]" style={{ color: MUTED }}>
                      {money(product.price)} each
                      {productCodeOf(product) && ` · Model / SKU ${productCodeOf(product)}`}
                      {` · ${product.available} available`}
                    </p>
                    {productPathOf(product) && <p className="text-[12px]" style={{ color: "#8f877c" }}>{productPathOf(product)}</p>}
                  </div>
                  <button type="button" onClick={() => { setProduct(null); setServerError(null); }} className="rounded-md border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: BORDER, color: INK, background: "#fff" }}>
                    Change product
                  </button>
                </div>
              ) : (
                <DropshipProductBrowser token={token} onSelect={pickProduct} selectedId={null} />
              )}
            </section>

            {product && (
              <form
                onSubmit={handleSubmit}
                noValidate
                className="space-y-6"
                onKeyDown={(e) => {
                  // Enter in a text field moves on instead of submitting the whole order.
                  if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
                }}
              >
                {/* Step 2 — quantity & customer */}
                <section ref={detailsStepRef} className="rounded-2xl border p-5 sm:p-7 scroll-mt-24" style={{ borderColor: BORDER }}>
                  <StepTitle n={2} title="Quantity and your customer’s address" />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="quantity">Quantity</Label>
                      <input id="quantity" type="number" inputMode="numeric" min={1} max={maxQty} name="quantity" value={form.quantity} onChange={handleChange} className={fieldClass} style={fieldStyle("quantity")} />
                      <p className="text-[11px] mt-1" style={{ color: MUTED }}>Up to {maxQty}</p>
                      <FieldError name="quantity" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="specifications">Notes about the item (optional)</Label>
                      <input id="specifications" name="specifications" maxLength={500} value={form.specifications} onChange={handleChange} className={fieldClass} style={fieldStyle("specifications")} placeholder="e.g. match the pair closely" />
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="customerName">Customer’s full name *</Label>
                      <input id="customerName" name="customerName" autoComplete="off" value={form.customerName} onChange={handleChange} className={fieldClass} style={fieldStyle("customerName")} />
                      <FieldError name="customerName" />
                    </div>
                    <div>
                      <Label htmlFor="customerPhone">Customer’s phone (helps the carrier)</Label>
                      <input id="customerPhone" name="customerPhone" type="tel" value={form.customerPhone} onChange={handleChange} className={fieldClass} style={fieldStyle("customerPhone")} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="customerEmail">Customer’s email (optional)</Label>
                      <input id="customerEmail" name="customerEmail" type="email" value={form.customerEmail} onChange={handleChange} className={fieldClass} style={fieldStyle("customerEmail")} />
                      <FieldError name="customerEmail" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="addressLine1">Street address *</Label>
                      <input id="addressLine1" name="addressLine1" value={form.addressLine1} onChange={handleChange} className={fieldClass} style={fieldStyle("addressLine1")} />
                      <FieldError name="addressLine1" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="addressLine2">Apartment, suite, etc.</Label>
                      <input id="addressLine2" name="addressLine2" value={form.addressLine2} onChange={handleChange} className={fieldClass} style={fieldStyle("addressLine2")} />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="col-span-2 sm:col-span-1">
                      <Label htmlFor="city">City *</Label>
                      <input id="city" name="city" value={form.city} onChange={handleChange} className={fieldClass} style={fieldStyle("city")} />
                      <FieldError name="city" />
                    </div>
                    <div>
                      <Label htmlFor="country">Country *</Label>
                      <select id="country" name="country" value={form.country} onChange={handleChange} className={fieldClass} style={fieldStyle("country")}>
                        <option value="US">United States</option>
                        <option value="CA">Canada</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="state">{form.country === "CA" ? "Province *" : "State *"}</Label>
                      <select id="state" name="state" value={form.state} onChange={handleChange} className={fieldClass} style={fieldStyle("state")}>
                        <option value="">Select…</option>
                        {(form.country === "CA" ? CA_PROVINCES : US_STATES).map(([code, label]) => (
                          <option key={code} value={code}>{label}</option>
                        ))}
                      </select>
                      <FieldError name="state" />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <Label htmlFor="postalCode">{form.country === "CA" ? "Postal code *" : "ZIP code *"}</Label>
                      <input id="postalCode" name="postalCode" value={form.postalCode} onChange={handleChange} className={fieldClass} style={fieldStyle("postalCode")} />
                      <FieldError name="postalCode" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Label htmlFor="specialInstructions">Special instructions for Alpha (optional)</Label>
                    <textarea id="specialInstructions" name="specialInstructions" maxLength={1000} value={form.specialInstructions} onChange={handleChange} rows={2} className={fieldClass} style={fieldStyle("specialInstructions")} placeholder="e.g. no paperwork with prices in the box" />
                  </div>
                </section>

                {/* Step 3 — shipping */}
                <section className="rounded-2xl border p-5 sm:p-7" style={{ borderColor: BORDER }}>
                  <StepTitle n={3} title="Choose shipping" done={!!selectedRate} />
                  {!addressComplete ? (
                    <p className="text-[14px]" style={{ color: MUTED }}>Fill in the address above, then get live shipping prices.</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={fetchRates}
                        disabled={fetchingRates}
                        className="rounded-md px-5 py-2.5 text-[13px] font-bold disabled:opacity-60"
                        style={{ border: `1.5px solid ${INK}`, color: INK, background: "#fff" }}
                      >
                        {fetchingRates ? "Getting prices…" : rates ? "Refresh shipping prices" : "Get shipping prices"}
                      </button>
                      {ratesError && <p className="text-[13px] mt-3" style={{ color: RED }}>{ratesError}</p>}
                      {rates && rates.length === 0 && !ratesError && (
                        <p className="text-[13px] mt-3" style={{ color: MUTED }}>No shipping options were found for this address. Please double-check it.</p>
                      )}
                      {rates && rates.length > 0 && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2" role="radiogroup" aria-label="Shipping method">
                          {rates.map((r) => {
                            const sel = selectedRate?.rateId === r.rateId;
                            return (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={sel}
                                key={r.rateId}
                                onClick={() => { setSelectedRate(r); setServerError(null); }}
                                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
                                style={sel ? { borderColor: GOLD, background: `${GOLD}14`, boxShadow: `0 0 0 1px ${GOLD}` } : { borderColor: BORDER, background: "#fff" }}
                              >
                                <span>
                                  <span className="block text-[14px] font-semibold" style={{ color: INK }}>{r.carrier} — {r.service}</span>
                                  <span className="block text-[12px]" style={{ color: MUTED }}>
                                    {r.estimatedDays ? `About ${r.estimatedDays} business day${r.estimatedDays === 1 ? "" : "s"}` : r.estimatedDelivery || "Delivery estimate not available"}
                                  </span>
                                </span>
                                <span className="text-[14px] font-bold flex-shrink-0" style={{ color: INK }}>{money(r.costWithFee)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </section>

                {/* Step 4 — review */}
                <section className="rounded-2xl border p-5 sm:p-7" style={{ borderColor: INK, background: CREAM }}>
                  <StepTitle n={4} title="Review and pay" />
                  <div className="space-y-1.5 text-[14px] max-w-md" style={{ color: MUTED }}>
                    <div className="flex justify-between"><span>{qtyNum} × {money(product.price)}</span><span>{money(productAmount)}</span></div>
                    {selectedRate ? (
                      <>
                        <div className="flex justify-between"><span>Shipping ({selectedRate.carrier})</span><span>{money(selectedRate.rate)}</span></div>
                        <div className="flex justify-between"><span>Service fee</span><span>{money(selectedRate.costWithFee - selectedRate.rate)}</span></div>
                      </>
                    ) : (
                      <div className="flex justify-between"><span>Shipping</span><span>Choose above</span></div>
                    )}
                    <div className="flex justify-between pt-2 mt-1 border-t text-[16px] font-bold" style={{ borderColor: BORDER, color: INK }}>
                      <span>Total you pay Alpha</span><span>{money(grandTotal)}</span>
                    </div>
                  </div>

                  {serverError && (
                    <div className="mt-4 rounded-lg border px-4 py-3 text-sm" role="alert" style={{ borderColor: "#e5b8ab", background: "#fbede8", color: RED }}>
                      {serverError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || !selectedRate}
                    className="mt-5 rounded-md px-8 py-3.5 text-[14px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: GOLD, color: INK }}
                  >
                    {submitting ? "Creating your order…" : selectedRate ? `Continue to payment · ${money(grandTotal)}` : "Choose shipping to continue"}
                  </button>
                  <p className="text-[12px] mt-2" style={{ color: MUTED }}>
                    The item is held for you for about an hour. Nothing ships until you pay.
                  </p>
                </section>
              </form>
            )}
          </div>
        ) : (
          /* ── My orders ─────────────────────────────────────────────────── */
          <div>
            {orders.length === 0 ? (
              <div className="rounded-2xl border px-6 py-14 text-center" style={{ borderColor: BORDER, background: CREAM }}>
                <p className="text-[16px] font-semibold" style={{ color: INK }}>No orders yet</p>
                <p className="text-[14px] mt-1" style={{ color: MUTED }}>Find a product and we’ll ship it straight to your customer.</p>
                <button onClick={() => setView("new")} className="mt-5 rounded-md px-6 py-3 text-[14px] font-bold" style={{ background: GOLD, color: INK }}>
                  Place your first order
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {ORDER_TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setOrderTab(t.key)}
                      className="rounded-full border px-4 py-1.5 text-[13px] font-semibold"
                      style={orderTab === t.key ? { background: INK, color: "#fff", borderColor: INK } : { background: "#fff", color: MUTED, borderColor: BORDER }}
                    >
                      {t.label} <span className="opacity-70 font-normal">{tabCounts[t.key] ?? 0}</span>
                    </button>
                  ))}
                  <input
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search customer, product, tracking…"
                    className="ml-auto rounded-lg border px-3 py-2 text-[13px] outline-none w-full sm:w-64 focus:border-[#c9a84c]"
                    style={{ borderColor: BORDER }}
                  />
                </div>

                {visibleOrders.length === 0 ? (
                  <p className="text-sm py-8 text-center" style={{ color: MUTED }}>No orders in this view.</p>
                ) : (
                  <div className="space-y-3">
                    {visibleOrders.map((o) => {
                      const d = describeOrder(o);
                      const canPay = o.paymentStatus !== "completed" && o.status === "pending_payment";
                      return (
                        <div key={o._id} className="rounded-2xl border overflow-hidden bg-white" style={{ borderColor: canPay ? `${GOLD}88` : BORDER }}>
                          <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                            {o.productImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={o.productImage} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border" style={{ borderColor: BORDER }} />
                            ) : null}
                            <div className="flex-1 min-w-[220px]">
                              <p className="text-[14px] font-semibold" style={{ color: INK }}>{o.quantity} × {o.productName}</p>
                              <p className="text-[13px] mt-0.5" style={{ color: MUTED }}>
                                To {o.customerName} — {o.city}{o.state ? `, ${o.state}` : ""} {o.postalCode}
                              </p>
                              <p className="text-[12px] mt-0.5" style={{ color: "#8f877c" }}>
                                #{o._id.slice(-8).toUpperCase()} · {new Date(o.createdAt).toLocaleDateString()} · {o.shippingCarrier} {o.shippingService}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[16px] font-bold" style={{ color: INK }}>{money(o.amount)}</p>
                              <p className="text-[12px] font-semibold mt-0.5" style={{ color: d.color }}>{d.label}</p>
                              {o.trackingNumber && (
                                <p className="text-[12px] mt-0.5">
                                  {o.trackingUrl ? (
                                    <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: INK }}>Track: {o.trackingNumber}</a>
                                  ) : (
                                    <span style={{ color: MUTED }}>Tracking: {o.trackingNumber}</span>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>

                          {canPay && (
                            <div className="px-5 pb-4 flex flex-wrap items-center gap-3">
                              <button
                                onClick={() => setPayingOrderId(payingOrderId === o._id ? null : o._id)}
                                className="rounded-md px-5 py-2.5 text-[13px] font-bold"
                                style={payingOrderId === o._id ? { background: "#fff", color: INK, border: `1px solid ${BORDER}` } : { background: GOLD, color: INK }}
                              >
                                {payingOrderId === o._id ? "Hide payment" : `Pay ${money(o.amount)}`}
                              </button>
                              <button
                                onClick={() => cancelOrder(o)}
                                disabled={cancellingId === o._id}
                                className="text-[13px] font-semibold underline disabled:opacity-50"
                                style={{ color: MUTED }}
                              >
                                {cancellingId === o._id ? "Cancelling…" : "Cancel order"}
                              </button>
                              {d.hint && <p className="w-full text-[12px]" style={{ color: MUTED }}>{d.hint}</p>}
                            </div>
                          )}

                          {canPay && payingOrderId === o._id && (
                            <div className="px-5 pb-5 pt-4 border-t" style={{ borderColor: BORDER, background: CREAM }}>
                              <p className="text-[13px] mb-3" style={{ color: MUTED }}>
                                Pay {money(o.amount)} to send this order to Alpha for shipping.
                              </p>
                              <div className="max-w-md">
                                <PayPalButtons
                                  style={{ layout: "vertical", height: 42 }}
                                  forceReRender={[o._id, o.amount]}
                                  createOrder={async () => {
                                    const res = await fetch(`/api/dropship/portal/${token}/orders/${o._id}/pay`, { method: "POST" });
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok) {
                                      showNotice("error", data.message || "Could not start payment.", 0);
                                      if (res.status === 409) loadPortal();
                                      throw new Error(data.message || "Could not start payment");
                                    }
                                    return data.data.paypalOrderId;
                                  }}
                                  onApprove={async (data) => {
                                    const res = await fetch(`/api/dropship/portal/${token}/orders/${o._id}/pay/capture`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ paypalOrderId: data.orderID }),
                                    });
                                    const result = await res.json().catch(() => ({}));
                                    await loadPortal();
                                    if (!res.ok) {
                                      showNotice("error", result.message || "Payment could not be completed.", 0);
                                      return;
                                    }
                                    setPayingOrderId(null);
                                    showNotice("ok", "Payment received — Alpha will ship this order to your customer. We’ll add tracking here.", 9000);
                                  }}
                                  onCancel={() => showNotice("error", "Payment was cancelled. Nothing was charged — you can pay any time.", 6000)}
                                  onError={() => showNotice("error", "PayPal had a problem. Nothing was charged — please try again.", 0)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </PayPalScriptProvider>
  );
}
