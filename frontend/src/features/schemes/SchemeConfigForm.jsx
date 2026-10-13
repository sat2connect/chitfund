import { useState } from 'react';
import { Button, Card } from '../../components/common/ui.jsx';
import { SelectField, TextAreaField, TextField } from '../../components/forms/controls.jsx';
import { paiseToRupees, rupeesToPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';

export const emptyForm = {
  code: '', name: '', jurisdiction: 'TAMIL_NADU', chitValue: '', memberCount: '', installmentAmount: '', frequency: 'MONTHLY',
  tenureMonths: '', auctionMode: '', minBid: '', maxBid: '', bidIncrement: '', tieBreakRule: '', auctionNotes: '',
  dividendRuleText: '', commissionRuleText: '', eligibilityRequirements: '', requiredDocuments: '', complianceChecklist: '',
  maxTicketsPerMember: '1', minEnrolmentToActivate: '', effectiveFrom: '', effectiveTo: '',
};

export const formFromConfig = (c) => ({
  code: '', name: c.name, jurisdiction: c.jurisdiction, chitValue: paiseToRupees(c.chitValuePaise), memberCount: String(c.memberCount),
  installmentAmount: paiseToRupees(c.installmentAmountPaise), frequency: c.frequency, tenureMonths: String(c.tenureMonths),
  auctionMode: c.auction.mode, minBid: paiseToRupees(c.auction.minBidPaise), maxBid: paiseToRupees(c.auction.maxBidPaise),
  bidIncrement: paiseToRupees(c.auction.bidIncrementPaise), tieBreakRule: c.auction.tieBreakRule ?? '', auctionNotes: c.auction.notes ?? '',
  dividendRuleText: c.dividendRuleText ?? '', commissionRuleText: c.commissionRuleText ?? '', eligibilityRequirements: c.eligibilityRequirements ?? '',
  requiredDocuments: c.requiredDocuments.join('\n'), complianceChecklist: c.complianceChecklist.join('\n'),
  maxTicketsPerMember: String(c.maxTicketsPerMember), minEnrolmentToActivate: String(c.minEnrolmentToActivate),
  effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo ?? '',
});

const int = (v) => (v === '' ? undefined : Number(v));
const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
const opt = (v) => (v === '' ? undefined : v);

export const configFromForm = (f) => ({
  name: f.name, jurisdiction: f.jurisdiction, chitValuePaise: rupeesToPaise(f.chitValue), memberCount: int(f.memberCount),
  installmentAmountPaise: rupeesToPaise(f.installmentAmount), frequency: f.frequency, tenureMonths: int(f.tenureMonths),
  auction: {
    mode: f.auctionMode, minBidPaise: rupeesToPaise(f.minBid), maxBidPaise: rupeesToPaise(f.maxBid),
    bidIncrementPaise: rupeesToPaise(f.bidIncrement), tieBreakRule: opt(f.tieBreakRule), notes: opt(f.auctionNotes),
  },
  dividendRuleText: opt(f.dividendRuleText), commissionRuleText: opt(f.commissionRuleText),
  eligibilityRequirements: opt(f.eligibilityRequirements), requiredDocuments: lines(f.requiredDocuments),
  complianceChecklist: lines(f.complianceChecklist), maxTicketsPerMember: int(f.maxTicketsPerMember) ?? 1,
  minEnrolmentToActivate: int(f.minEnrolmentToActivate), effectiveFrom: opt(f.effectiveFrom), effectiveTo: opt(f.effectiveTo),
});

const errKey = {
  name: 'name', jurisdiction: 'jurisdiction', chitValue: 'chitValuePaise', memberCount: 'memberCount', installmentAmount: 'installmentAmountPaise',
  frequency: 'frequency', tenureMonths: 'tenureMonths', auctionMode: 'auction.mode', minBid: 'auction.minBidPaise', maxBid: 'auction.maxBidPaise',
  bidIncrement: 'auction.bidIncrementPaise', tieBreakRule: 'auction.tieBreakRule', auctionNotes: 'auction.notes', dividendRuleText: 'dividendRuleText',
  commissionRuleText: 'commissionRuleText', eligibilityRequirements: 'eligibilityRequirements', requiredDocuments: 'requiredDocuments',
  complianceChecklist: 'complianceChecklist', maxTicketsPerMember: 'maxTicketsPerMember', minEnrolmentToActivate: 'minEnrolmentToActivate',
  effectiveFrom: 'effectiveFrom', effectiveTo: 'effectiveTo', code: 'code',
};

export default function SchemeConfigForm({ meta, initial, withCode, submitLabel, busy, errors = {}, onSubmit, onCancel, onDirty }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => {
    onDirty?.();
    setF((p) => ({ ...p, [k]: e.target.value }));
  };
  const e = (k) => errors[errKey[k]];
  const T = (k, label, props = {}) => <TextField label={label} value={f[k]} onChange={set(k)} error={e(k)} {...props} />;
  const A = (k, label, props = {}) => <TextAreaField label={label} value={f[k]} onChange={set(k)} error={e(k)} {...props} />;

  return (
    <form className="space-y-5" onSubmit={(ev) => { ev.preventDefault(); onSubmit(f); }}>
      <Card title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          {withCode && T('code', 'Scheme code', { required: true, hint: '3–20 capital letters, digits or hyphens. Cannot change later.' })}
          {T('name', 'Scheme name', { required: true })}
          <SelectField label="Jurisdiction" required value={f.jurisdiction} onChange={set('jurisdiction')} error={e('jurisdiction')} options={meta.jurisdictions.map((j) => ({ value: j, label: humanize(j) }))} />
          {T('effectiveFrom', 'Effective from', { type: 'date', required: true })}
          {T('effectiveTo', 'Effective to', { type: 'date', hint: 'Leave empty for open-ended' })}
        </div>
      </Card>
      <Card title="Financial terms (₹)">
        <div className="grid gap-4 sm:grid-cols-2">
          {T('chitValue', 'Chit value (₹)', { required: true, inputMode: 'decimal' })}
          {T('memberCount', 'Members / tickets', { required: true, inputMode: 'numeric' })}
          {T('installmentAmount', 'Instalment amount (₹)', { required: true, inputMode: 'decimal' })}
          <SelectField label="Instalment frequency" required value={f.frequency} onChange={set('frequency')} error={e('frequency')} options={meta.frequencies.map((j) => ({ value: j, label: humanize(j) }))} />
          {T('tenureMonths', 'Tenure (months)', { required: true, inputMode: 'numeric' })}
        </div>
      </Card>
      <Card title="Auction configuration">
        <p className="mb-3 text-sm text-muted">The auction operating model is not yet decided. These settings are recorded now and applied when auctions are built.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Auction mode" required placeholder="Select mode" value={f.auctionMode} onChange={set('auctionMode')} error={e('auctionMode')} options={meta.auctionModes.map((j) => ({ value: j, label: humanize(j) }))} />
          {T('minBid', 'Minimum bid (₹)', { inputMode: 'decimal' })}
          {T('maxBid', 'Maximum bid (₹)', { inputMode: 'decimal' })}
          {T('bidIncrement', 'Bid increment (₹)', { inputMode: 'decimal' })}
        </div>
        <div className="mt-4 space-y-4">
          {A('tieBreakRule', 'Tie-break rule (description)')}
          {A('auctionNotes', 'Other auction notes')}
        </div>
      </Card>
      <Card title="Dividend and commission rules">
        <p className="mb-3 text-sm text-muted">Enter the rules exactly as approved by the company. They are stored as text and are not interpreted or calculated by the system until the calculation engine is approved.</p>
        <div className="space-y-4">
          {A('dividendRuleText', 'Dividend / discount rule (as approved)')}
          {A('commissionRuleText', 'Commission rule (as approved)')}
        </div>
      </Card>
      <Card title="Eligibility, enrolment and compliance">
        <div className="space-y-4">
          {A('eligibilityRequirements', 'Eligibility requirements')}
          {A('requiredDocuments', 'Required documents (one per line)')}
          {A('complianceChecklist', 'Group activation prerequisites (one per line)', { hint: 'Each item must be confirmed with a reference for every group before it can start, e.g. contractual or regulatory steps defined by compliance.' })}
          <div className="grid gap-4 sm:grid-cols-2">
            {T('maxTicketsPerMember', 'Max tickets per member', { inputMode: 'numeric' })}
            {T('minEnrolmentToActivate', 'Minimum tickets allocated to activate', { inputMode: 'numeric', hint: 'Defaults to the member count' })}
          </div>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
      </div>
    </form>
  );
}
