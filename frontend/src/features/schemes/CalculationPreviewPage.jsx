import { useState } from 'react';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { getCalculationRules, previewCalculation } from './schemeService.js';

/**
 * Calculation preview. No financial rule has been approved, so this screen can only show which rules exist and
 * what the engine would say about sample data. It never produces a figure that is used anywhere.
 */
export default function CalculationPreviewPage() {
  const rules = useApi(getCalculationRules);
  const [kind, setKind] = useState('DIVIDEND');
  const [out, setOut] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  if (rules.loading) return <LoadingState />;
  if (rules.error) return <ErrorState error={rules.error} onRetry={rules.reload} />;
  const r = rules.data;

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setOut(await previewCalculation({ kind, useSample: true }));
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Calculation rules and preview" description="The calculation engine is an interface only until an accountant-approved rule set is registered and validated." />
      <Banner tone="warning">{r.notice}</Banner>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <Card title="Rule sets">
          <ul className="divide-y divide-line text-sm">
            {r.kinds.map((k) => (
              <li key={k.kind} className="py-2">
                <p className="font-medium">{humanize(k.kind)}</p>
                <p className="text-muted">{k.ruleSets.length === 0 ? 'No rule registered' : k.ruleSets.map((x) => `${x.id} v${x.version} (${humanize(x.status)})`).join(', ')}</p>
                <p className="text-xs">{k.productionReady ? 'Validated with an approval reference' : 'Not ready for production use'}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Preview with sample data">
          <p className="mb-3 text-sm text-muted">{r.sample.label}</p>
          <dl className="mb-3 grid grid-cols-2 gap-x-4 text-sm">
            <dt className="text-muted">Chit value</dt><dd>{formatPaise(r.sample.chitValuePaise)}</dd>
            <dt className="text-muted">Members</dt><dd>{r.sample.memberCount}</dd>
            <dt className="text-muted">Instalment</dt><dd>{formatPaise(r.sample.installmentAmountPaise)}</dd>
          </dl>
          <div className="flex items-end gap-3">
            <SelectField label="Calculation" value={kind} onChange={(e) => setKind(e.target.value)} options={r.kinds.map((k) => ({ value: k.kind, label: humanize(k.kind) }))} />
            <Button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Preview'}</Button>
          </div>
          {err && <div className="mt-3"><Banner tone="error">{err.message}</Banner></div>}
          {out && (
            <div className="mt-4 space-y-2 text-sm" aria-live="polite">
              <p><strong>Status:</strong> {humanize(out.status)} · Mode: {humanize(out.mode)}</p>
              {out.result && <p><strong>Preview amount (not for use):</strong> {formatPaise(out.result.amountPaise)}</p>}
              <ul className="list-disc pl-5 text-muted">{out.notices.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
