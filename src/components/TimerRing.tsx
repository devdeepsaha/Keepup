import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Timer } from '../lib/tasks';

const STROKE = {
  green: '#34d399', // emerald-400
  waiting: '#257ef4', // brand blue: paused, waiting on the client
  orange: '#f59e0b', // amber-500: 'needs a nudge' (green → amber → red)
  red: '#ef4444', // red-500
};

const HEADING = {
  green: 'On track',
  waiting: 'On hold',
  orange: 'Needs a nudge',
  red: 'Urgent',
};

const R = 9;
const CIRCUMFERENCE = 2 * Math.PI * R;
const CARD_W = 256;

export interface RingDetails {
  headline: string; // what to do next
  primary: { label: string; value: string }[]; // key facts, shown large
  secondary: string[]; // background, small print
}

interface Props {
  timer: Timer;
  details?: RingDetails;
  size?: number;
}

function Ring({ timer, size }: { timer: Timer; size: number }) {
  // Always show a sliver so a fresh task still reads as a (green) timer.
  // Paused (waiting on the client, nothing due yet): a dashed full circle instead of a filling arc.
  const paused = timer.tone === 'waiting' && timer.progress < 0.05;
  const filled = Math.max(0.04, timer.progress) * CIRCUMFERENCE;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="-rotate-90 shrink-0">
      <circle cx="12" cy="12" r={R} fill="none" stroke="var(--line-color)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={R}
        fill="none"
        stroke={STROKE[timer.tone]}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={paused ? '2.4 3.2' : `${filled} ${CIRCUMFERENCE}`}
        style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.3s ease' }}
      />
    </svg>
  );
}

// Small circular timer: the arc fills as a task's time runs out; color shows urgency.
// Hover (or focus) shows a detail card, rendered in a portal so row clipping can't cut it off.
export default function TimerRing({ timer, details, size = 22 }: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 220 > window.innerHeight;
    const left = Math.min(Math.max(8, r.right - CARD_W), window.innerWidth - CARD_W - 8);
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={anchor}
        tabIndex={0}
        role="img"
        aria-label={`${HEADING[timer.tone]}: ${timer.label}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Ring timer={timer} size={size} />
      </span>

      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: pos.top, left: pos.left, width: CARD_W, transform: pos.above ? 'translateY(-100%)' : undefined }}
            className="fixed z-50 rounded-2xl border border-[var(--line-color)] bg-[var(--surface)] p-4 shadow-xl pointer-events-none"
          >
            {/* Status and what to do next */}
            <div className="flex items-center gap-3">
              <Ring timer={timer} size={40} />
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold leading-tight" style={{ color: STROKE[timer.tone] }}>
                  {HEADING[timer.tone]}
                </div>
                {details && <div className="text-sm leading-snug text-[var(--text-main)]">{details.headline}</div>}
              </div>
            </div>

            {details && (
              <>
                {/* Key facts at a glance */}
                <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-[var(--line-color)] py-3">
                  {details.primary.map((d) => (
                    <div key={d.label} className="min-w-0">
                      <dt className="text-[0.6875rem] text-[var(--text-muted)]">{d.label}</dt>
                      <dd className="truncate font-display text-base font-semibold">{d.value}</dd>
                    </div>
                  ))}
                </dl>

                {/* Background */}
                <div className="mt-2.5 space-y-0.5 text-xs leading-snug text-[var(--text-muted)]">
                  {details.secondary.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  <div>{Math.round(timer.progress * 100)}% of its time used</div>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
