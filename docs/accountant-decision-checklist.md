# Accountant and business decision checklist

Status of every row below: **NOT APPROVED** until a name, date and reference are written in. Until a row is approved, the
system uses the placeholder shown, and the item must not be relied on for real money.

Questions behind each row are in `accountant-questions.md` (the number in brackets). The configuration structure that will
receive the answers is `accounting-config-template.json`.

| # | Decision | Owner | Placeholder used by the system today | Where it is applied | Approved by / date / reference |
|---|---|---|---|---|---|
| 1 | Chart of accounts (codes, names, types, parents) [1-4] | Accountant | Example chart in demo data and `pilot-config.example.json` | Accounting > Chart of accounts | |
| 2 | Posting rules for collections by payment mode [5, 10, 13] | Accountant | Debit/credit accounts from the example config | `postingRules` in pilot config | |
| 3 | Posting rules for prize payouts [6] | Accountant | Example payout accounts | Payout disbursement journals | |
| 4 | Dividend, commission and late-fee accounting [7-9] | Accountant | **None. Not implemented.** | Nowhere | |
| 5 | Defaults, provisions, write-offs, deposits [11, 12] | Accountant | None | Nowhere | |
| 6 | Tax treatment (GST, TDS, documents) [14-16] | Accountant / tax adviser | **None. No tax is calculated.** | Nowhere | |
| 7 | Journal approval limits and supporting-document rules [17, 18] | Accountant / Finance head | Creator and approver must differ; no amount thresholds | Journal workflow | |
| 8 | Correction policy and back-dating limit [19, 20] | Accountant | Reversal by approved reversal journal; no back-date limit | Journal reversal, period lock | |
| 9 | Financial year and period calendar [21] | Accountant | Example calendar from the pilot config | Accounting periods | |
| 10 | Period close and reopen authority and conditions [22-24] | Accountant / Finance head | Close needs every journal in the period posted; reopen needs the period-manage permission and a reason (no second approver) | Period controls | |
| 11 | Bank accounts, statement format, matching tolerance [25, 26] | Accountant / Finance | Exact amount and reference; no tolerance | Reconciliation queue | |
| 12 | Handling of unmatched items and chargebacks, deadlines [27, 28] | Accountant / Finance | Visible exception with a mandatory comment | Reconciliation exceptions | |
| 13 | Required statements and statutory returns, retention [29-31] | Accountant / Compliance | Provisional trial balance, ledger, profit and loss | Accounting reports | |
| 14 | Instalment due-date rule [32] | Business | Monthly, same day as the commencement date, month-end clamped | Group instalment schedule | |
| 15 | Cut-off time and timezone [33] | Business | Recorded per scheme; **not applied** (payments carry a date only) | Scheme overdue rules | |
| 16 | Grace period and the moment an instalment is overdue [34] | Business / Compliance | Per-scheme grace days, else global placeholder of 0 days | Instalment status | |
| 17 | Effect of partial payment on overdue status [35] | Business | Per-scheme switch; default: any balance past grace is overdue | Instalment status | |
| 18 | Holidays and non-working days [36] | Business | Per-scheme list of dates; policy default: no change | Instalment due date | |
| 19 | Reminder timing [37] | Business | Per-scheme day offsets, **display only, nothing sent** | Dues screen | |
| 20 | Late fee or penalty [38] | Business / Legal | Description only; **never charged** | Nowhere | |
| 21 | Default escalation and follow-up [39] | Business | Description only | Scheme record | |
| 22 | Disputed and reversed payments [40] | Business | A reversed payment re-opens the balance and the status is recomputed; audit entry written | Collections | |
| 23 | Eligibility consequences of arrears [41] | Business / Legal | **None. Eligibility is never changed automatically.** | Nowhere | |
| 24 | Dividend, discount, commission and prize formulas, rounding [42, 43] | Business / Accountant | **None. The calculation engine has no rule registered.** | Calculation rules screen | |
| 25 | Auction operating model and schedule rules | Business / Legal | Member-submitted digital bids; planned auction dates are free entries | Auctions, group auction schedule | |
| 26 | Payment gateway, bank, notification, file-storage and KYC-provider choices | Business | Simulated gateway; no notifications; metadata-only KYC and document references | Collections, portal, KYC | |
| 27 | Legal and regulatory review of the scheme documents and compliance prerequisites | Legal | Prerequisites are free text attested per group with a reference | Group activation readiness | |

## How an approval is recorded
- Accounting configuration: load it with `initPilot` (it requires the accountant's name, approval date and reference, and
  records them in the audit trail). The load is refused on a system that already holds data.
- Overdue and grace rules: enter them on the scheme version and record the business / compliance confirmation reference in
  the **Business / compliance confirmation reference** field. The scheme then goes through the normal maker-checker approval.
  Until a reference is present the screens show the rules as **unapproved**.
- Formulas: a rule set must be registered in code, validated against the accountant's worked examples
  (`validateRuleSet`), and carry an approval reference before it is treated as production-ready. Even then no posting is
  wired to it; that needs a separate, reviewed change.

## What stays blocked until this checklist is approved
Real collections, journal posting for real money, reconciliation against real bank statements and payouts. See
`deployment.md` and the README section on what still blocks go-live.
