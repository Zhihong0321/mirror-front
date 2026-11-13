# Payments (Stripe)

How a buyer pays for the full report, and how the payment starts it on the hub. Code: [server/](../server).
Why it is sold this way: [business.md](business.md). The hub API it calls: [website-guide.md](website-guide.md).

> A second order flow, keyed on a company-diver `report_id` (`/order?report=<uuid>`), starts the full report on the
> report factory instead of the hub. See [report-display.md](report-display.md). The rest of this page describes the
> hub flow (`/order?dive=<id>`); settings and Stripe setup are shared.

## The flow

```
 Free preview (/dp/<id>)         MirrorMirror server                     Stripe              Hub (ee-auto)
 ───────────────────────         ───────────────────                     ──────              ─────────────
 "Order" button ──────────────▶  GET  /order?dive=<id>   order page
                                 POST /order/checkout    ── create Checkout Session ──▶  hosted pay page
                                                                                          │ paid
                                 POST /stripe/webhook  ◀── checkout.session.completed ────┤
                                   └─ start full report ─────────────────────────────────────────▶ POST /api/dive-deeper {dive_id}
                                 GET  /order/done?session_id=…  ◀── buyer sent back ──────┘
                                   └─ same start (safe to repeat), then shows the /dd/ report link
```

- **Which company.** The order page takes the preview's public id (`?dive=<id>`), or a pasted preview link
  (`?preview=<url>`). The server finds the company with `GET /api/dive-deeper/pipeline` (the newest 200
  companies) and only sells it once its company dive is `done` or `partial`.
- **What Stripe carries.** The Checkout Session (and its payment) holds `dive_id`, `dive_public_id` and
  `company` in its metadata, and `client_reference_id` = the preview id. That is how the payment finds
  the company again.
- **Starting the report.** Both the webhook and the return page start it, whichever arrives first. The
  start is safe to repeat: calls for one company run one after another, a report that already exists
  (not `failed`) is reused, and a `failed` one is retried with `POST /api/dive-deeper/<run>/retry`.
  If the hub cannot be reached, the webhook answers 500 and Stripe retries it.
- **Delivery.** The return page shows the `/dd/` link. It works at once: the page shows progress and fills
  in by itself. We also **email the invoice and the report link** to the buyer's account email
  ([email.md](email.md)). A buyer signs in with their email (no password) before paying, so every order
  belongs to an email. After payment we also **email a sign-in link** to that address, so the buyer can open
  their account (the report's progress and status) from any device.
- **Time.** A full report takes about **120 minutes** (`REPORT_MINUTES` in `server/emails.js`). The order page,
  the done page, the progress page, the invoice and the sign-in email all say so; the account shows it under
  a report that is still being made.
- **Price.** `PRICE_CENTS` and `PRICE_CURRENCY` (USD 89 since 2026-11-13). Set inline on each Checkout Session, so no
  Stripe product or price has to be made first.

## Settings

All in the environment. Template: [server/.env.example](../server/.env.example).

| Setting | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Secret or restricted key. Test key until launch |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the webhook endpoint below |
| `STRIPE_ALLOW_LIVE` | `1` to accept a live key. Without it the server refuses to start with one |
| `HUB_URL`, `HUB_TOKEN` | The hub and its `LAB_TOKEN` (vault: `EE_AUTO_LAB_TOKEN`) |
| `HUB_DRY_RUN` | `1` logs the report it would start instead of starting it. A real run costs money |
| `PRICE_CENTS`, `PRICE_CURRENCY` | `8900`, `usd` |
| `PUBLIC_URL` | The site's address, for Stripe's return links. Empty = taken from the request |

A **restricted key** needs only **Checkout Sessions: Write**. Webhook signatures are checked with the
signing secret, not the key.

## Stripe Dashboard setup

1. **Webhook endpoint** (Developers → Webhooks → Add endpoint), once per mode (test and live):
   - URL: `<PUBLIC_URL>/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   - Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
2. **Hub preview link.** Set the hub's `DD_PREVIEW_ORDER_URL` to `<PUBLIC_URL>/order` and `DD_PREVIEW_PRICE`
   to `USD 59`. Until the hub adds the preview's id to that link, the buyer pastes their preview link on
   the order page.
3. **Before live:** business details and statement descriptor, customer receipt emails on, and the terms,
   refund and privacy pages linked from the site.

## Where it runs (deployed 2026-10-30)

| | |
|---|---|
| Railway | project `mirrormirror`, service `web`, environment `production` |
| Address | `https://web-production-3e14a.up.railway.app` (order page: `/order`) |
| Build | [Dockerfile](../Dockerfile) at the repo root; [.railwayignore](../.railwayignore) uploads only `site/` and `server/` |
| Deploy | from `G:\mirrormirror`: `railway up --service web --ci` |
| Mode | **Stripe test mode, hub dry run** (`HUB_DRY_RUN=1`): paid test orders log the report they would start |
| Stripe webhook (test) | `we_1UWIAyHPtEGDtG3AcMxIErbh` → `/stripe/webhook`; signing secret in the vault as `STRIPE_TEST_WEBHOOK_SECRET` |
| Vault | `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`; the hub token is `EE_AUTO_LAB_TOKEN` |

Checked on 2026-10-30: a test payment of USD 59 on Eternalgy (dive #4) went through Stripe Checkout, Stripe
delivered `checkout.session.completed` to the Railway server, the signature checked out, and the server
reused the existing report (#2) instead of starting another.

### Going live

1. Replace the live key that was pasted in chat (Dashboard → Developers → API keys), and put the new one
   in the vault as `STRIPE_LIVE_SECRET_KEY` (or a restricted key with Checkout Sessions: Write).
2. In live mode, add the webhook endpoint (same URL and events) and vault its secret as
   `STRIPE_LIVE_WEBHOOK_SECRET`.
3. Set the public business name (it shows "GAN ZHI HONG" today) and the card statement name.
4. On the `web` service: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` to the live values,
   `STRIPE_ALLOW_LIVE=1`, `HUB_DRY_RUN=0`, and `PUBLIC_URL` to the final domain once it is attached.
5. Point the hub's `DD_PREVIEW_ORDER_URL` at `<PUBLIC_URL>/order`.

## Running it locally

```
cd server
npm install
npm test              # the whole order flow with a fake Stripe and a fake hub; nothing leaves the machine
cp .env.example .env  # fill in test values
npm run dev           # http://localhost:8080/order
```

To receive test webhooks on a local machine, use the Stripe CLI:
`stripe listen --forward-to localhost:8080/stripe/webhook` (it prints the `whsec_` to use), or deploy
and point a test-mode endpoint at the deployed URL.

Test card: `4242 4242 4242 4242`, any future date, any CVC.

## Not covered yet

- The hub's preview links to one fixed order URL. It should add the preview's id (`?dive=<id>`) so the
  buyer lands on the right company. That is a hub change (`agy-lab/src/divedeeper/preview-html.ts`).
- Companies older than the newest 200 are not found (`/api/dive-deeper/pipeline` returns 200).
- When the buyer is not the company in the report, exposed personal data must be kept out of what they see
  (business.md). The report does not do that yet.
- Refunds are made by hand in the Stripe Dashboard. They do not stop a report.
- Orders are now also kept in the site's own database (see [email.md](email.md)), but only from the
  first payment after that change; earlier ones are in Stripe's Payments page only.
