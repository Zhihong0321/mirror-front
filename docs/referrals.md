# Referral program

Anyone with an account can refer. They get a free preview made for a company, send its link to the company's owner, can
watch whether the owner read it, and are paid in USDT when the owner buys the full report.
Code: [server/referrals.js](../server/referrals.js) (rules), [server/referrals-page.js](../server/referrals-page.js) (pages),
[server/app.js](../server/app.js) (routes, search "Referral"), [server/store.js](../server/store.js) (tables),
[server/visits.js](../server/visits.js) `referrerViews` (the tracker query). Tests: [server/test/referrals.test.js](../server/test/referrals.test.js).

## The flow

```
account (email sign-in, nothing to apply for)
  └─ dashboard: "Get a free preview" of a company  ──▶ team marks it ready ──▶ email to the asker with <site>/p/<report>?ref=<code>
        └─ /account/referrals: the same link (Copy link), the visitor tracker, earnings, wallet
              └─ owner opens <site>/p/<report>?ref=<code>   (cookie mm_ref remembers the code for 30 days, for that report)
                    └─ order button: /order?report=<id>&ref=<code> ─▶ Stripe checkout, metadata referrer_code
                          └─ payment arrives (webhook or return page) ─▶ commission row, "You earned" email to the referrer
                                └─ team: /myoffice/referrals, sends USDT by hand, pastes the transaction hash, Mark paid ─▶ "Sent" email
```

## What was already there, and what is new

| Piece | Before | Now |
|---|---|---|
| Accounts | Email sign-in link, no password (`users`) | Same. Every account is a referrer: a `referral_code` (8 random characters, made on first use) |
| Preview report link | `/p/<report id>` | The ready email and the referral page give `/p/<id>?ref=<code>`; the page's order button carries the code |
| Visitor tracker | Built into every HTML page (`visits`), **team only** (`/myoffice/visitors`) | Same data, now also shown to the referrer for their own previews on `/account/referrals` |
| Payment | Stripe checkout per report (`orders`) | The order's metadata carries `referrer_code`; a paid order makes a `referral_commissions` row |
| Payout | None | USDT wallet on the account; the team pays by hand and records it |

## Rules

- **Commission per sold report**: a number of cents in the site database, `settings` row `referral_commission_cents`.
  **Default USD 20** when the row is missing or not a whole number. Change it on `/myoffice/referrals` (dollars). It applies
  to sales from then on; every commission keeps the amount it was earned at. USD 0 is allowed (a pause).
- **Any one can refer**: no application. The code appears the first time the account opens `/account/referrals`
  (or when its preview-ready email is sent).
- **Who is credited with a sale**, in this order: (1) the `?ref=` code on the link or order form, (2) the `mm_ref` cookie
  an earlier visit to this report left (last click wins, 30 days, per report), (3) the account that asked for the preview
  of that report (`preview_requests`). A code nobody owns is ignored.
- **When it is earned**: when the buyer's payment is recorded (same moment the invoice is made), once per order.
- **Own purchase** (owner, 2026-11-12): a referrer who buys through their own link **earns the fee like any other sale**.
  It is recorded as `pending` with the note "Own purchase" so it is visible, and paid the same way.
- **Checkout record**: every checkout started for a report is written to `checkout_referrals` when it is created, paid or not:
  referrer detected (yes/no), their code and email, and how (`link` / `cookie` / `requester`). The team sees it under
  "Checkouts" on `/myoffice/referrals`. At payment the commission follows this record, with Stripe's metadata as fallback.
- **Wallet**: USDT only, and the form asks for **the address only** (owner decision 2026-11-13: no network to pick,
  because a wrong pick moves the money to the wrong chain). The chain is read from the address: `T…` = TRON (TRC20),
  `0x…` = an EVM wallet, stored as `evm` because the same address is usable on Ethereum (ERC20) and BNB Smart Chain
  (BEP20) and the team chooses the chain it sends on. The check catches a mistyped address (TRON checksum, EVM shape,
  not the zero address) and refuses it with the reason; EVM addresses are not checksum-verified (that needs keccak,
  which this server does not carry). Wallets saved before that date keep their `erc20` / `bep20` label. A commission is
  earned with or without a wallet; the referrer is told to add one.
