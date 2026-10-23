import { useEffect, useRef } from 'react';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: NoInfer<T>; label: string; count?: number }[];
  value: T;
  onChange(id: NoInfer<T>): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // On narrow screens the row scrolls; keep the chosen tab in view (say, when opened by a link).
  useEffect(() => {
    const row = ref.current;
    const active = row?.querySelector<HTMLElement>('.tab-active');
    if (!row || !active) return;
    const r = row.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left < r.left || a.right > r.right) row.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
  }, [value]);

  return (
    <div className="tabs" role="tablist" ref={ref}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`tab ${value === t.id ? 'tab-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
