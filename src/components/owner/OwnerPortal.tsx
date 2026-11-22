import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bike,
  CheckCircle2,
  ClipboardList,
  Clock,
  History,
  IndianRupee,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Store,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  OrderStatus,
  OwnerOverviewResponse,
  RiderApprovalStatus,
  ServiceDefinition,
  UserProfile,
} from '../../types/domain';
import { BrandMark, VegMarker, formatINR, formatTime } from '../BrandMark';
import { PWAInstallButton } from '../PWAInstallButton';

interface OwnerPortalProps {
  user: UserProfile;
  services: ServiceDefinition[];
  onCatalogChanged: () => Promise<void>;
  onLogout: () => void;
}

type OwnerSection =
  | 'OVERVIEW'
  | 'ORDERS'
  | 'RESTAURANTS'
  | 'RIDERS'
  | 'CUSTOMERS'
  | 'PRICING'
  | 'PAYOUTS'
  | 'AUDIT';

export const OwnerPortal: React.FC<OwnerPortalProps> = ({
  user,
  services,
  onCatalogChanged,
  onLogout,
}) => {
  const [section, setSection] = useState<OwnerSection>('OVERVIEW');
  const [data, setData] = useState<OwnerOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Orders filter & dispatch
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'ACTIVE' | 'FOOD_DELIVERY' | 'SELF_PICKUP'>('ALL');
  const [assignSelection, setAssignSelection] = useState<Record<string, string>>({});

  // Restaurant & Menu management state
  const [selectedRestId, setSelectedRestId] = useState<string>('');
  const [newRestName, setNewRestName] = useState('');
  const [newRestCuisine, setNewRestCuisine] = useState('');
  const [newRestAddress, setNewRestAddress] = useState('');
  const [newRestPrep, setNewRestPrep] = useState('25');

  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Specials');
  const [newItemPrice, setNewItemPrice] = useState('199');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemVeg, setNewItemVeg] = useState(true);

  // Pricing state
  const [baseDeliveryFee, setBaseDeliveryFee] = useState('29');
  const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState('399');
  const [platformFee, setPlatformFee] = useState('6');
  const [selfPickupFee, setSelfPickupFee] = useState('0');
  const [riderCommissionPercent, setRiderCommissionPercent] = useState('80');

  // Manual Payout state
  const [payoutRiderId, setPayoutRiderId] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutRef, setPayoutRef] = useState('');
  const [payoutNote, setPayoutNote] = useState('Manual cash/bank batch settlement');

  // Rider Approval Dashboard state
  const [riderViewMode, setRiderViewMode] = useState<'DIRECTORY' | 'HISTORY'>('DIRECTORY');
  const [riderSearch, setRiderSearch] = useState('');
  const [riderStatusFilter, setRiderStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');
  const [docReasonDraft, setDocReasonDraft] = useState<Record<string, string>>({});
  const [foodReasonDraft, setFoodReasonDraft] = useState<Record<string, string>>({});

  // Audit filter
  const [auditQuery, setAuditQuery] = useState('');

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOwnerOverview();
      setData(res);
      if (!selectedRestId && res.restaurants.length > 0) {
        setSelectedRestId(res.restaurants[0].id);
      }
      if (res.riders.length > 0 && (!selectedRiderId || !res.riders.some((r) => r.id === selectedRiderId))) {
        const firstPending = res.riders.find(
          (r) =>
            (r.documentStatus || r.approvalStatus || 'PENDING') === 'PENDING' ||
            (r.serviceApprovals?.FOOD_DELIVERY?.status || r.approvalStatus || 'PENDING') === 'PENDING'
        );
        setSelectedRiderId((firstPending || res.riders[0]).id);
      }
      setBaseDeliveryFee(String(res.pricing.baseDeliveryFee));
      setFreeDeliveryThreshold(String(res.pricing.freeDeliveryThreshold));
      setPlatformFee(String(res.pricing.platformFee));
      setSelfPickupFee(String(res.pricing.selfPickupFee));
      setRiderCommissionPercent(String(res.pricing.riderCommissionPercent));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Owner console');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlineApprovedRiders = useMemo(
    () =>
      (data?.riders || []).filter(
        (r) =>
          (r.documentStatus || r.approvalStatus) === 'APPROVED' &&
          r.serviceApprovals?.FOOD_DELIVERY?.status === 'APPROVED' &&
          r.status === 'ACTIVE' &&
          r.isOnline
      ),
    [data]
  );

  const riderCounts = useMemo(() => {
    const list = data?.riders || [];
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of list) {
      const docSt = r.documentStatus || r.approvalStatus || 'PENDING';
      const foodSt = r.serviceApprovals?.FOOD_DELIVERY?.status || r.approvalStatus || 'PENDING';
      if (docSt === 'APPROVED' && foodSt === 'APPROVED') approved += 1;
      if (docSt === 'PENDING' || foodSt === 'PENDING') pending += 1;
      if (docSt === 'REJECTED' || foodSt === 'REJECTED') rejected += 1;
    }
    return { total: list.length, pending, approved, rejected };
  }, [data]);

  const filteredRiders = useMemo(() => {
    const q = riderSearch.trim().toLowerCase();
    return (data?.riders || []).filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) {
        return false;
      }
      const docSt = r.documentStatus || r.approvalStatus || 'PENDING';
      const foodSt = r.serviceApprovals?.FOOD_DELIVERY?.status || r.approvalStatus || 'PENDING';
      if (riderStatusFilter === 'APPROVED') {
        return docSt === 'APPROVED' && foodSt === 'APPROVED';
      }
      if (riderStatusFilter === 'PENDING') {
        return docSt === 'PENDING' || foodSt === 'PENDING';
      }
      if (riderStatusFilter === 'REJECTED') {
        return docSt === 'REJECTED' || foodSt === 'REJECTED';
      }
      return true;
    });
  }, [data, riderSearch, riderStatusFilter]);

  const selectedRider = useMemo(() => {
    if (filteredRiders.length === 0) return null;
    return filteredRiders.find((r) => r.id === selectedRiderId) || filteredRiders[0];
  }, [filteredRiders, selectedRiderId]);

  const selectedRiderHistory = useMemo(() => {
    if (!selectedRider) return [];
    return (data?.riderApprovalHistory || []).filter((h) => h.riderId === selectedRider.id);
  }, [data, selectedRider]);

  const filteredGlobalRiderHistory = useMemo(() => {
    const q = riderSearch.trim().toLowerCase();
    const list = data?.riderApprovalHistory || [];
    if (!q) return list;
    return list.filter(
      (h) =>
        h.riderName.toLowerCase().includes(q) ||
        h.riderEmail.toLowerCase().includes(q) ||
        h.reason.toLowerCase().includes(q)
    );
  }, [data, riderSearch]);

  const filteredOrders = useMemo(() => {
    const list = data?.orders || [];
    return list.filter((o) => {
      if (orderFilter === 'ACTIVE') return o.status !== 'COMPLETED' && o.status !== 'CANCELLED';
      if (orderFilter === 'FOOD_DELIVERY') return o.serviceType === 'FOOD_DELIVERY';
      if (orderFilter === 'SELF_PICKUP') return o.serviceType === 'SELF_PICKUP';
      return true;
    });
  }, [data, orderFilter]);

  const selectedRestaurant = useMemo(
    () => (data?.restaurants || []).find((r) => r.id === selectedRestId) || null,
    [data, selectedRestId]
  );

  const filteredAuditLogs = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    const list = data?.auditLogs || [];
    if (!q) return list;
    return list.filter(
      (a) =>
        a.action.toLowerCase().includes(q) ||
        a.actorEmail.toLowerCase().includes(q) ||
        a.target.toLowerCase().includes(q) ||
        a.details.toLowerCase().includes(q)
    );
  }, [data, auditQuery]);

  const runOwnerAction = async (fn: () => Promise<void>, successMessage: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await loadOverview();
      await onCatalogChanged();
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const navItems: { key: OwnerSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
    { key: 'ORDERS', label: 'Orders & Dispatch', icon: ClipboardList },
    { key: 'RESTAURANTS', label: 'Restaurants & Menus', icon: Store },
    { key: 'RIDERS', label: 'Riders & Approval', icon: Bike },
    { key: 'CUSTOMERS', label: 'Customers', icon: Users },
    { key: 'PRICING', label: 'Pricing Settings', icon: Settings },
    { key: 'PAYOUTS', label: 'Manual Payouts', icon: IndianRupee },
    { key: 'AUDIT', label: 'Audit Logs', icon: ScrollText },
  ];

  return (
    <div className="min-h-screen bg-[#F6F6F7] text-[#0B0B0D] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B0B0D] text-white border-r border-zinc-800">
        <div className="h-16 px-5 flex items-center justify-between border-b border-zinc-800">
          <BrandMark inverted size="sm" />
        </div>

        <div className="px-4 py-3 border-b border-zinc-800 text-xs">
          <div className="font-semibold text-[#FFC700]">Owner / Super Admin</div>
          <div className="text-zinc-400 truncate mt-0.5">{user.email}</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ key, label, icon: Icon }) => {
            const active = section === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`w-full min-h-[42px] flex items-center gap-3 rounded-xl px-3.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#FFC700] text-[#0B0B0D]'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-zinc-800 space-y-2">
          <PWAInstallButton />
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-900"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-zinc-200 px-4 sm:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden">
              <BrandMark size="sm" />
            </span>
            <h1 className="font-display text-base sm:text-lg font-bold text-[#0B0B0D] truncate">
              {navItems.find((n) => n.key === section)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadOverview}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 text-xs font-semibold hover:bg-zinc-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B0B0D] px-3 text-xs font-bold text-[#FFC700]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Exit
            </button>
          </div>
        </header>

        {/* Mobile Horizontal Section Switcher */}
        <div className="lg:hidden bg-white border-b border-zinc-200 px-4 py-2 overflow-x-auto flex items-center gap-1.5">
          {navItems.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                section === key
                  ? 'bg-[#0B0B0D] text-[#FFC700]'
                  : 'bg-zinc-100 text-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {error && (
            <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-semibold text-red-800">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-semibold text-emerald-900">
              {notice}
            </div>
          )}

          {!data ? (
            <div className="rounded-3xl bg-white border border-zinc-200 p-10 text-center text-sm text-zinc-500">
              Loading Owner console...
            </div>
          ) : (
            <>
              {/* OVERVIEW */}
              {section === 'OVERVIEW' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { label: 'Total Orders', value: String(data.metrics.totalOrders), sub: `${data.metrics.activeOrders} active` },
                      { label: 'Gross Volume', value: formatINR(data.metrics.grossOrderVolume), sub: `${data.metrics.completedOrders} completed` },
                      { label: 'Pending Rider Approvals', value: String(data.metrics.pendingRiderApprovals), sub: `${data.metrics.onlineApprovedRiders} online & approved` },
                      { label: 'Pending Manual Payouts', value: formatINR(data.metrics.pendingManualPayoutTotal), sub: 'Never auto-approved' },
                    ].map((kpi) => (
                      <div key={kpi.label} className="rounded-2xl bg-white border border-zinc-200 p-4 sm:p-5">
                        <div className="text-xs text-zinc-500">{kpi.label}</div>
                        <div className="font-mono text-2xl font-extrabold text-[#0B0B0D] mt-1">
                          {kpi.value}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Service Governance Matrix */}
                  <div className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-lg font-bold">
                        Platform Service Governance
                      </h2>
                      <span className="text-xs text-zinc-500">
                        {data.metrics.openRestaurants} open restaurants · {data.metrics.totalCustomers} customers
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                      {services.map((svc) => (
                        <div
                          key={svc.id}
                          className={`rounded-xl border p-3 text-xs ${
                            svc.enabled
                              ? 'bg-zinc-900 border-zinc-800 text-white'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                          }`}
                        >
                          <div className="font-bold">{svc.name}</div>
                          <div className={`mt-1 text-[11px] font-semibold ${svc.enabled ? 'text-[#FFC700]' : 'text-zinc-500'}`}>
                            {svc.enabled ? 'Active' : 'Disabled'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Orders & Audit Preview */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-display text-base font-bold">Latest Orders</h3>
                        <button
                          type="button"
                          onClick={() => setSection('ORDERS')}
                          className="text-xs font-semibold text-[#FF6B00] hover:underline"
                        >
                          Manage All →
                        </button>
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {data.orders.slice(0, 5).map((o) => (
                          <div key={o.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                            <div>
                              <div className="font-semibold">
                                <span className="font-mono">{o.orderNumber}</span> · {o.restaurantName}
                              </div>
                              <div className="text-zinc-500">
                                {o.customerName} · {o.serviceType === 'FOOD_DELIVERY' ? 'Delivery' : 'Self-Pickup'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono font-bold">{formatINR(o.totalAmount)}</div>
                              <div className="text-[#FF6B00] font-semibold">{o.status}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-display text-base font-bold">Recent Audit Logs</h3>
                        <button
                          type="button"
                          onClick={() => setSection('AUDIT')}
                          className="text-xs font-semibold text-[#FF6B00] hover:underline"
                        >
                          Full Log →
                        </button>
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {data.auditLogs.slice(0, 5).map((log) => (
                          <div key={log.id} className="py-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2 font-semibold">
                              <span>{log.action}</span>
                              <span className="font-mono text-[11px] text-zinc-500">
                                {formatTime(log.timestamp)}
                              </span>
                            </div>
                            <div className="text-zinc-600 mt-0.5 truncate">
                              {log.target} — {log.details}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ORDERS & RIDER DISPATCH */}
              {section === 'ORDERS' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-xl">
                      {([
                        ['ALL', 'All Orders'],
                        ['ACTIVE', 'Active'],
                        ['FOOD_DELIVERY', 'Delivery'],
                        ['SELF_PICKUP', 'Self-Pickup'],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setOrderFilter(key)}
                          className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${
                            orderFilter === key ? 'bg-white text-[#0B0B0D] shadow-sm' : 'text-zinc-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-zinc-500">
                      {onlineApprovedRiders.length} online approved rider(s) available for dispatch
                    </span>
                  </div>

                  <div className="space-y-3">
                    {filteredOrders.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-zinc-100">
                          <div>
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                              <span className="font-mono font-bold text-[#0B0B0D]">
                                {order.orderNumber}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{order.serviceType === 'FOOD_DELIVERY' ? 'Food Delivery' : 'Self-Pickup'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{formatTime(order.createdAt)}</span>
                            </div>
                            <div className="font-display text-base font-bold mt-1">
                              {order.restaurantName} → {order.customerName} ({order.customerPhone})
                            </div>
                            <div className="text-xs text-zinc-600 mt-0.5">
                              {order.serviceType === 'FOOD_DELIVERY'
                                ? `Drop: ${order.deliveryAddress}`
                                : `Counter Pickup: ${order.pickupInstructions}`}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-mono text-base font-bold">{formatINR(order.totalAmount)}</div>
                            <div className="text-xs font-semibold text-[#FF6B00]">{order.status}</div>
                            <div className="text-[11px] text-zinc-500">
                              {order.paymentMethod} · {order.paymentStatus}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                          {/* Order status controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-500 mr-1">Set Status:</span>
                            {(
                              ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'] as OrderStatus[]
                            ).map((st) => (
                              <button
                                key={st}
                                type="button"
                                disabled={order.status === st}
                                onClick={() =>
                                  runOwnerAction(
                                    () => api.updateOrderStatus(order.id, st).then(() => undefined),
                                    `Order ${order.orderNumber} marked ${st}`
                                  )
                                }
                                className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                                  order.status === st
                                    ? 'bg-[#0B0B0D] text-[#FFC700] border-[#0B0B0D]'
                                    : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50'
                                }`}
                              >
                                {st.replace(/_/g, ' ')}
                              </button>
                            ))}
                          </div>

                          {/* Rider Assignment for Delivery orders */}
                          {order.serviceType === 'FOOD_DELIVERY' &&
                            order.status !== 'COMPLETED' &&
                            order.status !== 'CANCELLED' && (
                              <div className="flex items-center gap-2">
                                <select
                                  value={assignSelection[order.id] ?? order.assignedRiderId ?? ''}
                                  onChange={(e) =>
                                    setAssignSelection((prev) => ({
                                      ...prev,
                                      [order.id]: e.target.value,
                                    }))
                                  }
                                  className="min-h-[38px] rounded-xl border border-zinc-300 bg-white px-3 text-xs"
                                >
                                  <option value="">
                                    {order.assignedRiderName
                                      ? `Assigned: ${order.assignedRiderName} (${order.riderJobStatus})`
                                      : 'Select Online Approved Rider'}
                                  </option>
                                  {onlineApprovedRiders.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.name} ({r.documents?.dummyVehiclePlate || 'Rider'})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!assignSelection[order.id]}
                                  onClick={() =>
                                    runOwnerAction(
                                      () =>
                                        api
                                          .assignRider(order.id, assignSelection[order.id])
                                          .then(() => undefined),
                                      `Assigned rider to ${order.orderNumber}`
                                    )
                                  }
                                  className="min-h-[38px] rounded-xl bg-[#FFC700] px-3.5 text-xs font-bold text-[#0B0B0D] disabled:opacity-40 whitespace-nowrap"
                                >
                                  Assign Rider
                                </button>
                              </div>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RESTAURANTS & MENUS */}
              {section === 'RESTAURANTS' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left: Add & List Restaurants */}
                  <div className="lg:col-span-5 space-y-5">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        runOwnerAction(
                          () =>
                            api
                              .createRestaurant({
                                name: newRestName,
                                cuisine: newRestCuisine,
                                address: newRestAddress,
                                prepTimeMins: Number(newRestPrep) || 25,
                                supportsDelivery: true,
                                supportsSelfPickup: true,
                              })
                              .then(() => {
                                setNewRestName('');
                                setNewRestCuisine('');
                                setNewRestAddress('');
                              }),
                          'Restaurant added'
                        );
                      }}
                      className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3"
                    >
                      <h2 className="font-display text-base font-bold flex items-center gap-2">
                        <Plus className="h-4 w-4 text-[#FF6B00]" />
                        Add Restaurant
                      </h2>
                      <input
                        type="text"
                        required
                        value={newRestName}
                        onChange={(e) => setNewRestName(e.target.value)}
                        placeholder="Restaurant name"
                        className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          value={newRestCuisine}
                          onChange={(e) => setNewRestCuisine(e.target.value)}
                          placeholder="Cuisine (e.g. North Indian)"
                          className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm"
                        />
                        <input
                          type="number"
                          min={10}
                          max={90}
                          value={newRestPrep}
                          onChange={(e) => setNewRestPrep(e.target.value)}
                          placeholder="Prep mins"
                          className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm font-mono"
                        />
                      </div>
                      <input
                        type="text"
                        required
                        value={newRestAddress}
                        onChange={(e) => setNewRestAddress(e.target.value)}
                        placeholder="Kitchen address"
                        className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm"
                      />
                      <button
                        type="submit"
                        className="w-full min-h-[44px] rounded-xl bg-[#0B0B0D] text-xs font-bold text-[#FFC700]"
                      >
                        Create Restaurant
                      </button>
                    </form>

                    <div className="rounded-3xl bg-white border border-zinc-200 p-4 space-y-2">
                      <h3 className="font-display text-sm font-bold px-1">
                        Restaurants ({data.restaurants.length})
                      </h3>
                      {data.restaurants.map((r) => (
                        <div
                          key={r.id}
                          className={`rounded-2xl border p-3.5 transition-colors ${
                            selectedRestId === r.id
                              ? 'border-[#0B0B0D] bg-zinc-50'
                              : 'border-zinc-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedRestId(r.id)}
                              className="text-left min-w-0"
                            >
                              <div className="font-bold text-sm truncate">{r.name}</div>
                              <div className="text-xs text-zinc-500">
                                {r.cuisine} · {r.menu.length} items
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runOwnerAction(
                                  () => api.updateRestaurant(r.id, { isOpen: !r.isOpen }).then(() => undefined),
                                  `${r.name} marked ${!r.isOpen ? 'OPEN' : 'CLOSED'}`
                                )
                              }
                              className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-bold ${
                                r.isOpen
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-zinc-100 text-zinc-600 border border-zinc-300'
                              }`}
                            >
                              {r.isOpen ? 'Open' : 'Closed'}
                            </button>
                          </div>

                          <div className="mt-2.5 flex items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() =>
                                runOwnerAction(
                                  () =>
                                    api
                                      .updateRestaurant(r.id, { supportsDelivery: !r.supportsDelivery })
                                      .then(() => undefined),
                                  `Updated delivery flag for ${r.name}`
                                )
                              }
                              className={`px-2 py-1 rounded border ${
                                r.supportsDelivery
                                  ? 'bg-[#FFC700]/30 border-[#FFC700] text-[#0B0B0D]'
                                  : 'border-zinc-200 text-zinc-400'
                              }`}
                            >
                              Delivery: {r.supportsDelivery ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runOwnerAction(
                                  () =>
                                    api
                                      .updateRestaurant(r.id, {
                                        supportsSelfPickup: !r.supportsSelfPickup,
                                      })
                                      .then(() => undefined),
                                  `Updated self-pickup flag for ${r.name}`
                                )
                              }
                              className={`px-2 py-1 rounded border ${
                                r.supportsSelfPickup
                                  ? 'bg-[#FFC700]/30 border-[#FFC700] text-[#0B0B0D]'
                                  : 'border-zinc-200 text-zinc-400'
                              }`}
                            >
                              Self-Pickup: {r.supportsSelfPickup ? 'ON' : 'OFF'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: Menu Management for Selected Restaurant */}
                  <div className="lg:col-span-7 space-y-5">
                    {selectedRestaurant ? (
                      <>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            runOwnerAction(
                              () =>
                                api
                                  .addMenuItem(selectedRestaurant.id, {
                                    name: newItemName,
                                    category: newItemCategory,
                                    price: Number(newItemPrice),
                                    description: newItemDesc,
                                    isVeg: newItemVeg,
                                  })
                                  .then(() => {
                                    setNewItemName('');
                                    setNewItemDesc('');
                                  }),
                              `Added menu item to ${selectedRestaurant.name}`
                            );
                          }}
                          className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3"
                        >
                          <h2 className="font-display text-base font-bold">
                            Add Menu Item to {selectedRestaurant.name}
                          </h2>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <input
                              type="text"
                              required
                              value={newItemName}
                              onChange={(e) => setNewItemName(e.target.value)}
                              placeholder="Dish name"
                              className="sm:col-span-2 min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm"
                            />
                            <input
                              type="number"
                              required
                              min={1}
                              value={newItemPrice}
                              onChange={(e) => setNewItemPrice(e.target.value)}
                              placeholder="Price ₹"
                              className="min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm font-mono"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              type="text"
                              required
                              value={newItemCategory}
                              onChange={(e) => setNewItemCategory(e.target.value)}
                              placeholder="Category (e.g. Biryani)"
                              className="min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => setNewItemVeg((v) => !v)}
                              className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                                newItemVeg
                                  ? 'bg-emerald-50 border-emerald-600 text-emerald-800'
                                  : 'bg-red-50 border-red-600 text-red-800'
                              }`}
                            >
                              {newItemVeg ? 'Vegetarian Dish' : 'Non-Vegetarian Dish'}
                            </button>
                          </div>
                          <input
                            type="text"
                            value={newItemDesc}
                            onChange={(e) => setNewItemDesc(e.target.value)}
                            placeholder="Short dish description"
                            className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-sm"
                          />
                          <button
                            type="submit"
                            className="min-h-[44px] px-5 rounded-xl bg-[#FFC700] text-xs font-bold text-[#0B0B0D]"
                          >
                            Add Dish to Menu
                          </button>
                        </form>

                        <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
                          <h3 className="font-display text-base font-bold">
                            Menu Items ({selectedRestaurant.menu.length})
                          </h3>
                          <div className="divide-y divide-zinc-100">
                            {selectedRestaurant.menu.map((item) => (
                              <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <VegMarker isVeg={item.isVeg} />
                                    <span className="font-semibold text-sm truncate">{item.name}</span>
                                    <span className="text-xs text-zinc-500">· {item.category}</span>
                                  </div>
                                  <div className="font-mono text-xs font-bold text-zinc-700 mt-0.5">
                                    {formatINR(item.price)}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateMenuItem(item.id, { isAvailable: !item.isAvailable })
                                          .then(() => undefined),
                                      `Updated availability of ${item.name}`
                                    )
                                  }
                                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold border ${
                                    item.isAvailable
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                      : 'bg-zinc-100 border-zinc-300 text-zinc-500'
                                  }`}
                                >
                                  {item.isAvailable ? 'In Stock' : 'Disabled'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-3xl bg-white border border-zinc-200 p-10 text-center text-sm text-zinc-500">
                        Select a restaurant to manage its menu.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* OWNER RIDER APPROVAL DASHBOARD */}
              {section === 'RIDERS' && (
                <div className="space-y-5">
                  {/* Rider Approval KPI Strip */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: 'Total Riders', value: String(riderCounts.total), sub: 'Unified rider accounts' },
                      { label: 'Pending Review', value: String(riderCounts.pending), sub: 'Docs or Food Delivery pending' },
                      { label: 'Fully Approved', value: String(riderCounts.approved), sub: `${onlineApprovedRiders.length} currently online` },
                      { label: 'Rejected Items', value: String(riderCounts.rejected), sub: 'Docs or service rejected' },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-2xl bg-white border border-zinc-200 p-4">
                        <div className="text-xs text-zinc-500">{stat.label}</div>
                        <div className="font-mono tabular-nums text-2xl font-extrabold text-[#0B0B0D] mt-1">
                          {stat.value}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1">{stat.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Search, Status Filters & History Mode Bar */}
                  <div className="rounded-2xl bg-white border border-zinc-200 p-4 space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="relative flex-1">
                        <Search className="h-4 w-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={riderSearch}
                          onChange={(e) => setRiderSearch(e.target.value)}
                          placeholder="Search riders by name or email..."
                          className="w-full min-h-[42px] rounded-xl border border-zinc-300 bg-white pl-10 pr-3 text-sm text-[#0B0B0D] focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                        />
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-xl shrink-0">
                        <button
                          type="button"
                          onClick={() => setRiderViewMode('DIRECTORY')}
                          className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
                            riderViewMode === 'DIRECTORY'
                              ? 'bg-[#0B0B0D] text-[#FFC700]'
                              : 'text-zinc-600 hover:text-[#0B0B0D]'
                          }`}
                        >
                          <Bike className="h-3.5 w-3.5" />
                          Rider Review ({filteredRiders.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setRiderViewMode('HISTORY')}
                          className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
                            riderViewMode === 'HISTORY'
                              ? 'bg-[#0B0B0D] text-[#FFC700]'
                              : 'text-zinc-600 hover:text-[#0B0B0D]'
                          }`}
                        >
                          <History className="h-3.5 w-3.5" />
                          Approval History ({filteredGlobalRiderHistory.length})
                        </button>
                      </div>
                    </div>

                    {riderViewMode === 'DIRECTORY' && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100">
                        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-xl">
                          {([
                            ['ALL', `All (${riderCounts.total})`],
                            ['PENDING', `Pending (${riderCounts.pending})`],
                            ['APPROVED', `Approved (${riderCounts.approved})`],
                            ['REJECTED', `Rejected (${riderCounts.rejected})`],
                          ] as const).map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setRiderStatusFilter(key)}
                              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                                riderStatusFilter === key
                                  ? 'bg-white text-[#0B0B0D] shadow-sm'
                                  : 'text-zinc-600 hover:text-[#0B0B0D]'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="text-[11px] text-zinc-500">
                          Online rule: Docs = APPROVED &amp; Food Delivery = APPROVED
                        </span>
                      </div>
                    )}
                  </div>

                  {riderViewMode === 'HISTORY' ? (
                    /* GLOBAL APPROVAL HISTORY TABLE */
                    <div className="rounded-3xl bg-white border border-zinc-200 overflow-hidden">
                      <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="font-display text-base font-bold text-[#0B0B0D]">
                            Rider Approval History Log
                          </h2>
                          <p className="text-xs text-zinc-500">
                            Persisted chronological record of all document and Food Delivery service decisions.
                          </p>
                        </div>
                        <span className="font-mono tabular-nums text-xs text-zinc-500">
                          {filteredGlobalRiderHistory.length} entries
                        </span>
                      </div>

                      {filteredGlobalRiderHistory.length === 0 ? (
                        <div className="p-10 text-center text-xs text-zinc-500">
                          No rider approval history entries match your search.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                              <tr>
                                <th className="py-3 px-4 font-semibold">Timestamp</th>
                                <th className="py-3 px-4 font-semibold">Rider</th>
                                <th className="py-3 px-4 font-semibold">Approval Scope</th>
                                <th className="py-3 px-4 font-semibold">Decision</th>
                                <th className="py-3 px-4 font-semibold">Reason / Notes</th>
                                <th className="py-3 px-4 font-semibold">Reviewed By</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {filteredGlobalRiderHistory.map((entry) => (
                                <tr key={entry.id} className="hover:bg-zinc-50/70">
                                  <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-zinc-500 whitespace-nowrap">
                                    {formatTime(entry.timestamp)}
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedRiderId(entry.riderId);
                                        setRiderStatusFilter('ALL');
                                        setRiderSearch('');
                                        setRiderViewMode('DIRECTORY');
                                      }}
                                      className="text-left hover:underline"
                                    >
                                      <div className="font-semibold text-[#0B0B0D]">{entry.riderName}</div>
                                      <div className="text-[11px] text-zinc-500">{entry.riderEmail}</div>
                                    </button>
                                  </td>
                                  <td className="py-3 px-4 font-semibold text-zinc-700 whitespace-nowrap">
                                    {entry.target === 'DOCUMENTS'
                                      ? 'Documents'
                                      : entry.target === 'SERVICE_FOOD_DELIVERY'
                                        ? 'Food Delivery Service'
                                        : 'Registration'}
                                  </td>
                                  <td className="py-3 px-4 font-mono font-bold whitespace-nowrap">
                                    <span
                                      className={
                                        entry.newStatus === 'APPROVED'
                                          ? 'text-emerald-700'
                                          : entry.newStatus === 'REJECTED'
                                            ? 'text-red-700'
                                            : 'text-amber-700'
                                      }
                                    >
                                      {entry.previousStatus && entry.previousStatus !== 'NONE'
                                        ? `${entry.previousStatus} → ${entry.newStatus}`
                                        : entry.newStatus}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-zinc-700 max-w-md">{entry.reason}</td>
                                  <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                                    {entry.actorRole} · {entry.actorEmail}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : filteredRiders.length === 0 ? (
                    <div className="rounded-3xl bg-white border border-zinc-200 p-10 text-center space-y-3">
                      <div className="text-sm font-semibold text-zinc-700">
                        {riderCounts.total === 0
                          ? 'No registered riders yet'
                          : 'No riders match your current search or filter'}
                      </div>
                      {riderCounts.total === 0 ? (
                        <p className="text-xs text-zinc-500 max-w-md mx-auto">
                          Newly registered riders appear here automatically (newest first) for separate document verification and Food Delivery service approval.
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRiderSearch('');
                            setRiderStatusFilter('ALL');
                          }}
                          className="min-h-[40px] px-4 rounded-xl bg-[#0B0B0D] text-xs font-bold text-[#FFC700]"
                        >
                          Reset Rider Filters
                        </button>
                      )}
                    </div>
                  ) : (
                    /* MASTER-DETAIL RIDER APPROVAL WORKBENCH */
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                      {/* Left Directory List */}
                      <div className="lg:col-span-5 rounded-3xl bg-white border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between text-xs font-semibold text-zinc-600">
                          <span>Registered Riders</span>
                          <span className="font-mono tabular-nums">{filteredRiders.length} shown</span>
                        </div>
                        {filteredRiders.map((rider) => {
                          const dStatus = rider.documentStatus || rider.approvalStatus || 'PENDING';
                          const fStatus =
                            rider.serviceApprovals?.FOOD_DELIVERY?.status ||
                            rider.approvalStatus ||
                            'PENDING';
                          const isSelected = selectedRider?.id === rider.id;
                          return (
                            <button
                              key={rider.id}
                              type="button"
                              onClick={() => setSelectedRiderId(rider.id)}
                              className={`w-full text-left p-4 transition-colors ${
                                isSelected ? 'bg-[#FFC700]/15' : 'hover:bg-zinc-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-display font-bold text-sm text-[#0B0B0D] truncate">
                                    {rider.name}
                                  </div>
                                  <div className="text-xs text-zinc-600 truncate">
                                    {rider.email} · {rider.cityArea || 'Bengaluru'}
                                  </div>
                                </div>
                                <span className="text-[11px] font-mono tabular-nums text-zinc-500 shrink-0">
                                  {rider.isOnline ? 'Online' : 'Offline'}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                                <span
                                  className={`font-mono font-bold ${
                                    dStatus === 'APPROVED'
                                      ? 'text-emerald-700'
                                      : dStatus === 'REJECTED'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  Docs: {dStatus}
                                </span>
                                <span aria-hidden="true" className="text-zinc-300">·</span>
                                <span
                                  className={`font-mono font-bold ${
                                    fStatus === 'APPROVED'
                                      ? 'text-emerald-700'
                                      : fStatus === 'REJECTED'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  Food Delivery: {fStatus}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Right Selected Rider Inspection & Approval Workbench */}
                      {selectedRider && (() => {
                        const docStatus: RiderApprovalStatus =
                          selectedRider.documentStatus || selectedRider.approvalStatus || 'PENDING';
                        const foodStatus =
                          selectedRider.serviceApprovals?.FOOD_DELIVERY?.status ||
                          selectedRider.approvalStatus ||
                          'PENDING';
                        const bothApproved = docStatus === 'APPROVED' && foodStatus === 'APPROVED';
                        const bank = selectedRider.documents?.dummyBankDetails;
                        const docReasonInput = docReasonDraft[selectedRider.id] ?? '';
                        const foodReasonInput = foodReasonDraft[selectedRider.id] ?? '';

                        return (
                          <div className="lg:col-span-7 rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-6">
                            {/* 1. Rider Profile Header */}
                            <div className="pb-4 border-b border-zinc-100 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                  <span
                                    className={`font-bold ${
                                      bothApproved ? 'text-emerald-700' : 'text-amber-700'
                                    }`}
                                  >
                                    {bothApproved ? 'Online-Eligible' : 'Online Locked'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{selectedRider.isOnline ? 'Currently Online' : 'Offline'}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    {selectedRider.completedDeliveries} deliveries
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    Pending Payout: {formatINR(selectedRider.pendingBalance)}
                                  </span>
                                </div>
                                <h2 className="font-display text-xl font-bold text-[#0B0B0D] mt-1">
                                  {selectedRider.name}
                                </h2>
                                <div className="text-xs text-zinc-600 mt-0.5">
                                  {selectedRider.email} · {selectedRider.phone} ·{' '}
                                  {selectedRider.cityArea || 'Bengaluru'}
                                </div>
                                <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
                                  Joined {formatTime(selectedRider.createdAt)} · Account {selectedRider.status}
                                </div>
                              </div>
                            </div>

                            {/* 2. Profile, Vehicle & Submitted Document References */}
                            <div className="space-y-3">
                              <h3 className="text-xs font-bold text-[#0B0B0D]">
                                Rider Vehicle, Document References &amp; Dummy Bank Structure
                              </h3>
                              {selectedRider.documents ? (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-zinc-50 rounded-2xl p-4 border border-zinc-200/70">
                                  <div>
                                    <div className="text-zinc-500">Vehicle Type</div>
                                    <div className="font-semibold mt-0.5">
                                      {selectedRider.documents.dummyVehicleType}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Registration Plate</div>
                                    <div className="font-mono font-semibold mt-0.5">
                                      {selectedRider.documents.dummyVehiclePlate}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Dummy Licence #</div>
                                    <div className="font-mono font-semibold mt-0.5">
                                      {selectedRider.documents.dummyLicenseRef}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Dummy Gov ID</div>
                                    <div className="font-mono font-semibold mt-0.5">
                                      {selectedRider.documents.dummyGovIdRef}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Dummy Holder</div>
                                    <div className="font-semibold mt-0.5">
                                      {bank?.accountHolderName || `${selectedRider.name} (Test)`}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Dummy Account #</div>
                                    <div className="font-mono font-semibold mt-0.5">
                                      {bank?.dummyAccountNumber || 'Not set'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Dummy IFSC</div>
                                    <div className="font-mono font-semibold mt-0.5">
                                      {bank?.dummyIfscCode || 'MOCK0003690'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-zinc-500">Dummy Payout Ref</div>
                                    <div className="font-mono font-semibold mt-0.5">
                                      {bank?.dummyPayoutRef || selectedRider.documents.dummyPayoutRef}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-zinc-500 py-2">
                                  Rider has not submitted dummy document references yet.
                                </div>
                              )}
                            </div>

                            {/* 3. SEPARATE DOCUMENT APPROVAL SECTION */}
                            <div className="pt-4 border-t border-zinc-200 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <h3 className="text-sm font-bold text-[#0B0B0D]">
                                    1. Document Verification Approval (Separate)
                                  </h3>
                                  <p className="text-[11px] text-zinc-500">
                                    Approving documents does not approve Food Delivery service.
                                  </p>
                                </div>
                                <span
                                  className={`font-mono text-xs font-bold ${
                                    docStatus === 'APPROVED'
                                      ? 'text-emerald-700'
                                      : docStatus === 'REJECTED'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  Current: {docStatus}
                                </span>
                              </div>

                              {(selectedRider.documentNotes || selectedRider.approvalNotes) && (
                                <div
                                  className={`rounded-xl px-3.5 py-2.5 text-xs border ${
                                    docStatus === 'REJECTED'
                                      ? 'bg-red-50 border-red-200 text-red-800'
                                      : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                                  }`}
                                >
                                  <span className="font-semibold">
                                    {docStatus === 'REJECTED' ? 'Latest Document Rejection Reason: ' : 'Latest Document Note: '}
                                  </span>
                                  {selectedRider.documentNotes || selectedRider.approvalNotes}
                                </div>
                              )}

                              <div>
                                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                                  Document Review Note / Rejection Reason (required when rejecting)
                                </label>
                                <input
                                  type="text"
                                  value={docReasonInput}
                                  onChange={(e) =>
                                    setDocReasonDraft((prev) => ({
                                      ...prev,
                                      [selectedRider.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="e.g., Dummy licence reference mismatch — please re-submit"
                                  className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                                />
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={docStatus === 'APPROVED'}
                                  onClick={() =>
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateRiderDocumentStatus(
                                            selectedRider.id,
                                            'APPROVED',
                                            docReasonInput.trim() ||
                                              'Dummy documents & vehicle details approved by Owner'
                                          )
                                          .then(() => {
                                            setDocReasonDraft((prev) => ({
                                              ...prev,
                                              [selectedRider.id]: '',
                                            }));
                                          }),
                                      `Approved documents for ${selectedRider.name}`
                                    )
                                  }
                                  className="min-h-[40px] px-4 rounded-xl bg-emerald-700 text-xs font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Approve Documents
                                </button>
                                <button
                                  type="button"
                                  disabled={docStatus === 'PENDING'}
                                  onClick={() =>
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateRiderDocumentStatus(
                                            selectedRider.id,
                                            'PENDING',
                                            docReasonInput.trim() ||
                                              'Documents set to Pending review by Owner'
                                          )
                                          .then(() => {
                                            setDocReasonDraft((prev) => ({
                                              ...prev,
                                              [selectedRider.id]: '',
                                            }));
                                          }),
                                      `Set documents to Pending for ${selectedRider.name}`
                                    )
                                  }
                                  className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                                >
                                  <Clock className="h-3.5 w-3.5" />
                                  Set Pending
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (docReasonInput.trim().length < 3) {
                                      setError(
                                        'Please enter a Document Rejection Reason (at least 3 characters) before rejecting documents.'
                                      );
                                      return;
                                    }
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateRiderDocumentStatus(
                                            selectedRider.id,
                                            'REJECTED',
                                            docReasonInput.trim()
                                          )
                                          .then(() => {
                                            setDocReasonDraft((prev) => ({
                                              ...prev,
                                              [selectedRider.id]: '',
                                            }));
                                          }),
                                      `Rejected documents for ${selectedRider.name}`
                                    );
                                  }}
                                  className="min-h-[40px] px-4 rounded-xl border border-red-300 text-xs font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Reject Documents
                                </button>
                              </div>
                            </div>

                            {/* 4. SEPARATE SERVICE APPROVAL SECTION */}
                            <div className="pt-4 border-t border-zinc-200 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <h3 className="text-sm font-bold text-[#0B0B0D]">
                                    2. Service Approval: Food Delivery (Separate)
                                  </h3>
                                  <p className="text-[11px] text-zinc-500">
                                    Rider can go online only when Documents AND Food Delivery are both Approved.
                                  </p>
                                </div>
                                <span
                                  className={`font-mono text-xs font-bold ${
                                    foodStatus === 'APPROVED'
                                      ? 'text-emerald-700'
                                      : foodStatus === 'REJECTED'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  Current: {foodStatus}
                                </span>
                              </div>

                              {selectedRider.serviceApprovals?.FOOD_DELIVERY?.notes && (
                                <div
                                  className={`rounded-xl px-3.5 py-2.5 text-xs border ${
                                    foodStatus === 'REJECTED'
                                      ? 'bg-red-50 border-red-200 text-red-800'
                                      : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                                  }`}
                                >
                                  <span className="font-semibold">
                                    {foodStatus === 'REJECTED'
                                      ? 'Food Delivery Rejection Reason: '
                                      : 'Food Delivery Note: '}
                                  </span>
                                  {selectedRider.serviceApprovals.FOOD_DELIVERY.notes}
                                </div>
                              )}

                              <div>
                                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                                  Food Delivery Service Note / Rejection Reason (required when rejecting)
                                </label>
                                <input
                                  type="text"
                                  value={foodReasonInput}
                                  onChange={(e) =>
                                    setFoodReasonDraft((prev) => ({
                                      ...prev,
                                      [selectedRider.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="e.g., Thermal bag confirmation required for Food Delivery"
                                  className="w-full min-h-[42px] rounded-xl border border-zinc-300 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                                />
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={foodStatus === 'APPROVED'}
                                  onClick={() =>
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateRiderServiceApproval(
                                            selectedRider.id,
                                            'FOOD_DELIVERY',
                                            'APPROVED',
                                            foodReasonInput.trim() ||
                                              'Food Delivery service approved by Owner'
                                          )
                                          .then(() => {
                                            setFoodReasonDraft((prev) => ({
                                              ...prev,
                                              [selectedRider.id]: '',
                                            }));
                                          }),
                                      `Approved Food Delivery for ${selectedRider.name}`
                                    )
                                  }
                                  className="min-h-[40px] px-4 rounded-xl bg-[#0B0B0D] text-xs font-bold text-[#FFC700] inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Approve Food Delivery
                                </button>
                                <button
                                  type="button"
                                  disabled={foodStatus === 'PENDING'}
                                  onClick={() =>
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateRiderServiceApproval(
                                            selectedRider.id,
                                            'FOOD_DELIVERY',
                                            'PENDING',
                                            foodReasonInput.trim() ||
                                              'Food Delivery service set to Pending by Owner'
                                          )
                                          .then(() => {
                                            setFoodReasonDraft((prev) => ({
                                              ...prev,
                                              [selectedRider.id]: '',
                                            }));
                                          }),
                                      `Set Food Delivery to Pending for ${selectedRider.name}`
                                    )
                                  }
                                  className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                                >
                                  <Clock className="h-3.5 w-3.5" />
                                  Set Pending
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (foodReasonInput.trim().length < 3) {
                                      setError(
                                        'Please enter a Food Delivery Service Rejection Reason (at least 3 characters) before rejecting.'
                                      );
                                      return;
                                    }
                                    runOwnerAction(
                                      () =>
                                        api
                                          .updateRiderServiceApproval(
                                            selectedRider.id,
                                            'FOOD_DELIVERY',
                                            'REJECTED',
                                            foodReasonInput.trim()
                                          )
                                          .then(() => {
                                            setFoodReasonDraft((prev) => ({
                                              ...prev,
                                              [selectedRider.id]: '',
                                            }));
                                          }),
                                      `Rejected Food Delivery for ${selectedRider.name}`
                                    );
                                  }}
                                  className="min-h-[40px] px-4 rounded-xl border border-red-300 text-xs font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Reject Food Delivery
                                </button>
                              </div>

                              {/* Disabled Future Services */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                                {[
                                  { key: 'GROCERY', name: 'Grocery Delivery' },
                                  { key: 'PARCEL', name: 'Parcel Delivery' },
                                  { key: 'BIKE_TAXI', name: 'Bike Taxi' },
                                ].map((svc) => (
                                  <div
                                    key={svc.key}
                                    className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500"
                                  >
                                    <span className="font-semibold truncate">{svc.name}</span>
                                    <span className="inline-flex items-center gap-1 font-mono font-semibold shrink-0">
                                      <Lock className="h-3 w-3" />
                                      Disabled
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* 5. PER-RIDER APPROVAL HISTORY */}
                            <div className="pt-4 border-t border-zinc-200 space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-bold text-[#0B0B0D]">
                                  Approval History for {selectedRider.name}
                                </h3>
                                <span className="font-mono tabular-nums text-[11px] text-zinc-500">
                                  {selectedRiderHistory.length} event(s)
                                </span>
                              </div>

                              {selectedRiderHistory.length === 0 ? (
                                <p className="text-xs text-zinc-500 py-2">
                                  No approval events recorded for this rider yet.
                                </p>
                              ) : (
                                <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-2xl overflow-hidden">
                                  {selectedRiderHistory.map((item) => (
                                    <div key={item.id} className="p-3 text-xs space-y-1 bg-white">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-semibold text-[#0B0B0D]">
                                          {item.target === 'DOCUMENTS'
                                            ? 'Documents'
                                            : item.target === 'SERVICE_FOOD_DELIVERY'
                                              ? 'Food Delivery Service'
                                              : 'Registration'}
                                          {' · '}
                                          <span
                                            className={`font-mono font-bold ${
                                              item.newStatus === 'APPROVED'
                                                ? 'text-emerald-700'
                                                : item.newStatus === 'REJECTED'
                                                  ? 'text-red-700'
                                                  : 'text-amber-700'
                                            }`}
                                          >
                                            {item.previousStatus && item.previousStatus !== 'NONE'
                                              ? `${item.previousStatus} → ${item.newStatus}`
                                              : item.newStatus}
                                          </span>
                                        </span>
                                        <span className="font-mono tabular-nums text-[11px] text-zinc-500">
                                          {formatTime(item.timestamp)}
                                        </span>
                                      </div>
                                      <div className="text-zinc-700">{item.reason}</div>
                                      <div className="text-[11px] text-zinc-500">
                                        Actor: {item.actorRole} ({item.actorEmail})
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* CUSTOMERS */}
              {section === 'CUSTOMERS' && (
                <div className="rounded-3xl bg-white border border-zinc-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Customer</th>
                          <th className="py-3 px-4 font-semibold">Contact</th>
                          <th className="py-3 px-4 font-semibold">Saved Address</th>
                          <th className="py-3 px-4 font-semibold text-right">Orders</th>
                          <th className="py-3 px-4 font-semibold text-right">Account</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {data.customers.map((c) => (
                          <tr key={c.id} className="hover:bg-zinc-50/60">
                            <td className="py-3 px-4 font-semibold text-[#0B0B0D]">{c.name}</td>
                            <td className="py-3 px-4 text-zinc-600">
                              {c.email} · {c.phone}
                            </td>
                            <td className="py-3 px-4 text-zinc-500 max-w-xs truncate">
                              {c.savedAddress || '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold">
                              {c.orderCount}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  runOwnerAction(
                                    () =>
                                      api
                                        .updateCustomerStatus(
                                          c.id,
                                          c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
                                        )
                                        .then(() => undefined),
                                    `${c.name} account updated`
                                  )
                                }
                                className={`min-h-[32px] px-3 rounded-lg font-bold border ${
                                  c.status === 'ACTIVE'
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    : 'bg-red-50 border-red-200 text-red-800'
                                }`}
                              >
                                {c.status}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* PRICING SETTINGS */}
              {section === 'PRICING' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runOwnerAction(
                      () =>
                        api
                          .updatePricing({
                            baseDeliveryFee: Number(baseDeliveryFee),
                            freeDeliveryThreshold: Number(freeDeliveryThreshold),
                            platformFee: Number(platformFee),
                            selfPickupFee: Number(selfPickupFee),
                            riderCommissionPercent: Number(riderCommissionPercent),
                          })
                          .then(() => undefined),
                      'Platform pricing settings saved'
                    );
                  }}
                  className="max-w-2xl rounded-3xl bg-white border border-zinc-200 p-6 space-y-4"
                >
                  <div>
                    <h2 className="font-display text-lg font-bold">
                      Delivery, Self-Pickup &amp; Rider Pricing
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Changes immediately reflect in Customer Cart &amp; Checkout calculations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Base Delivery Fee (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={baseDeliveryFee}
                        onChange={(e) => setBaseDeliveryFee(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Free Delivery Threshold (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={freeDeliveryThreshold}
                        onChange={(e) => setFreeDeliveryThreshold(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Platform Fee (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={platformFee}
                        onChange={(e) => setPlatformFee(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Self-Pickup Fee (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={selfPickupFee}
                        onChange={(e) => setSelfPickupFee(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Rider Commission (% of Base Delivery Fee, min ₹15 floor)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      required
                      value={riderCommissionPercent}
                      onChange={(e) => setRiderCommissionPercent(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    className="min-h-[48px] px-6 rounded-xl bg-[#0B0B0D] text-sm font-bold text-[#FFC700] hover:bg-zinc-900"
                  >
                    Save Pricing Settings
                  </button>
                </form>
              )}

              {/* MANUAL PAYOUT RECORDS */}
              {section === 'PAYOUTS' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      runOwnerAction(
                        () =>
                          api
                            .recordManualPayout({
                              riderId: payoutRiderId,
                              amount: Number(payoutAmount),
                              referenceNumber: payoutRef,
                              methodNote: payoutNote,
                            })
                            .then(() => {
                              setPayoutAmount('');
                              setPayoutRef('');
                            }),
                        'Manual payout recorded and added to audit log'
                      );
                    }}
                    className="lg:col-span-5 rounded-3xl bg-white border border-zinc-200 p-5 space-y-4 h-fit"
                  >
                    <div>
                      <h2 className="font-display text-lg font-bold">
                        Record Manual Rider Payout
                      </h2>
                      <p className="text-xs text-zinc-500 mt-1">
                        Payouts are never auto-approved or auto-disbursed. Enter manual settlement details after paying the rider offline.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Select Rider
                      </label>
                      <select
                        required
                        value={payoutRiderId}
                        onChange={(e) => setPayoutRiderId(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 bg-white px-3 text-xs"
                      >
                        <option value="">Choose rider...</option>
                        {data.riders.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} — Pending: {formatINR(r.pendingBalance)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Manual Payout Amount (₹)
                      </label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={payoutAmount}
                        onChange={(e) => setPayoutAmount(e.target.value)}
                        placeholder="e.g. 24"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Manual Settlement Reference #
                      </label>
                      <input
                        type="text"
                        required
                        value={payoutRef}
                        onChange={(e) => setPayoutRef(e.target.value)}
                        placeholder="BATCH-NOV-001"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Method / Verification Note
                      </label>
                      <input
                        type="text"
                        required
                        value={payoutNote}
                        onChange={(e) => setPayoutNote(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full min-h-[48px] rounded-xl bg-[#0B0B0D] text-sm font-bold text-[#FFC700]"
                    >
                      Record Manual Payout
                    </button>
                  </form>

                  <div className="lg:col-span-7 space-y-5">
                    <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
                      <h3 className="font-display text-base font-bold">Rider Balances</h3>
                      <div className="divide-y divide-zinc-100">
                        {data.riders.map((r) => (
                          <div key={r.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                            <div>
                              <div className="font-bold text-[#0B0B0D]">{r.name}</div>
                              <div className="text-zinc-500">
                                Payout Ref: <span className="font-mono">{r.documents?.dummyBankDetails?.dummyPayoutRef || r.documents?.dummyPayoutRef || 'Not set'}</span>
                                {' · '}
                                Dummy Acct: <span className="font-mono">{r.documents?.dummyBankDetails?.dummyAccountNumber || 'Not set'}</span>
                              </div>
                            </div>
                            <div className="text-right font-mono">
                              <div className="font-bold text-[#FF6B00]">
                                Pending: {formatINR(r.pendingBalance)}
                              </div>
                              <div className="text-zinc-500">
                                Earned: {formatINR(r.totalEarned)} · Paid: {formatINR(r.totalPaidManually)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
                      <h3 className="font-display text-base font-bold">
                        Recorded Manual Payout History ({data.payouts.length})
                      </h3>
                      {data.payouts.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-3">
                          No manual payouts recorded yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-zinc-100">
                          {data.payouts.map((p) => (
                            <div key={p.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                              <div>
                                <div className="font-bold text-[#0B0B0D]">
                                  {p.riderName} · Ref <span className="font-mono">{p.referenceNumber}</span>
                                </div>
                                <div className="text-zinc-500">
                                  {p.methodNote} · Recorded by {p.recordedBy} · {formatTime(p.recordedAt)}
                                </div>
                              </div>
                              <div className="font-mono text-sm font-bold text-emerald-700">
                                {formatINR(p.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* AUDIT LOGS */}
              {section === 'AUDIT' && (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-white border border-zinc-200 p-4 flex items-center gap-3">
                    <Activity className="h-4 w-4 text-[#FF6B00] shrink-0" />
                    <input
                      type="search"
                      value={auditQuery}
                      onChange={(e) => setAuditQuery(e.target.value)}
                      placeholder="Filter audit logs by action, actor email, order #, or target..."
                      className="w-full min-h-[40px] text-sm focus:outline-none"
                    />
                  </div>

                  <div className="rounded-3xl bg-white border border-zinc-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                          <tr>
                            <th className="py-3 px-4 font-semibold">Timestamp</th>
                            <th className="py-3 px-4 font-semibold">Actor</th>
                            <th className="py-3 px-4 font-semibold">Action</th>
                            <th className="py-3 px-4 font-semibold">Target</th>
                            <th className="py-3 px-4 font-semibold">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {filteredAuditLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-zinc-50/60">
                              <td className="py-3 px-4 font-mono text-[11px] text-zinc-500 whitespace-nowrap">
                                {formatTime(log.timestamp)}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className="font-semibold text-[#0B0B0D]">{log.actorRole}</span>
                                <div className="text-[11px] text-zinc-500">{log.actorEmail}</div>
                              </td>
                              <td className="py-3 px-4 font-mono font-semibold text-[#0B0B0D] whitespace-nowrap">
                                {log.action}
                              </td>
                              <td className="py-3 px-4 font-semibold text-zinc-800 whitespace-nowrap">
                                {log.target}
                              </td>
                              <td className="py-3 px-4 text-zinc-600">{log.details}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
