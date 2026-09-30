import { useState } from 'react';
import type { TaskLink } from '../types';

// A task's saved site links (Live, Test…): Bouncy ends client messages with the right one as "Link: …".

export const LINK_LABELS = ['Live', 'Test'];

// "tomboy.in" → "https://tomboy.in"; anything that isn't a web address → null.
export function normaliseUrl(raw: string) {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes('.') ? u.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

// The small "↗ Live · ↗ Test" links under a task.
export function LinkChips({ links }: { links: TaskLink[] }) {
  if (!links.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {links.map((l) => (
        <a
          key={`${l.label}${l.url}`}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          title={l.url}
          onClick={(e) => e.stopPropagation()}
          className="text-[#257EF4] hover:underline"
        >
          ↗ {l.label}
        </a>
      ))}
    </span>
  );
}

// Editing them, in the task's Edit panel.
export default function TaskLinks({ links, onChange }: { links: TaskLink[]; onChange: (links: TaskLink[]) => void }) {
  const [label, setLabel] = useState(LINK_LABELS.find((l) => !links.some((x) => x.label === l)) ?? 'Live');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const clean = normaliseUrl(url);
    if (!clean) return setError('That doesn’t look like a web address');
    const name = label.trim() || 'Site';
    // One link per label: a new Live link replaces the old one.
    onChange([...links.filter((l) => l.label.toLowerCase() !== name.toLowerCase()), { label: name, url: clean }].slice(0, 6));
    setUrl('');
    setError(null);
    setLabel(LINK_LABELS.find((l) => l.toLowerCase() !== name.toLowerCase() && !links.some((x) => x.label === l)) ?? '');
  };

  return (
    <div className="flex basis-full flex-col gap-1.5">
      <span className="uppercase tracking-wider">Links</span>
      {links.map((l) => (
        <div key={`${l.label}${l.url}`} className="flex items-center gap-2 normal-case tracking-normal">
          <span className="w-12 shrink-0 font-semibold text-[var(--text-main)]">{l.label}</span>
          <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[#257EF4] hover:underline">
            {shortUrl(l.url)}
          </a>
          <button
            type="button"
            onClick={() => onChange(links.filter((x) => x !== l))}
            aria-label={`Remove ${l.label} link`}
            className="shrink-0 px-1 text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
          >
            ×
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex flex-wrap items-center gap-2 normal-case tracking-normal"
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 20))}
          placeholder="Label"
          list="link-labels"
          className="w-16 bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[var(--text-main)] py-0.5 clean-input"
        />
        <datalist id="link-labels">
          {LINK_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="tomboy.in or https://test.tomboy.in"
          inputMode="url"
          className="min-w-40 flex-1 bg-transparent border-b border-[var(--line-color)] focus:border-[var(--text-main)] outline-none text-[var(--text-main)] py-0.5 clean-input"
        />
        <button type="submit" disabled={!url.trim()} className="uppercase tracking-wider hover:text-[var(--text-main)] disabled:opacity-40 cursor-pointer">
          Add
        </button>
      </form>
      {error && <span className="normal-case tracking-normal text-red-500">{error}</span>}
    </div>
  );
}
