export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: NoInfer<T>; label: string; count?: number }[];
  value: T;
  onChange(id: NoInfer<T>): void;
}) {
  return (
    <div className="tabs" role="tablist">
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