- **Paying**: by hand. The site never sends money. The team sends USDT from their own wallet, pastes the transaction hash
  on that commission and presses **Mark paid**: the wallet and hash are stored on the row and the referrer is emailed.
  Pressing it twice changes nothing.
- **Minimum withdrawal: USD 50 per referrer** (owner decision 2026-11-14, `MIN_PAYOUT_CENTS` in `referrals.js`). Commission
  below USD 50 stays `pending` and keeps adding up; nothing is cancelled. The earnings page says how far the referrer is
  from USD 50, and `/myoffice/referrals` labels each referrer "Below minimum" or "Minimum reached". The team's Mark paid
  is not blocked: the minimum is a label that the team reads before paying.
- **Statuses**: `pending` (earned, to be paid), `held` (a person must look), `paid`, `void` (cancelled by the team).
  A refund is not detected automatically: the team cancels the commission on the page.

## The tracker for referrers

`/account/referrals` lists every preview the account asked for that is ready, each with its link and a verdict:

| Verdict | Meaning |
|---|---|
| Not opened yet | No view recorded |
| Not opened by a person yet | Only bots or chat-app link previews fetched it (named, and not counted as reading) |
| Opened | A person opened it, but did not read it |
| Read it | One visit of at least 30 seconds on the page that scrolled at least 60% (`READ_MS`, `READ_SCROLL`) |

Under each: views, people, last view, best visit's time and scroll, and an "Every view" list (when, city and country,
device, time on page, scroll). **Never shown to a referrer: IP addresses, names, emails.** Their own visits are left out
(signed in as them, or the same browser id as one of their signed-in visits). If the browser reported no time (script
blocked, or the factory's own fallback page, which carries no script) the row says "not measured" instead of guessing.

Views of a preview someone else asked for count for a referrer only when they came in on a link carrying their code;
those show under "Other previews opened through your link". The team still sees everything on `/myoffice/visitors`.

## Pages

| Address | Who | What |
|---|---|---|
| `/account/referrals` | any signed-in account | Links and tracker: how it works, previews with tracker, "Get your link for any preview" |
| `/account/referrals/earnings` | same | Earned, paid, every commission |
| `/account/referrals/wallet` | same | Wallet form |
| `POST /account/referrals/wallet` | same | Save (`address` only; the chain is read from it) or remove (`clear=1`) the wallet |
| `/myoffice/referrals` | the office key | Commission setting, who is owed what (with wallets), every commission with Mark paid / Approve / Cancel |
| `POST /myoffice/referrals/commission` | office | `usd=` the new commission |
| `POST /myoffice/referrals/<id>/paid` (`tx=`), `/void`, `/approve` | office | Decide one commission |

## Data (site SQLite)

- `users`: `referral_code` (unique), `payout_network` (`trc20` / `evm`, legacy `erc20` / `bep20`), `payout_wallet`, `payout_updated_at`
- `settings`: `key`, `value`, `updated_at`
- `referral_commissions`: one row per order (`order_id` unique): referrer, buyer, report, company, `amount_cents`, `status`,
  `note`, `source` (`link` / `cookie` / `requester`), `paid_at`, `paid_network`, `paid_wallet`, `paid_tx`

Existing databases are upgraded in place when the server starts (tested).

## Zero kill gates

Nothing in the program can stop a payment, an invoice, a report or a page. Recording a commission is wrapped: a failure
is logged (`could not record the referral commission`) and the order goes on. A bad setting falls back to USD 20. A tracker
that cannot be read leaves a label on that preview. The only refusal is the wallet form turning down an address that is
not a USDT address (TRON checksum, or the shape of a 0x address), because paying to a mistyped address loses the money.

## Not built, decide when needed

- Automatic cancel on a Stripe refund (today the team cancels it).
- A hold period before a commission is payable.
- Per-referrer or per-report commission amounts (today one number for everyone).
- Sending money from the site (deliberately not built).
- The privacy page ([server/legal/privacy.md](../server/legal/privacy.md)) should say that a referrer sees when, where (city) and how long a
  visitor read a preview they sent. The owner owns that text.
