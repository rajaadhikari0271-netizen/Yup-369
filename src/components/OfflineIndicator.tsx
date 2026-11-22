import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 flex items-center gap-2.5 rounded-xl bg-[#0B0B0D] border border-[#FF6B00] px-4 py-2.5 text-xs font-medium text-white shadow-xl"
    >
      <WifiOff className="h-4 w-4 text-[#FFC700] shrink-0" />
      <span>Offline Mode — Cached shell active; live orders require connectivity.</span>
    </div>
  );
};
