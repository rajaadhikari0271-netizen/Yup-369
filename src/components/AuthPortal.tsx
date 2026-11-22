import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bike, Lock, ShieldCheck, ShoppingBag, User } from 'lucide-react';
import { api, setAuthToken } from '../services/api';
import type {
  AuthResponse,
  RiderDocuments,
  RiderServiceKey,
  ServiceDefinition,
} from '../types/domain';
import { BrandMark } from '../components/BrandMark';
import { PWAInstallButton } from '../components/PWAInstallButton';

interface AuthPortalProps {
  services: ServiceDefinition[];
  onAuthenticated: (auth: AuthResponse) => void;
}

type AuthScreenMode = 'PUBLIC_LOGIN' | 'PUBLIC_REGISTER' | 'OWNER_PRIVATE';

export const AuthPortal: React.FC<AuthPortalProps> = ({ services, onAuthenticated }) => {
  const [mode, setMode] = useState<AuthScreenMode>('PUBLIC_LOGIN');
  const [registerRole, setRegisterRole] = useState<'CUSTOMER' | 'RIDER'>('CUSTOMER');

  // Public login / register state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [savedAddress, setSavedAddress] = useState('');

  // Unified Rider registration state (5 structured sections)
  const [cityArea, setCityArea] = useState('Indiranagar, Bengaluru');
  const [dummyVehicleType, setDummyVehicleType] =
    useState<RiderDocuments['dummyVehicleType']>('Scooter');
  const [dummyVehiclePlate, setDummyVehiclePlate] = useState('');
  const [dummyLicenseRef, setDummyLicenseRef] = useState('');
  const [dummyGovIdRef, setDummyGovIdRef] = useState('');
  const [selectedFoodDelivery, setSelectedFoodDelivery] = useState(true);
  const [bankHolderName, setBankHolderName] = useState('');
  const [dummyAccountNumber, setDummyAccountNumber] = useState('');
  const [dummyIfscCode, setDummyIfscCode] = useState('MOCK0003690');
  const [dummyPayoutRef, setDummyPayoutRef] = useState('');

  // Private Owner state
  const [ownerMode, setOwnerMode] = useState<'loading' | 'claim_required' | 'login_ready'>('loading');
  const [ownerName, setOwnerName] = useState('Platform Owner');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPasscode, setOwnerPasscode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'OWNER_PRIVATE') return;
    let active = true;
    setOwnerMode('loading');
    setError(null);
    api
      .getOwnerStatus()
      .then((res) => {
        if (!active) return;
        setOwnerMode(res.configured ? 'login_ready' : 'claim_required');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to check Owner portal status');
        setOwnerMode('login_ready');
      });
    return () => {
      active = false;
    };
  }, [mode]);

  const handlePublicLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const auth = await api.login({ email, password });
      setAuthToken(auth.token);
      onAuthenticated(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const looksLikeSensitiveNumericId = (val: string) => {
    const digitsOnly = val.trim().replace(/[\s-]/g, '');
    return /^\d{9,18}$/.test(digitsOnly);
  };

  const handlePublicRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (registerRole === 'RIDER') {
      if (!selectedFoodDelivery) {
        setError('Please select Food Delivery (the active service) to register your unified rider account.');
        return;
      }
      if (cityArea.trim().length < 2) {
        setError('Please enter your operating city or area.');
        return;
      }
      for (const [val, label] of [
        [dummyVehiclePlate, 'Vehicle registration number'],
        [dummyLicenseRef, 'Dummy driving licence number'],
        [dummyGovIdRef, 'Dummy ID reference'],
        [dummyAccountNumber, 'Dummy bank account number'],
        [dummyPayoutRef, 'Dummy payout reference'],
      ] as const) {
        if (val.trim().length < 4) {
          setError(`${label} must be at least 4 characters.`);
          return;
        }
        if (looksLikeSensitiveNumericId(val)) {
          setError(
            `${label} looks like a real Aadhaar or bank account number. Use dummy testing formats such as MOCK-ID-1042 or TEST-ACCT-001.`
          );
          return;
        }
      }
      const cleanIfsc = dummyIfscCode.trim().toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc) && !/^(MOCK|TEST|DEMO)[A-Z0-9-]{3,16}$/.test(cleanIfsc)) {
        setError('Dummy IFSC code must use a synthetic test format (e.g., MOCK0003690).');
        return;
      }
    }

    setLoading(true);
    try {
      const auth = await api.register({
        role: registerRole,
        name,
        email,
        phone,
        password,
        savedAddress: registerRole === 'CUSTOMER' ? savedAddress : undefined,
        cityArea: registerRole === 'RIDER' ? cityArea : undefined,
        riderOnboarding:
          registerRole === 'RIDER'
            ? {
                dummyGovIdRef: dummyGovIdRef.trim(),
                dummyLicenseRef: dummyLicenseRef.trim(),
                dummyVehiclePlate: dummyVehiclePlate.trim().toUpperCase(),
                dummyVehicleType,
                requestedServices: ['FOOD_DELIVERY'] as RiderServiceKey[],
                dummyBankDetails: {
                  accountHolderName: (bankHolderName.trim() || `${name.trim()} (Test)`),
                  dummyAccountNumber: dummyAccountNumber.trim().toUpperCase(),
                  dummyIfscCode: dummyIfscCode.trim().toUpperCase(),
                  dummyPayoutRef: dummyPayoutRef.trim(),
                },
              }
            : undefined,
      });
      setAuthToken(auth.token);
      onAuthenticated(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string, demoPassword: string) => {
    setError(null);
    setLoading(true);
    try {
      const auth = await api.login({ email: demoEmail, password: demoPassword });
      setAuthToken(auth.token);
      onAuthenticated(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const auth =
        ownerMode === 'claim_required'
          ? await api.ownerBootstrap({
              name: ownerName,
              email: ownerEmail,
              passcode: ownerPasscode,
            })
          : await api.ownerLogin({
              email: ownerEmail,
              passcode: ownerPasscode,
            });
      setAuthToken(auth.token);
      onAuthenticated(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Owner authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F6F7] text-[#0B0B0D] flex flex-col">
      {/* Compact Header */}
      <header className="w-full bg-white border-b border-zinc-200 px-4 sm:px-8 h-14 flex items-center justify-between">
        <BrandMark />
        <div className="flex items-center gap-3">
          <PWAInstallButton />
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 lg:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Brand Showcase */}
        <section className="lg:col-span-6 rounded-3xl bg-[#0B0B0D] text-white overflow-hidden flex flex-col justify-between">
          <div className="relative h-48 sm:h-64 lg:h-72 w-full bg-zinc-900">
            <img
              src="/src/assets/images/hero_food_delivery_1795240191520.jpg"
              alt="Fresh local meals prepared for delivery and self-pickup on Yup! 369"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0D] via-[#0B0B0D]/40 to-transparent" />
            <div className="absolute bottom-4 left-5 right-5">
              <p className="text-xs font-medium text-[#FFC700]">
                Food Delivery · Self-Pickup
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white mt-1 text-balance">
                Fast local food delivery &amp; counter pickup.
              </h1>
            </div>
          </div>

          <div className="p-5 sm:p-7 space-y-5">
            <p className="text-sm text-zinc-300 leading-relaxed">
              Yup! 369 connects neighbourhood kitchens, verified delivery riders, and direct counter pickup in one installable mobile-first web app.
            </p>

            {/* Transparent Service Matrix */}
            <div className="border-t border-zinc-800 pt-4">
              <div className="text-xs font-semibold text-zinc-400 mb-3">
                Current Platform Services
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {services.map((svc) => (
                  <div
                    key={svc.id}
                    className={`rounded-xl px-3.5 py-2.5 border text-xs ${
                      svc.enabled
                        ? 'bg-zinc-900 border-zinc-700 text-white'
                        : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>{svc.name}</span>
                      <span
                        className={
                          svc.enabled ? 'text-[#FFC700]' : 'text-zinc-500'
                        }
                      >
                        {svc.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400 truncate">
                      {svc.enabled ? svc.tagline : 'Pending implementation'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Right Auth Panel */}
        <section className="lg:col-span-6 bg-white rounded-3xl border border-zinc-200 p-5 sm:p-8 flex flex-col justify-between shadow-sm">
          {mode !== 'OWNER_PRIVATE' ? (
            <div>
              {/* Segmented Sign In / Register Tabs */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setMode('PUBLIC_LOGIN');
                    setError(null);
                  }}
                  className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                    mode === 'PUBLIC_LOGIN'
                      ? 'bg-[#0B0B0D] text-white shadow-sm'
                      : 'text-zinc-600 hover:text-[#0B0B0D]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('PUBLIC_REGISTER');
                    setError(null);
                  }}
                  className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                    mode === 'PUBLIC_REGISTER'
                      ? 'bg-[#0B0B0D] text-white shadow-sm'
                      : 'text-zinc-600 hover:text-[#0B0B0D]'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-800"
                >
                  {error}
                </div>
              )}

              {mode === 'PUBLIC_LOGIN' ? (
                <form onSubmit={handlePublicLogin} className="mt-6 space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-bold text-[#0B0B0D]">
                      Sign in as Customer or Rider
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">
                      Use your registered credentials or try a demo Customer/Rider account below.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 bg-white px-3.5 text-sm text-[#0B0B0D] focus:outline-none focus:ring-2 focus:ring-[#FFC700] focus:border-[#0B0B0D]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 bg-white px-3.5 text-sm text-[#0B0B0D] focus:outline-none focus:ring-2 focus:ring-[#FFC700] focus:border-[#0B0B0D]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[48px] rounded-xl bg-[#FFC700] text-[#0B0B0D] font-bold text-sm hover:bg-[#FFD335] active:scale-[0.99] transition-all disabled:opacity-50"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>

                  {/* Quick Demo Customer & Rider Registration Shortcut */}
                  <div className="pt-4 border-t border-zinc-100">
                    <div className="text-xs font-semibold text-zinc-500 mb-2.5">
                      Quick Access
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleDemoLogin('arjun@customer.demo', 'Customer@369')}
                        className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-zinc-100 transition-colors"
                      >
                        <ShoppingBag className="h-3.5 w-3.5 text-[#FF6B00]" />
                        Demo Customer
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setMode('PUBLIC_REGISTER');
                          setRegisterRole('RIDER');
                          setError(null);
                        }}
                        className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-zinc-100 transition-colors"
                      >
                        <Bike className="h-3.5 w-3.5 text-[#0B0B0D]" />
                        Register New Rider
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <form onSubmit={handlePublicRegister} className="mt-6 space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-bold text-[#0B0B0D]">
                      Create a Customer or Rider account
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">
                      New Rider accounts require manual Owner approval before going online.
                    </p>
                  </div>

                  {/* Role selector: ONLY Customer or Rider */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRegisterRole('CUSTOMER')}
                      className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-colors ${
                        registerRole === 'CUSTOMER'
                          ? 'bg-[#FFC700] border-[#0B0B0D] text-[#0B0B0D]'
                          : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      <User className="h-4 w-4" />
                      Customer
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegisterRole('RIDER')}
                      className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-colors ${
                        registerRole === 'RIDER'
                          ? 'bg-[#FFC700] border-[#0B0B0D] text-[#0B0B0D]'
                          : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      <Bike className="h-4 w-4" />
                      Delivery Rider
                    </button>
                  </div>

                  <div className="space-y-3 pt-1">
                    {registerRole === 'RIDER' && (
                      <div className="text-xs font-bold text-[#0B0B0D]">
                        1. Personal Information
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">
                          Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Priya Sharma"
                          className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+91 98765 43210"
                          className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">
                          Email Address
                        </label>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="priya@example.com"
                          className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                        />
                      </div>

                      {registerRole === 'RIDER' ? (
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
                            className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-semibold text-zinc-700 mb-1">
                            Default Delivery Address (Optional)
                          </label>
                          <input
                            type="text"
                            value={savedAddress}
                            onChange={(e) => setSavedAddress(e.target.value)}
                            placeholder="Apartment, Street, Landmark"
                            className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                          />
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Password (min 6 characters)
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a secure password"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                      />
                    </div>
                  </div>

                  {registerRole === 'RIDER' && (
                    <div className="space-y-4 pt-3 border-t border-zinc-200">
                      {/* 2. Vehicle Information */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[#0B0B0D]">
                            2. Vehicle Information (Dummy Testing Only)
                          </span>
                          <span className="text-[11px] text-zinc-500">One unified account</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">
                              Vehicle Type
                            </label>
                            <select
                              value={dummyVehicleType}
                              onChange={(e) =>
                                setDummyVehicleType(
                                  e.target.value as RiderDocuments['dummyVehicleType']
                                )
                              }
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
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
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
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
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">
                              Dummy Gov ID Reference (No Aadhaar)
                            </label>
                            <input
                              type="text"
                              required
                              value={dummyGovIdRef}
                              onChange={(e) => setDummyGovIdRef(e.target.value)}
                              placeholder="MOCK-ID-1042"
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                            />
                          </div>
                        </div>
                      </div>

                      {/* 3. Service Selection */}
                      <div className="space-y-2.5 pt-3 border-t border-zinc-100">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[#0B0B0D]">
                            3. Service Selection
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            Separate Owner approval per service
                          </span>
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
                              <span>{selectedFoodDelivery ? 'Selected' : 'Tap to select'}</span>
                            </div>
                            <div className="text-[11px] text-zinc-600 mt-0.5">
                              Active · Requires Owner approval
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

                      {/* 4. Document Submission Status */}
                      <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-3 text-xs space-y-1">
                        <div className="font-bold text-[#0B0B0D]">
                          4. Document Submission Status: Pending
                        </div>
                        <p className="text-[11px] text-zinc-600">
                          Unified rider accounts always start as <strong>Pending</strong>. Owner separately reviews your documents (Pending / Approved / Rejected) and each service before you can go online.
                        </p>
                      </div>

                      {/* 5. Bank Details Structure (Dummy Testing Data Only) */}
                      <div className="space-y-3 pt-3 border-t border-zinc-100">
                        <div className="text-xs font-bold text-[#0B0B0D]">
                          5. Bank Details Structure (Dummy Testing Data Only)
                        </div>
                        <div className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-[11px] text-amber-950">
                          <strong>No real bank or Aadhaar info:</strong> Numeric 9–18 digit account or 12-digit Aadhaar strings are blocked. Use synthetic values like <span className="font-mono">TEST-ACCT-001</span>.
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">
                              Dummy Account Holder Name
                            </label>
                            <input
                              type="text"
                              required
                              value={bankHolderName}
                              onChange={(e) => setBankHolderName(e.target.value)}
                              placeholder="Priya Sharma (Test)"
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
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
                              placeholder="TEST-ACCT-0042"
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
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
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
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
                              placeholder="DUMMY-PAY-042"
                              className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[48px] rounded-xl bg-[#0B0B0D] text-white font-bold text-sm hover:bg-zinc-800 active:scale-[0.99] transition-all disabled:opacity-50"
                  >
                    {loading
                      ? 'Creating account...'
                      : registerRole === 'RIDER'
                        ? 'Submit Rider Application (Pending Owner Review)'
                        : 'Create Customer Account'}
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* Private Owner / Super Admin Login or First-Run Setup */
            <div>
              <button
                type="button"
                onClick={() => {
                  setMode('PUBLIC_LOGIN');
                  setError(null);
                }}
                className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-[#0B0B0D]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Customer / Rider Sign In
              </button>

              <div className="mt-4 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0B0B0D] text-[#FFC700]">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="font-display text-xl font-bold text-[#0B0B0D]">
                    {ownerMode === 'claim_required'
                      ? 'First-Run Owner Setup'
                      : 'Private Owner Login'}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {ownerMode === 'claim_required'
                      ? 'Claim the sole Owner / Super Admin credentials once. Public Owner signup is disabled.'
                      : 'Restricted administrative console. Credentials verified server-side.'}
                  </p>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-800"
                >
                  {error}
                </div>
              )}

              {ownerMode === 'loading' ? (
                <div className="py-12 text-center text-sm text-zinc-500">
                  Verifying Owner portal configuration...
                </div>
              ) : (
                <form onSubmit={handleOwnerSubmit} className="mt-6 space-y-4">
                  {ownerMode === 'claim_required' && (
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                        Owner Display Name
                      </label>
                      <input
                        type="text"
                        required
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Owner Email
                    </label>
                    <input
                      type="email"
                      required
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder="owner@company.com"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Private Passcode {ownerMode === 'claim_required' ? '(min 8 chars)' : ''}
                    </label>
                    <input
                      type="password"
                      required
                      minLength={ownerMode === 'claim_required' ? 8 : 4}
                      value={ownerPasscode}
                      onChange={(e) => setOwnerPasscode(e.target.value)}
                      placeholder="Enter private Owner passcode"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[48px] rounded-xl bg-[#0B0B0D] text-[#FFC700] font-bold text-sm hover:bg-zinc-900 active:scale-[0.99] transition-all disabled:opacity-50"
                  >
                    {loading
                      ? 'Authenticating...'
                      : ownerMode === 'claim_required'
                        ? 'Claim & Lock Owner Account'
                        : 'Access Owner Console'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Discreet Footer Link for Private Owner Login */}
          <div className="mt-6 pt-4 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs text-zinc-500">
            <span>Public signup restricted to Customers &amp; Riders</span>
            {mode !== 'OWNER_PRIVATE' && (
              <button
                type="button"
                onClick={() => {
                  setMode('OWNER_PRIVATE');
                  setError(null);
                }}
                className="inline-flex items-center gap-1 font-semibold text-[#0B0B0D] hover:text-[#FF6B00] underline underline-offset-4 whitespace-nowrap"
              >
                <Lock className="h-3.5 w-3.5" />
                Owner Login
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
