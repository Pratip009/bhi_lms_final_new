'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { Package, Loader2, AlertCircle, CheckCircle2, X } from 'lucide-react';
import DropshipPipelineBar from '@/components/admin/DropshipPipelineBar';

type Status = 'pending_payment' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
type PaymentStatus = 'pending' | 'completed' | 'failed';

interface Order {
  _id: string;
  application?: { fullName: string; businessName?: string; email: string };
  sellerBusinessName?: string;
  sellerEmail: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  productAmount: number;
  amount: number;
  specifications?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  shippingCarrier?: string;
  shippingService?: string;
  shippingRate: number;
  shippingCost: number;
  serviceFee: number;
  shippingEstimatedDays?: number;
  labelUrl?: string;
  specialInstructions?: string;
  status: Status;
  paymentStatus: PaymentStatus;
  trackingNumber?: string;
  trackingUrl?: string;
  createdAt: string;
}

const STATUS_META: Record<Status, { bg: string; color: string; label: string }> = {
  pending_payment: { bg: '#fffbeb', color: '#b45309', label: 'Awaiting Payment' },
  processing: { bg: '#eff6ff', color: '#1d4ed8', label: 'Processing' },
  shipped: { bg: '#f0fdf4', color: '#15803d', label: 'Shipped' },
  delivered: { bg: '#f0fdf4', color: '#15803d', label: 'Delivered' },
  cancelled: { bg: '#fef2f2', color: '#dc2626', label: 'Cancelled' },
};
const PAYMENT_META: Record<PaymentStatus, { bg: string; color: string; label: string }> = {
  pending: { bg: '#fffbeb', color: '#b45309', label: 'Unpaid' },
  completed: { bg: '#f0fdf4', color: '#15803d', label: 'Paid' },
  failed: { bg: '#fef2f2', color: '#dc2626', label: 'Payment Failed' },
};

const STATUS_OPTIONS: Status[] = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled'];

