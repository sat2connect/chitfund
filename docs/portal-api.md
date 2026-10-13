# Member portal API (v1)

This is the contract the customer web portal uses. A future native mobile app can use the same endpoints unchanged.
The mobile framework has not been chosen; nothing here depends on the web UI.

## Principles
- **Identity comes from the session, never the request.** No endpoint accepts a customer id to decide *whose* data to return. A member can only ever read or act on their own records. Someone else's record returns the same `404` as a record that does not exist.
- **Money is integer paise** in every request and response (`amountPaise`). Clients convert to rupees only for display.
- **The server clock is authoritative.** Bid times, auction windows and statement dates come from the server. Responses include `serverTime` or `generatedAt` where it matters.
- **A client never decides an outcome.** A bid or payment is accepted only when the server's response says so. Online payments become payments only through the provider callback.
- **Retries are safe.** Creating things (`bids`, `support-cases`, `payouts`) takes a `clientRequestId`; repeating the same id returns the original result with `duplicate: true` and creates nothing new.
- **Errors** use one envelope: `{ "error": { "code", "message", "details?", "requestId" } }`. Validation failures return `400` with `details` keyed by field.
- **No internal fields.** Staff identities, journals, reconciliation state, approval comments, internal notes and hold reasons are never returned to members.

## Authentication (placeholder)
Development uses a simulated header, `x-dev-user: <member user id>`. This is **not secure** and is the single seam to replace when an authentication provider is chosen (`backend/src/middleware/auth.ts`). Mobile will need token-based sessions from the chosen provider; the portal endpoints themselves do not change.

## Endpoints
All paths are under `/api/v1`. All require a member session (`portal:access`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/portal/profile` | Own details, KYC and membership status |
| GET | `/portal/summary` | Totals, memberships (tickets), next due, open support cases |
| GET | `/portal/instalments?groupId&status&page&pageSize` | Own instalments with derived status |
| GET | `/portal/payments` | Payment history |
| GET | `/portal/payments/:id` | Receipt and allocation to dues |
| GET | `/portal/statement?groupId&from&to` | Dues and payments with running balance (operational, not an accounting document) |
| GET | `/portal/payment-attempts` | Own online payment requests (simulated gateway) |
| POST | `/portal/payment-attempts` | Start a payment `{ amountPaise }` (does **not** confirm payment) |
| POST | `/portal/payment-attempts/:id/cancel` | Cancel a pending request |
| GET | `/portal/payouts` | Prize payout tracking (amount shown only once approved) |
| GET | `/portal/support/meta` | Support categories |
| GET/POST | `/portal/support-cases` | List / create `{ category, subject, description, clientRequestId }` |
| GET | `/portal/support-cases/:id` | Conversation (internal notes excluded) |
| POST | `/portal/support-cases/:id/messages` | Reply `{ body }` (reopens a resolved case) |

Auctions use the shared endpoints, which return a member-safe view for member sessions:

| Method | Path | Purpose |
|---|---|---|
| GET | `/auctions`, `/auctions/:id` | Own auctions; own tickets, eligibility and bids; result only once approved |
| POST | `/auctions/:id/bids` | `{ ticketNo, amountPaise, clientRequestId }`; accepted only when the response says `accepted: true` |
| POST | `/auctions/:id/disputes` | `{ reason }` |

## Known gaps before a mobile release
- Real authentication and session handling (provider undecided).
- Push/SMS/email notifications (providers undecided). Today the portal says notifications are not sent.
- Document upload for KYC (file storage undecided).
- Rate limiting, device binding and abuse controls (production phase).
