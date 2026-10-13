import { useEffect, useId } from 'react';

const base =
  'block w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function Field({ label, required, hint, error, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}

export function TextField({ label, required, hint, error, ...props }) {
  const id = useId();
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <input id={id} aria-label={label} aria-invalid={Boolean(error)} className={`${base} ${error ? 'border-red-400' : 'border-line'}`} {...props} />
    </Field>
  );
}

export function SelectField({ label, required, hint, error, options, placeholder, ...props }) {
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <select aria-label={label} aria-invalid={Boolean(error)} className={`${base} ${error ? 'border-red-400' : 'border-line'}`} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </Field>
  );
}

export function TextAreaField({ label, required, hint, error, ...props }) {
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <textarea aria-label={label} rows={3} aria-invalid={Boolean(error)} className={`${base} ${error ? 'border-red-400' : 'border-line'}`} {...props} />
    </Field>
  );
}

// Warn before leaving the page with unsaved changes.
export function useUnsavedWarning(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}
