import { Check } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

interface FieldOptions {
  label: string;
  supportingText?: ReactNode;
  /** Placeholder shown only while the field is focused and empty. */
  hint?: string;
  error?: boolean;
  className?: string;
}

function FieldShell({ id, label, required, supportingText, error, className = '', children }: FieldOptions & { id: string; required?: boolean; children: ReactNode }) {
  return (
    <div className={`tf ${error ? 'tf-error' : ''} ${className}`}>
      <div className="tf-control">
        {children}
        <label htmlFor={id} className="tf-label">
          {label}
          {required ? ' *' : ''}
        </label>
      </div>
      {supportingText && <div className="tf-supporting">{supportingText}</div>}
    </div>
  );
}

/** MD3 outlined text field with a floating label. */
export function TextField({ label, supportingText, hint, error, className, ...input }: FieldOptions & Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder' | 'className'>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={input.required} supportingText={supportingText} error={error} className={className}>
      {/* A non-empty placeholder lets CSS see an empty field (:placeholder-shown) and keep the label inside. */}
      <input {...input} id={id} className="tf-input" placeholder={hint ?? ' '} />
    </FieldShell>
  );
}

export function TextArea({ label, supportingText, hint, error, className, ...area }: FieldOptions & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'placeholder' | 'className'>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={area.required} supportingText={supportingText} error={error} className={className}>
      <textarea {...area} id={id} className="tf-input" placeholder={hint ?? ' '} />
    </FieldShell>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="switch-row">
      <span>
        <span className="body-large">{label}</span>
        {description && <span className="muted small" style={{ display: 'block' }}>{description}</span>}
      </span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" />
        <span className="switch-handle" />
      </span>
    </label>
  );
}

export function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  block = false,
  label,
}: {
  options: { id: NoInfer<T>; label: string; icon?: ReactNode }[];
  value: T;
  onChange(id: NoInfer<T>): void;
  block?: boolean;
  label?: string;
}) {
  return (
    <div className={`segmented ${block ? 'segmented-block' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.id === value ? <Check size={18} /> : o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CircularProgress({ size = 32 }: { size?: number }) {
  return (
    <svg className="progress-circular" viewBox="0 0 48 48" width={size} height={size} role="progressbar" aria-label="Загрузка">
      <circle cx="24" cy="24" r="18" />
    </svg>
  );
}

export function LinearProgress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-bar" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** File picker styled as an MD3 tonal button. */
export function FileButton({
  label,
  accept,
  file,
  onChange,
  icon,
}: {
  label: string;
  accept: string;
  file: File | null;
  onChange(file: File | null): void;
  icon?: ReactNode;
}) {
  return (
    <label className="btn btn-tonal file-button">
      {icon}
      <span className="file-button-text">{file ? file.name : label}</span>
      <input type="file" accept={accept} hidden onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}
