import { useEffect, useState } from "react";

/**
 * Debounces a fast-changing value (search input). `pending` is true from the
 * first keystroke until the debounced value catches up — drives the spinner
 * so users see that results are still being processed.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs = 150
): { debounced: T; pending: boolean } {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return { debounced, pending: debounced !== value };
}

/** Quiet search field with a progress spinner shown while results settle. */
export function SearchBar({
  value,
  onChange,
  placeholder,
  searching,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  searching: boolean;
}) {
  return (
    <div className="search-bar">
      <svg className="search-icon" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <line x1="10.5" y1="10.5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        className="search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={searching ? { paddingRight: 34 } : undefined}
      />
      {searching && (
        <span className="search-spinner" aria-hidden="true" title="Searching…" />
      )}
    </div>
  );
}
