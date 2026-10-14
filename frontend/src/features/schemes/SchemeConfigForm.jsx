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
  schemeType: '', description: '', permittedBranchIds: [], discountPolicyText: '', roundingPolicyText: '',
  odGraceDays: '', odCutoffTime: '', odTimezone: '', odPartialStops: 'NO', odHolidayPolicy: 'NONE', odNonWorkingDates: '',
  odRemindBefore: '', odRemindAfter: '', odLateFeeText: '', odEscalationText: '', odDisputedText: '', odConfirmationRef: '',
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
  schemeType: c.schemeType ?? '', description: c.description ?? '', permittedBranchIds: c.permittedBranchIds ?? [],
  discountPolicyText: c.discountPolicyText ?? '', roundingPolicyText: c.roundingPolicyText ?? '',
  odGraceDays: c.overdueRules?.graceDays === undefined ? '' : String(c.overdueRules.graceDays), odCutoffTime: c.overdueRules?.cutoffTime ?? '',
  odTimezone: c.overdueRules?.timezone ?? '', odPartialStops: c.overdueRules?.partialPaymentStopsOverdue ? 'YES' : 'NO',
  odHolidayPolicy: c.overdueRules?.holidayPolicy ?? 'NONE', odNonWorkingDates: (c.overdueRules?.nonWorkingDates ?? []).join('\n'),
  odRemindBefore: (c.overdueRules?.reminderDaysBefore ?? []).join(', '), odRemindAfter: (c.overdueRules?.reminderDaysAfter ?? []).join(', '),
  odLateFeeText: c.overdueRules?.lateFeeText ?? '', odEscalationText: c.overdueRules?.escalationText ?? '',
  odDisputedText: c.overdueRules?.disputedPaymentText ?? '', odConfirmationRef: c.overdueRules?.policyConfirmationRef ?? '',
});

const int = (v) => (v === '' ? undefined : Number(v));
const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
const opt = (v) => (v === '' ? undefined : v);
// "3, 1" becomes [3, 1]; anything that is not a whole number is sent as-is so the server reports it.
const days = (v) => v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x));

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
  schemeType: opt(f.schemeType), description: opt(f.description), permittedBranchIds: f.permittedBranchIds,
  discountPolicyText: opt(f.discountPolicyText), roundingPolicyText: opt(f.roundingPolicyText),
  overdueRules: {
    graceDays: int(f.odGraceDays), cutoffTime: opt(f.odCutoffTime), timezone: opt(f.odTimezone), partialPaymentStopsOverdue: f.odPartialStops === 'YES',
    holidayPolicy: f.odHolidayPolicy, nonWorkingDates: lines(f.odNonWorkingDates), reminderDaysBefore: days(f.odRemindBefore),
    reminderDaysAfter: days(f.odRemindAfter), lateFeeText: opt(f.odLateFeeText), escalationText: opt(f.odEscalationText),
    disputedPaymentText: opt(f.odDisputedText), policyConfirmationRef: opt(f.odConfirmationRef),
  },
});

const errKey = {
  name: 'name', jurisdiction: 'jurisdiction', chitValue: 'chitValuePaise', memberCount: 'memberCount', installmentAmount: 'installmentAmountPaise',
  frequency: 'frequency', tenureMonths: 'tenureMonths', auctionMode: 'auction.mode', minBid: 'auction.minBidPaise', maxBid: 'auction.maxBidPaise',
  bidIncrement: 'auction.bidIncrementPaise', tieBreakRule: 'auction.tieBreakRule', auctionNotes: 'auction.notes', dividendRuleText: 'dividendRuleText',
  commissionRuleText: 'commissionRuleText', eligibilityRequirements: 'eligibilityRequirements', requiredDocuments: 'requiredDocuments',
  complianceChecklist: 'complianceChecklist', maxTicketsPerMember: 'maxTicketsPerMember', minEnrolmentToActivate: 'minEnrolmentToActivate',
  effectiveFrom: 'effectiveFrom', effectiveTo: 'effectiveTo', code: 'code',
  schemeType: 'schemeType', description: 'description', permittedBranchIds: 'permittedBranchIds',
  discountPolicyText: 'discountPolicyText', roundingPolicyText: 'roundingPolicyText',
  odGraceDays: 'overdueRules.graceDays', odCutoffTime: 'overdueRules.cutoffTime', odTimezone: 'overdueRules.timezone',
  odPartialStops: 'overdueRules.partialPaymentStopsOverdue', odHolidayPolicy: 'overdueRules.holidayPolicy',
  odNonWorkingDates: 'overdueRules.nonWorkingDates', odRemindBefore: 'overdueRules.reminderDaysBefore', odRemindAfter: 'overdueRules.reminderDaysAfter',
  odLateFeeText: 'overdueRules.lateFeeText', odEscalationText: 'overdueRules.escalationText', odDisputedText: 'overdueRules.disputedPaymentText',
  odConfirmationRef: 'overdueRules.policyConfirmationRef',
};

