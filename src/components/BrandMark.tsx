import React from 'react';
import { Zap } from 'lucide-react';

interface BrandMarkProps {
  inverted?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const BrandMark: React.FC<BrandMarkProps> = ({ inverted = false, size = 'md' }) => {
  const iconBox =
    size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'lg' ? 'h-11 w-11 rounded-2xl' : 'h-9 w-9 rounded-xl';
  const textSize =
    size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-xl';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <span
        className={`flex items-center justify-center bg-[#FFC700] text-[#0B0B0D] shadow-sm ${iconBox}`}
      >
        <Zap className="h-5 w-5 fill-current stroke-[2.2]" />
      </span>
      <span
        className={`font-display font-extrabold tracking-tight ${textSize} ${
          inverted ? 'text-white' : 'text-[#0B0B0D]'
        }`}
      >
        Yup! <span className="text-[#FF6B00]">369</span>
      </span>
    </span>
  );
};

export const VegMarker: React.FC<{ isVeg: boolean }> = ({ isVeg }) => (
  <span
    aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
    title={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
      isVeg ? 'border-emerald-700' : 'border-red-700'
    }`}
  >
    <span
      className={`h-2 w-2 rounded-full ${isVeg ? 'bg-emerald-700' : 'bg-red-700'}`}
    />
  </span>
);

export const formatINR = (amount: number): string => {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
};

export const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};
