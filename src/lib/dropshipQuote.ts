import crypto from "crypto";

/**
 * Tamper-proof shipping quotes for the dropship portal.
 *
 * Previously the seller's browser sent back `{ rateId, rate }` and the server
 * trusted `rate` as the shipping price — anyone could edit the request and
 * pay $0 shipping, or quote a cheap rate for one address and submit the order
 * for another. Now every rate the server quotes carries a signed token
 * binding together the rate id, the exact price, the carrier/service, the
 * destination address and the seller's portal. On submit the server
 * re-verifies the signature and the address, and uses ONLY the signed
 * values. Nothing price-related is taken from the client any more.
 */

const QUOTE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — ShipStation rate ids go stale after a while anyway

function getSecret(): string {
  const secret = process.env.DROPSHIP_QUOTE_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("DROPSHIP_QUOTE_SECRET (or JWT_SECRET) must be set to sign dropship shipping quotes.");
  }
  return secret;
}

export interface QuoteAddress {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

export interface SignedQuotePayload {
  rateId: string;
  rate: number; // raw carrier rate (before service fee)
  carrier: string;
  service: string;
  serviceCode: string;
  estimatedDays: number | null;
  estimatedDelivery: string | null;
  addr: string; // hash of the normalized destination
  seller: string; // hash of the portal token
  exp: number;
}

function norm(v: string | undefined): string {
  return (v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sha(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex").slice(0, 32);
}

export function hashQuoteAddress(a: QuoteAddress): string {
  return sha(
    [a.street1, a.street2, a.city, a.state, a.postalCode, a.country || "US"].map(norm).join("|")
  );
}

function hashSeller(portalToken: string): string {
  return sha(`seller:${portalToken}`);
}

function sign(body: string): string {
  return crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
}

export function signShippingQuote(
  portalToken: string,
  address: QuoteAddress,
  rate: Omit<SignedQuotePayload, "addr" | "seller" | "exp">
): string {
  const payload: SignedQuotePayload = {
    ...rate,
    addr: hashQuoteAddress(address),
    seller: hashSeller(portalToken),
    exp: Date.now() + QUOTE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export type QuoteVerification =
  | { ok: true; quote: SignedQuotePayload }
  | { ok: false; reason: string };

export function verifyShippingQuote(
  token: string | undefined,
  portalToken: string,
  address: QuoteAddress
): QuoteVerification {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "Please choose a shipping method before continuing." };
  }
  const [body, sig] = token.split(".");
  const expected = sign(body);
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "The shipping quote is invalid. Please get shipping rates again." };
  }

  let payload: SignedQuotePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "The shipping quote is invalid. Please get shipping rates again." };
  }

  if (payload.seller !== hashSeller(portalToken)) {
    return { ok: false, reason: "The shipping quote is invalid. Please get shipping rates again." };
  }
  if (Date.now() > payload.exp) {
    return { ok: false, reason: "Your shipping quote has expired. Please get shipping rates again." };
  }
  if (payload.addr !== hashQuoteAddress(address)) {
    return {
      ok: false,
      reason: "The shipping address changed after rates were quoted. Please get shipping rates again.",
    };
  }
  if (!(typeof payload.rate === "number" && payload.rate >= 0 && Number.isFinite(payload.rate))) {
    return { ok: false, reason: "The shipping quote is invalid. Please get shipping rates again." };
  }
  return { ok: true, quote: payload };
}