export default function SchemeConfigForm({ meta, initial, withCode, submitLabel, busy, errors = {}, onSubmit, onCancel, onDirty }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => {
    onDirty?.();
    setF((p) => ({ ...p, [k]: e.target.value }));
  };
  const toggleBranch = (id) => {
    onDirty?.();
    setF((p) => ({ ...p, permittedBranchIds: p.permittedBranchIds.includes(id) ? p.permittedBranchIds.filter((x) => x !== id) : [...p.permittedBranchIds, id] }));
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
          {T('schemeType', 'Scheme type', { hint: 'Free text, as the company classifies the scheme' })}
        </div>
        <div className="mt-4 space-y-4">
          {A('description', 'Description')}
          <fieldset>
            <legend className="text-sm font-medium">Permitted branches</legend>
            <p className="mb-2 text-xs text-muted">Groups of this scheme can only be created in the ticked branches. Leave all unticked for no restriction.</p>
            <div className="flex flex-wrap gap-4">
              {(meta.branches ?? []).map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.permittedBranchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                  {b.name}
                </label>
              ))}
            </div>
            {e('permittedBranchIds') && <p role="alert" className="mt-1 text-xs text-red-700">{e('permittedBranchIds')}</p>}
          </fieldset>
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
      <Card title="Dividend, discount, commission and rounding policies">
        <p className="mb-3 text-sm text-muted">Enter the rules exactly as approved by the company. They are stored as text and are not interpreted or calculated by the system until the calculation engine is approved.</p>
        <div className="space-y-4">
          {A('dividendRuleText', 'Dividend / discount rule (as approved)')}
          {A('commissionRuleText', 'Commission rule (as approved)')}
          {A('discountPolicyText', 'Discount policy (as approved)')}
          {A('roundingPolicyText', 'Rounding policy (as approved)')}
        </div>
      </Card>
      <Card title="Instalment overdue and grace-period rules">
        <p className="mb-3 text-sm text-muted">
          These rules are <strong>unapproved</strong> until the business and compliance team confirm them; record the confirmation reference below once they do.
          Nothing here charges a late fee or changes member eligibility. Cut-off time and timezone are recorded but not applied yet (payments carry a date, not a time). Reminders are shown for planning only; nothing is sent.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {T('odGraceDays', 'Grace period (days)', { inputMode: 'numeric', hint: 'Empty uses the system placeholder (0 days)' })}
          <SelectField label="Does a part-payment stop the instalment becoming overdue?" value={f.odPartialStops} onChange={set('odPartialStops')} error={e('odPartialStops')} options={[{ value: 'NO', label: 'No: balance outstanding means overdue' }, { value: 'YES', label: 'Yes: stays Partially paid' }]} />
          {T('odCutoffTime', 'Payment cut-off time', { type: 'time' })}
          {T('odTimezone', 'Timezone', { hint: 'IANA name, e.g. Asia/Kolkata' })}
          <SelectField label="Non-working dates" value={f.odHolidayPolicy} onChange={set('odHolidayPolicy')} error={e('odHolidayPolicy')} options={[{ value: 'NONE', label: 'Do not change due dates' }, { value: 'NEXT_UNLISTED_DAY', label: 'Move to next date not listed below' }]} />
          {T('odRemindBefore', 'Reminders before due (days)', { hint: 'Comma separated, e.g. 3, 1' })}
          {T('odRemindAfter', 'Reminders after due (days)', { hint: 'Comma separated, e.g. 2, 7' })}
          {T('odConfirmationRef', 'Business / compliance confirmation reference', { hint: 'Leave empty while unconfirmed' })}
        </div>
        <div className="mt-4 space-y-4">
          {A('odNonWorkingDates', 'Non-working dates (one per line, YYYY-MM-DD)')}
          {A('odLateFeeText', 'Late fee or penalty (description only; never charged automatically)')}
          {A('odEscalationText', 'Default escalation and collection follow-up (description)')}
          {A('odDisputedText', 'Treatment of disputed or reversed payments (description)')}
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
