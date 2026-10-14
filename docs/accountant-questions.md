# Questions for the accountant

Status: **UNAPPROVED. Nothing in the system has been validated by an accountant.**

The application has the structure for a chart of accounts, journals, posting rules and accounting periods, but it
carries **no approved accounting treatment**. The sample chart in `pilot-config.example.json` and the placeholder chart
in the demo data are examples only. Please answer each question in writing and return it with your name, the date and
a reference; those go into the audit trail when the configuration is loaded (`initPilot`).

Answer "not applicable" where something does not apply. If an answer depends on a legal opinion, say so.

## A. Chart of accounts
1. Please supply the full chart: account **code, name, type** (asset, liability, income, expense, equity), **parent
   account** (if grouped) and whether it should be **active** from day one.
2. Does the company need separate ledgers or sub-ledgers per **group**, per **branch** or per **member**? If yes, which?
3. Which accounts must not accept manual journals (system-only accounts)?
4. What is the account numbering convention, and who may create or deactivate accounts after go-live?

## B. Recognition and posting of chit transactions (nothing is assumed)
5. **Subscription instalments received:** which accounts are debited and credited? Is the receipt a liability to the
   member, income, or something else? Does this differ before and after the prize is paid?
6. **Prize payout:** which accounts are debited and credited, and when is the liability recognised (at auction result,
   at approval, at disbursement)?
7. **Dividend / discount** to members: how is it accounted for, and in which period?
8. **Foreman commission:** when is it recognised, at what point does it become income, and which account receives it?
9. **Late fees or penalties**, if the business is legally allowed to charge them: how are they accounted for?
10. **Refunds, reversed or dishonoured payments, and advance payments** (paid before the due date): accounting for each.
11. **Defaulted members and their prized/unprized balances:** how are arrears, provisions and write-offs treated?
12. **Security deposits or guarantees**, if any: accounting treatment.
13. **Simulated or test payments:** confirm they must never reach the books (the system currently excludes them by default).

## C. Tax
14. Which transactions attract GST or other taxes, at what rate, and on what base? (The system applies **no** tax today.)
15. Is TDS or any other withholding applicable to prize payouts, dividends or commission? Who deducts it and when is it
    deposited?
16. What tax documents (invoices, receipts, certificates) must be issued, and with what numbering?

## D. Journals, approvals and controls
17. Who may create, approve and post journals? Maximum amounts per approver? (The system enforces that the creator and the
    approver differ; thresholds are not configured.)
18. Which journal types need a supporting document reference?
19. How must corrections be made after posting: reversal only, or also adjusting entries? Is a reason code list required?
20. What is the policy on back-dated entries, and by how many days may an entry be dated before the current date?

## E. Accounting periods
21. What is the **financial year** and the **period length** (month, quarter)? (The calendar loaded today is an example.)
22. Who may **close** and **reopen** a period, with what approval, and for how long may a closed period be reopened?
23. What must be true before a period is closed (bank reconciliation complete, no unposted journals, other checks)?
24. Are there year-end procedures (closing entries, carry-forward) the system must support?

## F. Bank and payment reconciliation
25. Which bank accounts and gateway settlement accounts exist? What is the **statement format** and how often are
    statements received?
26. What counts as a match (exact amount and reference, tolerance, date window)? What is the tolerance, if any?
27. How must **unmatched receipts, short or excess amounts, and chargebacks** be handled and by whom?
28. What is the deadline for clearing reconciliation exceptions?

## G. Reporting
29. Which financial statements and schedules are required (trial balance, ledger, profit and loss, balance sheet,
    group-wise statements), in what format and how often? The system's current statements are **provisional**.
30. Which statutory or regulatory returns must be produced from the ledger?
31. How long must records be kept, and is any record to be anonymised or archived afterwards?

## H. Instalments, overdue and grace rules (business and compliance)
32. What is the **instalment due date** rule (fixed day of the month, a date set per group, adjusted for weekends)?
33. What is the **payment cut-off time** and **timezone**? Does a payment after the cut-off count for the next day?
34. What is the **grace period**, and when exactly does an instalment become **overdue** (the day after due date plus
    grace, or a later rule)?
35. Does a **partial payment** stop an instalment from becoming overdue, or does any balance make it overdue?
36. Do **holidays or non-working days** move the due date? Who maintains the holiday list?
37. When and how often should members be **reminded** before and after the due date, and through which channel?
38. Is a **late fee or penalty** legally permitted? If yes: amount or rate, how it is capped, and when it applies. (The
    system never charges one automatically.)
39. What is the **default escalation** (collection calls, notices, visits), who owns each step and by when?
40. How are **disputed or reversed payments** treated for overdue status, and from which date?
41. Does arrears or default change a member's **eligibility** (bidding, prize payout)? The system does not change
    eligibility automatically.

## I. Calculations (Phase 3)
42. Please supply the exact written **formulas** for dividend, discount, commission and prize amount, the **rounding
    policy**, and **worked examples** that the system can be tested against. No formula has been implemented.
43. Who approves a change to a formula, and how are old calculations preserved?

Return the answers using `accountant-decision-checklist.md` so each item can be signed off.
