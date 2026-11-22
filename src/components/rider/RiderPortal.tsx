import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  ClipboardCheck,
  IndianRupee,
  Lock,
  LogOut,
  MapPin,
  Package,
  Power,
  RefreshCw,
  ShieldAlert,
  Store,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  Order,
  RiderApprovalStatus,
  RiderDocuments,
  RiderEarningsResponse,
  UserProfile,
} from '../../types/domain';
import { BrandMark, formatINR, formatTime } from '../BrandMark';
import { PWAInstallButton } from '../PWAInstallButton';

interface RiderPortalProps {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
  onLogout: () => void;
}

type RiderTab = 'JOBS' | 'EARNINGS' | 'PROFILE';

function looksLikeSensitiveNumericId(val: string) {
  const digitsOnly = val.trim().replace(/[\s-]/g, '');
  return /^\d{9,18}$/.test(digitsOnly);
}

function statusTone(status: RiderApprovalStatus | 'DISABLED' | undefined): string {
  if (status === 'APPROVED') return 'text-emerald-700';
  if (status === 'REJECTED') return 'text-red-700';
  if (status === 'DISABLED') return 'text-zinc-500';
  return 'text-amber-700';
}

export const RiderPortal: React.FC<RiderPortalProps> = ({
  user,
  onUserUpdated,
  onLogout,
}) => {
  const [tab, setTab] = useState<RiderTab>('JOBS');
  const [jobs, setJobs] = useState<Order[]>([]);
  const [earnings, setEarnings] = useState<RiderEarningsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Unified Rider 5-section verification form state (dummy testing only)
  const [cityArea, setCityArea] = useState(user.cityArea || 'Indiranagar, Bengaluru');
  const [dummyGovIdRef, setDummyGovIdRef] = useState(user.documents?.dummyGovIdRef || 'MOCK-ID-3690');
  const [dummyLicenseRef, setDummyLicenseRef] = useState(user.documents?.dummyLicenseRef || 'DUMMY-DL-1024');
  const [dummyVehiclePlate, setDummyVehiclePlate] = useState(user.documents?.dummyVehiclePlate || 'DEMO-KA01-0369');
  const [dummyVehicleType, setDummyVehicleType] = useState<RiderDocuments['dummyVehicleType']>(
    user.documents?.dummyVehicleType || 'Scooter'
  );
  const [selectedFoodDelivery, setSelectedFoodDelivery] = useState(
    user.serviceApprovals?.FOOD_DELIVERY?.requested ?? true
  );
  const [accountHolderName, setAccountHolderName] = useState(
    user.documents?.dummyBankDetails?.accountHolderName || `${user.name} (Test)`
  );
  const [dummyAccountNumber, setDummyAccountNumber] = useState(
    user.documents?.dummyBankDetails?.dummyAccountNumber || 'TEST-ACCT-0001'
  );
  const [dummyIfscCode, setDummyIfscCode] = useState(
    user.documents?.dummyBankDetails?.dummyIfscCode || 'MOCK0003690'
  );
  const [dummyPayoutRef, setDummyPayoutRef] = useState(
    user.documents?.dummyBankDetails?.dummyPayoutRef || user.documents?.dummyPayoutRef || 'DUMMY-PAY-009'
  );
  const [docsBusy, setDocsBusy] = useState(false);

  useEffect(() => {
    setCityArea(user.cityArea || 'Indiranagar, Bengaluru');
    if (user.documents) {
      setDummyGovIdRef(user.documents.dummyGovIdRef || 'MOCK-ID-3690');
      setDummyLicenseRef(user.documents.dummyLicenseRef || 'DUMMY-DL-1024');
      setDummyVehiclePlate(user.documents.dummyVehiclePlate || 'DEMO-KA01-0369');
      setDummyVehicleType(user.documents.dummyVehicleType || 'Scooter');
      setDummyPayoutRef(
        user.documents.dummyBankDetails?.dummyPayoutRef || user.documents.dummyPayoutRef || 'DUMMY-PAY-009'
      );
      if (user.documents.dummyBankDetails) {
        setAccountHolderName(user.documents.dummyBankDetails.accountHolderName);
        setDummyAccountNumber(user.documents.dummyBankDetails.dummyAccountNumber);
        setDummyIfscCode(user.documents.dummyBankDetails.dummyIfscCode);
      }
    }
    if (user.serviceApprovals?.FOOD_DELIVERY) {
      setSelectedFoodDelivery(user.serviceApprovals.FOOD_DELIVERY.requested);
    }
  }, [user]);

  const docStatus = user.documentStatus || user.approvalStatus || 'PENDING';
  const foodServiceStatus = user.serviceApprovals?.FOOD_DELIVERY?.status || user.approvalStatus || 'PENDING';
  const isEligibleOnline = docStatus === 'APPROVED' && foodServiceStatus === 'APPROVED';

  const loadRiderData = async () => {
    setLoading(true);
    try {
      const [profRes, jobsRes, earnRes] = await Promise.all([
        api.getRiderProfile(),
        api.getRiderJobs(),
        api.getRiderEarnings(),
      ]);
      onUserUpdated(profRes.user);
      setJobs(jobsRes.jobs);
      setEarnings(earnRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load rider workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRiderData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleOnline = async () => {
    setError(null);
    setFeedback(null);
    if (!isEligibleOnline) {
      setError(
        'You cannot go online until the Owner approves both your dummy documents and Food Delivery service.'
      );
      return;
    }
    setAvailabilityBusy(true);
    try {
      const res = await api.toggleRiderAvailability(!user.isOnline);
      onUserUpdated(res.user);
      setFeedback(res.user.isOnline ? 'You are now ONLINE for Owner dispatch.' : 'You are now OFFLINE.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update availability');
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const handleRespond = async (orderId: string, action: 'ACCEPT' | 'REJECT') => {
    setError(null);
    setFeedback(null);
    setActionBusyId(orderId);
    try {
      await api.respondToJob(orderId, action, action === 'REJECT' ? 'Rider declined assignment' : undefined);
      await loadRiderData();
      setFeedback(action === 'ACCEPT' ? 'Job accepted. Proceed to restaurant for pickup.' : 'Job declined and returned to Owner dispatch.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to respond to job');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleConfirmPickup = async (orderId: string) => {
    setError(null);
    setFeedback(null);
    setActionBusyId(orderId);
    try {
      await api.confirmPickup(orderId);
      await loadRiderData();
      setFeedback('Pickup confirmed. Deliver to customer and collect Cash on Delivery.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm pickup');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleCompleteDelivery = async (orderId: string) => {
    setError(null);
    setFeedback(null);
    setActionBusyId(orderId);
    try {
      await api.completeDelivery(orderId);
      await loadRiderData();
      setFeedback('Delivery completed! Rider fee queued for manual Owner payout review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete delivery');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSubmitDummyDocs = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (!selectedFoodDelivery) {
      setError('Food Delivery must be selected as your active service request.');
      return;
    }
    if (cityArea.trim().length < 2) {
      setError('Please enter your operating city / area.');
      return;
    }
    for (const [val, label] of [
      [dummyGovIdRef, 'Dummy Gov ID Reference'],
      [dummyLicenseRef, 'Driving Licence Number (Dummy)'],
      [dummyVehiclePlate, 'Vehicle Registration Number'],
      [dummyAccountNumber, 'Dummy Bank Account Number'],
      [dummyPayoutRef, 'Dummy Payout Reference'],
    ] as const) {
      if (val.trim().length < 4) {
        setError(`${label} must be at least 4 characters.`);
        return;
      }
      if (looksLikeSensitiveNumericId(val)) {
        setError(
          `${label} looks like a real Aadhaar or bank account number. Use dummy testing references like MOCK-ID-1042 or TEST-ACCT-001.`
        );
        return;
      }
    }
    const cleanIfsc = dummyIfscCode.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc) && !/^(MOCK|TEST|DEMO)[A-Z0-9-]{3,16}$/.test(cleanIfsc)) {
      setError('Dummy IFSC code must use a synthetic test format (e.g., MOCK0003690).');
      return;
    }
    if (accountHolderName.trim().length < 2) {
      setError('Dummy account holder name is required.');
      return;
    }

    setDocsBusy(true);
    try {
      const res = await api.submitRiderDocuments({
        cityArea: cityArea.trim(),
        dummyGovIdRef: dummyGovIdRef.trim(),
        dummyLicenseRef: dummyLicenseRef.trim(),
        dummyVehiclePlate: dummyVehiclePlate.trim().toUpperCase(),
        dummyVehicleType,
        dummyPayoutRef: dummyPayoutRef.trim(),
        dummyBankDetails: {
          accountHolderName: accountHolderName.trim(),
          dummyAccountNumber: dummyAccountNumber.trim().toUpperCase(),
          dummyIfscCode: cleanIfsc,
          dummyPayoutRef: dummyPayoutRef.trim(),
        },
        requestedServices: ['FOOD_DELIVERY'],
      });
      onUserUpdated(res.user);
      setFeedback('Updated dummy documents & bank structure submitted. Document status reset to Pending for Owner review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit documents');
    } finally {
      setDocsBusy(false);
    }
  };

  const activeJobs = jobs.filter((j) => j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
  const pastJobs = jobs.filter((j) => j.status === 'COMPLETED' || j.status === 'CANCELLED');

  return (
    <div className="min-h-screen bg-[#F6F6F7] text-[#0B0B0D] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0B0B0D] text-white border-b border-zinc-800 px-4 sm:px-8 h-14 flex items-center justify-between gap-4">
        <BrandMark inverted size="sm" />

        <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-zinc-400">
          {([
            ['JOBS', `Jobs (${activeJobs.length})`],
            ['EARNINGS', 'Earnings'],
            ['PROFILE', 'Docs & Profile'],
          ] as [RiderTab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap py-1 border-b-2 transition-colors ${
                tab === key
                  ? 'border-[#FFC700] text-[#FFC700]'
                  : 'border-transparent hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={loadRiderData}
            aria-label="Refresh rider data"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-5 pb-24 lg:pb-10 space-y-5">
        {/* Approval & Online Status Card */}
        <section className="rounded-3xl bg-[#0B0B0D] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-400">Unified Rider</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-bold ${
                  docStatus === 'APPROVED'
                    ? 'text-[#FFC700]'
                    : docStatus === 'REJECTED'
                      ? 'text-red-400'
                      : 'text-amber-300'
                }`}
              >
                Docs: {docStatus}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-bold ${
                  foodServiceStatus === 'APPROVED'
                    ? 'text-[#FFC700]'
                    : foodServiceStatus === 'REJECTED'
                      ? 'text-red-400'
                      : 'text-amber-300'
                }`}
              >
                Food Delivery: {foodServiceStatus}
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold">{user.name}</h1>
            <p className="text-xs text-zinc-400">
              {isEligibleOnline
                ? user.isOnline
                  ? `Online in ${user.cityArea || 'Bengaluru'} · Visible to Owner dispatch for Food Delivery assignments.`
                  : `Offline in ${user.cityArea || 'Bengaluru'} · Toggle online when ready to accept assigned deliveries.`
                : user.approvalNotes || 'Both dummy documents and Food Delivery service require Owner approval before going online.'}
            </p>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              disabled={availabilityBusy || !isEligibleOnline}
              onClick={handleToggleOnline}
              className={`min-h-[48px] px-5 rounded-2xl font-bold text-sm inline-flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                user.isOnline
                  ? 'bg-[#FFC700] text-[#0B0B0D] hover:bg-[#FFD335]'
                  : 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
              }`}
            >
              <Power className="h-4 w-4" />
              {!isEligibleOnline
                ? 'Approval Required'
                : user.isOnline
                  ? 'Online · Tap to Go Offline'
                  : 'Offline · Go Online'}
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-semibold text-red-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {feedback && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-semibold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* JOBS TAB */}
        {tab === 'JOBS' && (
          <div className="space-y-6">
            {!isEligibleOnline && (
              <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 flex items-start gap-3 text-xs text-amber-950">
                <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">
                    Account Awaiting Owner Approval (Docs: {docStatus} · Food Delivery: {foodServiceStatus})
                  </div>
                  <p className="mt-0.5 text-amber-900">
                    Review your vehicle, dummy bank details, and service approvals in the <strong>Docs &amp; Profile</strong> tab. Only riders with Owner-approved documents and Food Delivery service can go online.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold">
                  Assigned Active Jobs ({activeJobs.length})
                </h2>
                <span className="text-xs text-zinc-500">
                  Milestone workflow · No simulated GPS
                </span>
              </div>

              {activeJobs.length === 0 ? (
                <div className="rounded-3xl bg-white border border-zinc-200 p-10 text-center space-y-2">
                  <Package className="h-8 w-8 text-zinc-300 mx-auto" />
                  <div className="text-sm font-semibold text-zinc-700">
                    No active delivery jobs assigned right now
                  </div>
                  <p className="text-xs text-zinc-500">
                    When the Owner assigns a Food Delivery order to you, it will appear here for Accept / Reject.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeJobs.map((job) => (
                    <div
                      key={job.id}
                      className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-zinc-100">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <span className="font-mono font-bold text-[#0B0B0D]">
                              {job.orderNumber}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Order Status: {job.status.replace(/_/g, ' ')}</span>
                          </div>
                          <h3 className="font-display text-lg font-bold text-[#0B0B0D] mt-1">
                            {job.restaurantName}
                          </h3>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">Rider Fee</div>
                          <div className="font-mono text-lg font-extrabold text-[#0B0B0D]">
                            {formatINR(job.riderFee)}
                          </div>
                          <div className="text-[11px] font-semibold text-[#FF6B00]">
                            Collect COD: {formatINR(job.totalAmount)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="rounded-2xl bg-zinc-50 border border-zinc-200/80 p-3.5 space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-[#0B0B0D]">
                            <Store className="h-4 w-4 text-[#FF6B00]" />
                            Pickup Kitchen
                          </div>
                          <div className="text-zinc-700">{job.restaurantName}</div>
                          <div className="text-zinc-500">{job.restaurantAddress}</div>
                        </div>

                        <div className="rounded-2xl bg-zinc-50 border border-zinc-200/80 p-3.5 space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-[#0B0B0D]">
                            <MapPin className="h-4 w-4 text-emerald-700" />
                            Drop Customer
                          </div>
                          <div className="text-zinc-700">
                            {job.customerName} ({job.customerPhone})
                          </div>
                          <div className="text-zinc-500">{job.deliveryAddress}</div>
                        </div>
                      </div>

                      {/* Job Action Controls */}
                      <div className="pt-2 flex flex-wrap gap-2.5">
                        {job.riderJobStatus === 'ASSIGNED' && (
                          <>
                            <button
                              type="button"
                              disabled={actionBusyId === job.id}
                              onClick={() => handleRespond(job.id, 'ACCEPT')}
                              className="flex-1 min-h-[48px] rounded-xl bg-[#FFC700] px-4 text-sm font-bold text-[#0B0B0D] hover:bg-[#FFD335] inline-flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Accept Job
                            </button>
                            <button
                              type="button"
                              disabled={actionBusyId === job.id}
                              onClick={() => handleRespond(job.id, 'REJECT')}
                              className="min-h-[48px] rounded-xl border border-zinc-300 bg-white px-5 text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              <XCircle className="h-4 w-4" />
                              Reject
                            </button>
                          </>
                        )}

                        {job.riderJobStatus === 'ACCEPTED' && job.status !== 'PICKED_UP' && (
                          <button
                            type="button"
                            disabled={actionBusyId === job.id}
                            onClick={() => handleConfirmPickup(job.id)}
                            className="w-full min-h-[48px] rounded-xl bg-[#0B0B0D] px-5 text-sm font-bold text-[#FFC700] hover:bg-zinc-900 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <ClipboardCheck className="h-4 w-4" />
                            Confirm Pickup from Restaurant
                          </button>
                        )}

                        {job.status === 'PICKED_UP' && (
                          <button
                            type="button"
                            disabled={actionBusyId === job.id}
                            onClick={() => handleCompleteDelivery(job.id)}
                            className="w-full min-h-[48px] rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white hover:bg-emerald-800 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Complete Delivery &amp; Confirm COD ({formatINR(job.totalAmount)})
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pastJobs.length > 0 && (
              <div className="space-y-3">
                <h2 className="font-display text-base font-bold text-zinc-700">
                  Completed Deliveries ({pastJobs.length})
                </h2>
                <div className="rounded-2xl bg-white border border-zinc-200 divide-y divide-zinc-100">
                  {pastJobs.map((job) => (
                    <div key={job.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-[#0B0B0D]">
                          <span className="font-mono">{job.orderNumber}</span> · {job.restaurantName}
                        </div>
                        <div className="text-zinc-500 mt-0.5">{formatTime(job.updatedAt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-[#0B0B0D]">
                          +{formatINR(job.riderFee)}
                        </div>
                        <div className="text-zinc-500">{job.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EARNINGS TAB */}
        {tab === 'EARNINGS' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white border border-zinc-200 p-4">
                <div className="text-xs text-zinc-500">Total Earned</div>
                <div className="font-mono text-2xl font-extrabold text-[#0B0B0D] mt-1">
                  {formatINR(earnings?.summary.totalEarned ?? 0)}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {earnings?.summary.completedDeliveries ?? 0} completed deliveries
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-zinc-200 p-4">
                <div className="text-xs text-zinc-500">Pending Manual Payout</div>
                <div className="font-mono text-2xl font-extrabold text-[#FF6B00] mt-1">
                  {formatINR(earnings?.summary.pendingManualPayout ?? 0)}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Settled manually by Owner only
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-zinc-200 p-4">
                <div className="text-xs text-zinc-500">Paid Manually</div>
                <div className="font-mono text-2xl font-extrabold text-emerald-700 mt-1">
                  {formatINR(earnings?.summary.totalPaidManually ?? 0)}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Recorded in Owner payout ledger
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
              <h2 className="font-display text-lg font-bold">Per-Delivery Earnings Ledger</h2>
              {!earnings || earnings.ledger.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4">
                  Complete delivery jobs to accrue rider earnings. Payouts are never auto-approved.
                </p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {earnings.ledger.map((item) => (
                    <div key={item.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-[#0B0B0D]">
                          <span className="font-mono">{item.orderNumber}</span> · {item.restaurantName}
                        </div>
                        <div className="text-zinc-500 mt-0.5">{formatTime(item.completedAt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-bold text-[#0B0B0D]">
                          {formatINR(item.amount)}
                        </div>
                        <div
                          className={`text-[11px] font-semibold ${
                            item.payoutStatus === 'SETTLED_MANUALLY'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {item.payoutStatus === 'SETTLED_MANUALLY'
                            ? 'Settled Manually'
                            : 'Pending Manual Review'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white border border-zinc-200 p-5 space-y-3">
              <h2 className="font-display text-lg font-bold">Manual Payout Records</h2>
              {!earnings || earnings.payoutRecords.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4">
                  No manual payout records issued by the Owner yet.
                </p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {earnings.payoutRecords.map((rec) => (
                    <div key={rec.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-[#0B0B0D]">
                          Ref: <span className="font-mono">{rec.referenceNumber}</span>
                        </div>
                        <div className="text-zinc-500 mt-0.5">
                          {rec.methodNote} · {formatTime(rec.recordedAt)}
                        </div>
                      </div>
                      <div className="font-mono text-sm font-bold text-emerald-700">
                        {formatINR(rec.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PROFILE & DUMMY DOCUMENTS TAB */}
        {tab === 'PROFILE' && (
          <div className="max-w-2xl mx-auto space-y-5">
            {/* Document & Separate Service Approval Summary */}
            <div className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-100">
                <div>
                  <h2 className="font-display text-xl font-bold">
                    Unified Rider Profile &amp; Onboarding
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {user.email} · {user.phone}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>

              {/* 4. Document Submission Status & Per-Service Matrix */}
              <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[#0B0B0D]">Document Submission Status</span>
                  <span className={`font-mono font-bold ${statusTone(docStatus)}`}>
                    {docStatus}
                  </span>
                </div>
                <p
                  className={`text-[11px] ${
                    docStatus === 'REJECTED' ? 'font-semibold text-red-700' : 'text-zinc-600'
                  }`}
                >
                  {docStatus === 'REJECTED' ? 'Rejection Reason: ' : ''}
                  {user.documentNotes ||
                    user.approvalNotes ||
                    'Documents are reviewed manually by the Owner. Re-submitting resets Document Status to Pending.'}
                </p>

                <div className="pt-2 border-t border-zinc-200/80 space-y-2">
                  <div className="font-bold text-[#0B0B0D]">
                    Per-Service Owner Approval Status
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-[#0B0B0D]">Food Delivery</div>
                        <span className={`font-mono font-bold ${statusTone(foodServiceStatus)}`}>
                          {foodServiceStatus}
                        </span>
                      </div>
                      <div
                        className={`text-[11px] ${
                          foodServiceStatus === 'REJECTED'
                            ? 'font-semibold text-red-700'
                            : 'text-zinc-500'
                        }`}
                      >
                        {foodServiceStatus === 'REJECTED' ? 'Reason: ' : ''}
                        {user.serviceApprovals?.FOOD_DELIVERY?.notes || 'Active service'}
                      </div>
                    </div>

                    {[
                      { key: 'GROCERY', name: 'Grocery Delivery' },
                      { key: 'PARCEL', name: 'Parcel Delivery' },
                      { key: 'BIKE_TAXI', name: 'Bike Taxi' },
                    ].map((svc) => (
                      <div
                        key={svc.key}
                        className="rounded-xl bg-zinc-100 border border-dashed border-zinc-300 px-3 py-2 flex items-center justify-between text-zinc-500"
                      >
                        <div>
                          <div className="font-semibold">{svc.name}</div>
                          <div className="text-[11px]">Disabled until implemented</div>
                        </div>
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold">
                          <Lock className="h-3 w-3" />
                          DISABLED
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-amber-50 border border-amber-300 p-3.5 text-xs text-amber-950">
                <strong>Important Privacy Rule:</strong> Do NOT enter real Aadhaar, PAN, Driving Licence, or bank account numbers. Numeric 9–18 digit identifiers are blocked. Use synthetic dummy data only (e.g., <span className="font-mono">MOCK-ID-1042</span>, <span className="font-mono">TEST-ACCT-001</span>).
              </div>

              <form onSubmit={handleSubmitDummyDocs} className="space-y-5">
                {/* 1. Personal Information */}
                <div className="space-y-2.5">
                  <div className="text-xs font-bold text-[#0B0B0D]">1. Personal Information</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-3 py-2.5">
                      <div className="text-zinc-500">Full Name</div>
                      <div className="font-semibold text-[#0B0B0D] mt-0.5">{user.name}</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-3 py-2.5">
                      <div className="text-zinc-500">Phone &amp; Email</div>
                      <div className="font-semibold text-[#0B0B0D] mt-0.5 truncate">
                        {user.phone} · {user.email}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Operating City / Area
                    </label>
                    <input
                      type="text"
                      required
                      value={cityArea}
                      onChange={(e) => setCityArea(e.target.value)}
                      placeholder="Indiranagar, Bengaluru"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm"
                    />
                  </div>
                </div>

                {/* 2. Vehicle Information */}
                <div className="space-y-3 pt-3 border-t border-zinc-100">
                  <div className="text-xs font-bold text-[#0B0B0D]">
                    2. Vehicle Information (Dummy Testing Only)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Vehicle Type
                      </label>
                      <select
                        value={dummyVehicleType}
                        onChange={(e) =>
                          setDummyVehicleType(e.target.value as RiderDocuments['dummyVehicleType'])
                        }
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm bg-white"
                      >
                        <option value="Scooter">Scooter</option>
                        <option value="Motorcycle">Motorcycle</option>
                        <option value="E-Bike">E-Bike</option>
                        <option value="Bicycle">Bicycle</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Vehicle Registration Number
                      </label>
                      <input
                        type="text"
                        required
                        value={dummyVehiclePlate}
                        onChange={(e) => setDummyVehiclePlate(e.target.value)}
                        placeholder="DEMO-KA01-3690"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Driving Licence Number (Dummy)
                      </label>
                      <input
                        type="text"
                        required
                        value={dummyLicenseRef}
                        onChange={(e) => setDummyLicenseRef(e.target.value)}
                        placeholder="DUMMY-DL-9012"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Dummy Gov ID Reference
                      </label>
                      <input
                        type="text"
                        required
                        value={dummyGovIdRef}
                        onChange={(e) => setDummyGovIdRef(e.target.value)}
                        placeholder="MOCK-ID-1042"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Service Selection */}
                <div className="space-y-2.5 pt-3 border-t border-zinc-100">
                  <div className="text-xs font-bold text-[#0B0B0D]">
                    3. Service Selection
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedFoodDelivery((v) => !v)}
                      className={`min-h-[48px] rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                        selectedFoodDelivery
                          ? 'bg-[#FFC700]/25 border-[#0B0B0D] text-[#0B0B0D]'
                          : 'bg-white border-zinc-300 text-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span>Food Delivery</span>
                        <span>{selectedFoodDelivery ? 'Selected' : 'Select'}</span>
                      </div>
                      <div className="text-[11px] text-zinc-600 mt-0.5">
                        Owner status: {foodServiceStatus}
                      </div>
                    </button>

                    {[
                      { id: 'GROCERY', name: 'Grocery Delivery' },
                      { id: 'PARCEL', name: 'Parcel Delivery' },
                      { id: 'BIKE_TAXI', name: 'Bike Taxi' },
                    ].map((svc) => (
                      <div
                        key={svc.id}
                        aria-disabled="true"
                        className="min-h-[48px] rounded-xl border border-dashed border-zinc-300 bg-zinc-100 px-3 py-2 text-xs text-zinc-400 cursor-not-allowed"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>{svc.name}</span>
                          <Lock className="h-3.5 w-3.5" />
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          Disabled until implemented
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. Bank Details Structure (Dummy Testing Data Only) */}
                <div className="space-y-3 pt-3 border-t border-zinc-100">
                  <div className="text-xs font-bold text-[#0B0B0D]">
                    5. Bank Details Structure (Dummy Testing Data Only)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Dummy Account Holder Name
                      </label>
                      <input
                        type="text"
                        required
                        value={accountHolderName}
                        onChange={(e) => setAccountHolderName(e.target.value)}
                        placeholder="Vikram Rao (Test)"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Dummy Account Number
                      </label>
                      <input
                        type="text"
                        required
                        value={dummyAccountNumber}
                        onChange={(e) => setDummyAccountNumber(e.target.value)}
                        placeholder="TEST-ACCT-0001"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono uppercase"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Dummy IFSC / Routing Code
                      </label>
                      <input
                        type="text"
                        required
                        value={dummyIfscCode}
                        onChange={(e) => setDummyIfscCode(e.target.value)}
                        placeholder="MOCK0003690"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Dummy Payout Reference
                      </label>
                      <input
                        type="text"
                        required
                        value={dummyPayoutRef}
                        onChange={(e) => setDummyPayoutRef(e.target.value)}
                        placeholder="DUMMY-PAY-001"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={docsBusy}
                  className="w-full min-h-[48px] rounded-xl bg-[#0B0B0D] text-sm font-bold text-[#FFC700] hover:bg-zinc-900 disabled:opacity-50"
                >
                  {docsBusy ? 'Submitting...' : 'Save & Submit Dummy References (Resets Docs to Pending)'}
                </button>
              </form>
            </div>

            <PWAInstallButton variant="card" />
          </div>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav
        aria-label="Rider mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-zinc-200 pb-safe"
      >
        <div className="grid grid-cols-3 h-16 items-center">
          {([
            ['JOBS', `Jobs (${activeJobs.length})`, Bike],
            ['EARNINGS', 'Earnings', IndianRupee],
            ['PROFILE', 'Docs & Profile', UserCheck],
          ] as const).map(([key, label, Icon]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-[#FF6B00]' : 'text-zinc-500'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-semibold tracking-tight">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
