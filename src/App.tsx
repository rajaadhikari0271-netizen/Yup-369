import { useCallback, useEffect, useState } from 'react';
import { AuthPortal } from './components/AuthPortal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { CustomerPortal } from './components/customer/CustomerPortal';
import { OwnerPortal } from './components/owner/OwnerPortal';
import { RiderPortal } from './components/rider/RiderPortal';
import { api, setAuthToken } from './services/api';
import type { AuthResponse, PublicCatalog, UserProfile } from './types/domain';

export default function App() {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await api.getCatalog();
      setCatalog(data);
      setCatalogError(null);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Unable to load platform catalog');
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleAuthenticated = (auth: AuthResponse) => {
    setAuthToken(auth.token);
    setUser(auth.user);
    loadCatalog();
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
  };

  if (catalogError && !catalog) {
    return (
      <div className="min-h-screen bg-[#F6F6F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl bg-white border border-zinc-200 p-6 text-center space-y-3">
          <h1 className="font-display text-xl font-bold text-[#0B0B0D]">
            Yup! 369 Unavailable
          </h1>
          <p className="text-sm text-zinc-600">{catalogError}</p>
          <button
            type="button"
            onClick={loadCatalog}
            className="min-h-[44px] px-5 rounded-xl bg-[#FFC700] text-sm font-bold text-[#0B0B0D]"
          >
            Retry
          </button>
        </div>
        <OfflineIndicator />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="min-h-screen bg-[#0B0B0D] text-white flex flex-col items-center justify-center gap-3">
        <div className="font-display text-2xl font-extrabold tracking-tight">
          Yup! <span className="text-[#FFC700]">369</span>
        </div>
        <div className="text-xs text-zinc-400">Loading kitchens &amp; services...</div>
        <OfflineIndicator />
      </div>
    );
  }

  return (
    <>
      {!user && (
        <AuthPortal
          services={catalog.services}
          onAuthenticated={handleAuthenticated}
        />
      )}

      {user?.role === 'CUSTOMER' && (
        <CustomerPortal
          user={user}
          services={catalog.services}
          restaurants={catalog.restaurants}
          pricing={catalog.pricing}
          onUserUpdated={setUser}
          onRefreshCatalog={loadCatalog}
          onLogout={handleLogout}
        />
      )}

      {user?.role === 'RIDER' && (
        <RiderPortal
          user={user}
          onUserUpdated={setUser}
          onLogout={handleLogout}
        />
      )}

      {user?.role === 'OWNER' && (
        <OwnerPortal
          user={user}
          services={catalog.services}
          onCatalogChanged={loadCatalog}
          onLogout={handleLogout}
        />
      )}

      <OfflineIndicator />
    </>
  );
}
