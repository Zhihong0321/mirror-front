# Email, accounts and invoices

How the site sends email, how buyers sign in, and how an invoice reaches them. Code: [server/](../server).
Payment flow: [payments.md](payments.md). What the buyer sees after signing in: [dashboard.md](dashboard.md).

Decided 2026-11-11:

1. **Account = email.** No password. You sign in with a link sent to the email.
2. **A new link replaces the previous one.**
3. **Every purchase follows the email.** You sign in (or enter your email) before you pay. The order, the
   invoice and the report link all belong to that email.
4. **Billing and invoices are sent by email**, and are also kept in the account.

Mail goes out through **Mailjet** from `admin@mirrormirror.cloud` (domain `mirrormirror.cloud`; DKIM OK,
SPF record added 2026-11-11). Credentials are in the vault as `MAILJET_API_KEY` and `MAILJET_SECRET_KEY`.
This is the **transactional** mail of the site only. Cold marketing email to leads is a different job
(Smartlead, see business.md) and does not go through this code.

## The pieces

| File | Does |
|---|---|
| `server/mailer.js` | The one place that sends mail (Mailjet Send API v3.1). Never throws; logs every attempt |
| `server/emails.js` | The email templates (text and HTML). Add a new email here |
| `server/accounts.js` | Sign-in links, sessions, resend and abuse limits |
| `server/store.js` | The site's SQLite database: accounts, links, sessions, orders, mail log |
| `server/app.js` | The routes (below) |
| `server/pages.js` | The sign-in, account and invoice pages |

## Sign in (magic link)

```
/order  or  /login ── enter email ──▶ POST /login ── link emailed ──▶ GET /login/verify?token=…
                                                                         │ confirm page, button
                                       /account (or back to /order) ◀── POST /login/verify  (signs in)
```

- **One live link per email.** Asking for a new link replaces the old one; the old one then says it no longer works.
- **Single use, 15 minutes.** The link opens a confirm page first and only the **Continue** button signs
  in, so an email scanner that opens links cannot use it up.
- **Stored hashed.** The database keeps a SHA-256 of each link and session token, never the token.
- **Session:** cookie `mm_session`, 30 days, `HttpOnly`, `SameSite=Lax`, `Secure` on https.
- **Limits:** one new link per email per 30 seconds, 10 requests per visitor address per 10 minutes.
  Both show a plain message. They stop abuse of our sender reputation; they never block a sign-in that
  has a valid link.
- **Where it can send you:** `next` is only ever a path on this site (never `https://…` or `//…`).
- **The same page for any address.** The sign-in page does not say whether an email has an account.
  An account is created the first time its link is used.

## Buying

- `/order?dive=<id>` shows **Enter your email to pay** when signed out, and **Pay** when signed in.
- `POST /order/checkout` needs the session. It puts the email on the Stripe Checkout Session
  (`customer_email`, locked on Stripe's page) and in its metadata (`account_email`).
- After payment (webhook and return page, whichever is first) the server **records the order** once per
  Stripe session, gives it an invoice number `MM-<year>-<0001>`, **emails the invoice** once, and **emails a
  sign-in link** once (kind `payment-signin`). The sign-in link opens `/account`, where the buyer sees the report
  and its status.
- The sign-in link after payment is made like any other link (single use, 15 minutes, replaces an earlier link
  for the same email). It is not held back by the 30-second rule, because a payment is not a sign-in request.
  After it expires the buyer asks for a new one at `/login`.
- Both emails are tried again on every later Stripe notification until they go out (`orders.invoice_emailed_at`,
  `orders.signin_emailed_at`). The report still starts whatever the mail does.

## The invoice email

Sent to the account email: invoice number, date, item, total, the report link and links to the account and
the printed invoice (`/account/invoices/<id>`, shown only to the email it belongs to; use the browser's
Print for a PDF). The seller lines come from `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS` and
`INVOICE_NOTE`. **Fill them in once the company behind MirrorMirror is decided** (business.md). No tax
line yet: add one when the entity's tax status is known.

## When email fails (nothing is blocked)

- Every email attempt is a row in `mail_log` (`sent`, `failed` with the error, or `dry-run`).
- **Sign-in email fails:** the visitor is told, and can try again at once (no 30 second wait).
- **Invoice email fails:** the report still starts, the order is still recorded, the done page says
  "we could not email your invoice", and the account page has **Email it to me**. Every later Stripe
  notification for that order tries again until it goes out.
- **No email on a paid order** (old checkout sessions): the order is recorded and the problem is logged.
- Missing Mailjet keys do not stop the server. It logs a warning and every email is logged as failed.

## Settings

| Setting | Value |
|---|---|
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | Vault entries of the same names |
| `MAIL_FROM`, `MAIL_FROM_NAME` | `admin@mirrormirror.cloud`, `MirrorMirror`. The sender must be active in Mailjet |
| `MAIL_DRY_RUN` | `1` prints each email, including its sign-in link, to the server log instead of sending. Local only |
| `DATA_DIR` | Folder for the database file `mirrormirror.db`. **On Railway this must be a mounted volume** |
| `PUBLIC_URL` | `https://mirrormirror.cloud`. Links in emails are built from it. Without it they use the request address |
| `INVOICE_SELLER_NAME`, `_ADDRESS`, `INVOICE_NOTE` | Printed on invoices |

## Before it goes live (not done yet)

1. **Give the Railway service `web` a volume** and set `DATA_DIR` to its mount path. Without a volume the
   database is wiped on every deploy: accounts, orders and the mail log. Railway mounts volumes as root,
   and the image runs as `node`, so also set `RAILWAY_RUN_UID=0` on the service (or the database cannot be written).
2. Set on the service: `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAIL_FROM`, `PUBLIC_URL`.
3. Attach `mirrormirror.cloud` to the service (the emailed links point at `PUBLIC_URL`), and update the
   Stripe webhook URL if the address changes.
4. Check Mailjet shows SPF OK for `mirrormirror.cloud` (it showed "Not found" right after the record was
   added: Mailjet's own cache).
5. Fill in the invoice seller lines.
6. Orders paid before this change are not in the database. Stripe's Payments page is still their record.

## Run and test locally

```
cd server
npm test                       # sign-in, replace, expiry, invoices, failures; fake Mailjet, nothing leaves the machine
MAIL_DRY_RUN=1 npm run dev     # the sign-in link is printed in the server log
```

Checked on 2026-11-11: a sign-in email and an invoice email sent through the real Mailjet API from
`admin@mirrormirror.cloud` were accepted, and the whole sign-in flow was walked in a browser.

## Not built yet

- An admin view of the mail log (the `mail_log` table has it; no page yet).
- Emails for a failed or finished report ("your report is ready"). The hub does not call back yet.
- Refund and credit-note emails (refunds are made by hand in Stripe).
- Unsubscribe handling: not needed for sign-in and invoice mail; **needed** before any marketing mail.

## Team pages: users (2026-11-12)

Opened with the office key (`OFFICE_KEY`). Read only: nothing here changes or removes an account.

| Page | Shows |
|---|---|
| `/myoffice/users` | Every account, most recently active first: signup, last sign-in, preview requests (and how many are waiting), orders and money paid, page views while signed in. Search by email |
| `/myoffice/users/one?email=` | One account: its preview requests (with preview and tracker-log links), orders and invoices, every email sent to it, signed-in devices, and its visits. The visits include those from the same browser before the person signed in |

Not built: blocking or deleting an account, signing someone out everywhere, roles.
