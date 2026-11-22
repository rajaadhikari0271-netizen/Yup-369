import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    if (variant === 'card') {
      return (
        <button
          type="button"
          onClick={install}
          className="w-full min-h-[48px] flex items-center justify-between gap-3 rounded-2xl bg-[#0B0B0D] px-4 py-3 text-left text-white hover:bg-[#1C1C21] transition-colors active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFC700] text-[#0B0B0D]">
              <Download className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold">Install Yup! 369 App</div>
              <div className="text-xs text-zinc-400">Launch full-screen from your Android home screen</div>
            </div>
          </div>
          <span className="shrink-0 rounded-lg bg-[#FFC700] px-3 py-1.5 text-xs font-bold text-[#0B0B0D] whitespace-nowrap">
            Install
          </span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#FFC700] px-3.5 py-2 text-xs font-bold text-[#0B0B0D] hover:bg-[#FFD335] transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="h-4 w-4" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B0B0D] hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="h-4 w-4 text-[#FF6B00]" />
          Install on iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-zinc-200">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-[#0B0B0D]">
                  Install Yup! 369 on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close guide"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-zinc-700">
                <li>1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.</li>
                <li>2. Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>3. Confirm <strong>Yup! 369</strong> to launch in standalone mode.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#0B0B0D] text-sm font-semibold text-white hover:bg-zinc-800 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