const FILTERS: { label: string; value: '' | Status }[] = [
  { label: 'All', value: '' },
  { label: 'Awaiting Payment', value: 'pending_payment' },
  { label: 'Processing', value: 'processing' },
  { label: 'Shipped', value: 'shipped' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function DropshipOrdersAdminPage() {
  const { apiFetch } = useApi();
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: Status; trackingNumber: string; trackingUrl: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch(`/api/admin/dropship/orders?${params.toString()}`);
      const list: Order[] = res.data?.orders ?? [];
      setOrders(list);
      setDrafts((prev) => {
        const next = { ...prev };
        list.forEach((o) => {
          if (!next[o._id]) {
            next[o._id] = {
              status: o.status,
              trackingNumber: o.trackingNumber || '',
              trackingUrl: o.trackingUrl || '',
            };
          }
        });
        return next;
      });
    } catch (e: any) {
      setError(e.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveOrder(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSaving(id);
    setError(null);
    try {
      await apiFetch(`/api/admin/dropship/orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      setNotice('Order updated.');
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to update order');
    } finally {
      setSaving(null);
    }
  }

  async function purchaseLabel(id: string) {
    setSaving(id);
    setError(null);
    try {
      await apiFetch(`/api/admin/dropship/orders/${id}/purchase-label`, { method: 'POST' });
      setNotice('Label purchased — tracking added.');
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to purchase label');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <a
        href="/admin/orders?source=dropship"
        className="mb-5 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px] font-semibold"
        style={{ background: '#ecfeff', border: '1px solid #a5f3fc', color: '#155e75' }}
      >
        <span>Good to know: every dropship order also shows in the main <u>Orders</u> tab, marked “DROPSHIP”. You can manage them there.</span>
        <span>Open Orders ›</span>
      </a>
      <div className="flex items-center gap-3 mb-6">
        <Package size={20} style={{ color: '#c9a84c' }} />
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#1a1714' }}>Dropship Orders</h1>
          <p className="text-xs" style={{ color: '#9c9690' }}>
            Orders submitted by approved dropship sellers. Only paid orders can move into fulfillment.
          </p>
        </div>
      </div>

      <DropshipPipelineBar />

      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={
              statusFilter === f.value
                ? { background: '#1a1714', color: '#fff' }
                : { border: '1px solid #e5e2db', color: '#5c5852' }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: '#15803d' }}><CheckCircle2 size={15} /> {notice}</div>
          <button onClick={() => setNotice(null)} className="text-[#15803d] hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {error && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: '#dc2626' }}><AlertCircle size={15} /> {error}</div>
          <button onClick={() => setError(null)} className="text-[#dc2626] hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin" size={20} style={{ color: '#c9a84c' }} /></div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl px-6 py-14 text-center" style={{ border: '1px dashed #e5e2db', color: '#9c9690', background: '#fff' }}>
          <Package size={22} className="mx-auto mb-2" />
          <p className="text-sm">No dropship orders found.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((o) => {
            const meta = STATUS_META[o.status];
            const payMeta = PAYMENT_META[o.paymentStatus];
            const draft = drafts[o._id] || { status: o.status, trackingNumber: '', trackingUrl: '' };
            const isOpen = expanded === o._id;
            const unpaid = o.paymentStatus !== 'completed';
            return (
              <div key={o._id} className="rounded-2xl px-6 py-5" style={{ border: '1px solid #ede9e1', background: '#fff' }}>
                <div
                  className="flex items-start justify-between flex-wrap gap-4 cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : o._id)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-semibold" style={{ color: '#1a1714' }}>
                        {o.quantity} × {o.productName}
                      </p>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: payMeta.bg, color: payMeta.color }}>
                        {payMeta.label}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: '#9c9690' }}>
                      Seller: {o.sellerBusinessName || o.application?.fullName || '—'} ({o.sellerEmail}) · ${o.amount.toFixed(2)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#9c9690' }}>
                      Ship to: {o.customerName} — {o.city}, {o.country}
                    </p>
                    <p className="text-[0.65rem] mt-1" style={{ color: '#b5b0a8' }}>
                      Submitted {new Date(o.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-4 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-6" style={{ borderTop: '1px solid #f0ede6' }}>
                    <div className="text-xs space-y-1" style={{ color: '#5c5852' }}>
                      <p><span className="font-semibold">Product:</span> {o.quantity} × ${o.unitPrice.toFixed(2)} = ${o.productAmount.toFixed(2)}</p>
                      {o.specifications && <p><span className="font-semibold">Notes:</span> {o.specifications}</p>}
                      <p><span className="font-semibold">Address:</span> {o.addressLine1}{o.addressLine2 ? `, ${o.addressLine2}` : ''}, {o.city}{o.state ? `, ${o.state}` : ''} {o.postalCode}, {o.country}</p>
                      {o.customerEmail && <p><span className="font-semibold">Customer email:</span> {o.customerEmail}</p>}
                      {o.customerPhone && <p><span className="font-semibold">Customer phone:</span> {o.customerPhone}</p>}
                      {o.shippingCarrier && (
                        <p><span className="font-semibold">Shipping:</span> {o.shippingCarrier} {o.shippingService} — ${o.shippingRate.toFixed(2)} + ${o.serviceFee.toFixed(2)} fee = ${o.shippingCost.toFixed(2)}</p>
                      )}
                      {o.specialInstructions && <p><span className="font-semibold">Instructions:</span> {o.specialInstructions}</p>}
                      {o.labelUrl && (
                        <p><a href={o.labelUrl} target="_blank" rel="noreferrer" className="font-semibold underline" style={{ color: '#c9a84c' }}>Download shipping label →</a></p>
                      )}
                    </div>

                    <div className="space-y-3">
                      {unpaid && (
                        <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: '#fffbeb', color: '#92400e' }}>
                          This order hasn't been paid yet — it can only be cancelled until payment completes.
                        </div>
                      )}
                      {!unpaid && !o.trackingNumber && (
                        <button
                          disabled={saving === o._id}
                          onClick={() => purchaseLabel(o._id)}
                          className="w-full px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-60"
                          style={{ border: '1px solid #c9a84c', color: '#c9a84c' }}
                        >
                          {saving === o._id ? 'Purchasing…' : 'Purchase Shipping Label'}
                        </button>
                      )}
                      <div>
                        <label className="block text-[11px] font-semibold mb-1" style={{ color: '#1a1714' }}>Status</label>
                        <select
                          value={draft.status}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [o._id]: { ...draft, status: e.target.value as Status } }))
                          }
                          className="w-full rounded-lg px-3 py-2 text-xs"
                          style={{ border: '1px solid #e5e2db' }}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option
                              key={s}
                              value={s}
                              disabled={unpaid && ['processing', 'shipped', 'delivered'].includes(s)}
                            >
                              {STATUS_META[s].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1" style={{ color: '#1a1714' }}>Tracking Number</label>
                        <input
                          value={draft.trackingNumber}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [o._id]: { ...draft, trackingNumber: e.target.value } }))
                          }
                          className="w-full rounded-lg px-3 py-2 text-xs"
                          style={{ border: '1px solid #e5e2db' }}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1" style={{ color: '#1a1714' }}>Tracking URL</label>
                        <input
                          value={draft.trackingUrl}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [o._id]: { ...draft, trackingUrl: e.target.value } }))
                          }
                          className="w-full rounded-lg px-3 py-2 text-xs"
                          style={{ border: '1px solid #e5e2db' }}
                        />
                      </div>
                      <button
                        disabled={saving === o._id}
                        onClick={() => saveOrder(o._id)}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                        style={{ background: '#1a1714' }}
                      >
                        {saving === o._id ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
