import { useId } from 'react';

// Keepup's mark: the ring timer, mostly filled, with a tick. White tile, gradient ring. `stops` tints the ring
// (each space has its own); the default is Mint-more's blue into green.
const DEFAULT_STOPS = ['#257ef4', '#06b6d4', '#10b981', '#22c55e'];

export default function Logo({ size = 32, stops = DEFAULT_STOPS }: { size?: number; stops?: string[] }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={`kg${id}`} x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          {stops.map((c, i) => (
            <stop key={`${c}${i}`} offset={stops.length > 1 ? i / (stops.length - 1) : 0} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#ffffff" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" fill="none" stroke="#121212" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#efeee9" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        r="16"
        fill="none"
        stroke={`url(#kg${id})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="70 101"
        transform="rotate(-90 32 32)"
      />
      <path d="M25 32.5l5 5 9-10" fill="none" stroke="#121212" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
