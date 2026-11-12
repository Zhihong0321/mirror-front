# The dashboard (`/account`)

What a signed-in buyer sees. Sign-in itself is in [email.md](email.md); reports in [report-display.md](report-display.md).
Code: [server/dashboard.js](../server/dashboard.js) (the page), [server/app.js](../server/app.js) (routes),
[server/store.js](../server/store.js) (`preview_requests`, `orders`).

## What is on it

1. **Three steps**: get a free preview, read what we found, unlock the full report. Each shows done / next.
2. **Get a free preview**: company name, who it is for (my company / a competitor / a supplier), country,
   website (optional). Plus "Already have a preview link?" for links sent by email.
3. **Your free previews**: each request, *We are preparing it* until it is ready, then **Open preview**.
4. **Your full reports**: each paid order with its state (*Ready*, *Being prepared*, *Problem: we are looking
   into it*, *Not started yet*), **Open report**, **Invoice**, **Email it to me**. A report still being made also
   shows *Takes about 120 minutes from payment* and how long ago it was paid.

The landing page's "Get my free preview" forms send people here (`/account?company=…&who=…`). A signed-out
visitor signs in by email first and lands on the dashboard with the company already filled in.

## Free preview requests

```
dashboard form ──▶ POST /account/previews ── saved ──▶ email to the buyer ("we are preparing it")
                                                  └──▶ email to PREVIEW_ALERT_EMAIL (the team: company, who, country, website)
   … the report factory (or you) makes the preview …
POST /api/previews/<id>/ready  {"report_id":"<uuid>"}  + Bearer PREVIEW_ADMIN_TOKEN
   └─▶ request becomes ready ──▶ email to the buyer with <PUBLIC_URL>/p/<report_id> ──▶ dashboard shows Open preview
```

- The request is saved **before** any email. If email fails the request still exists and is listed.
- Asking again for the same company while the first is open does nothing new (no second email).
- One account can have 10 previews waiting; the eleventh is told so.
- The ready call is safe to repeat: the buyer is emailed once. With no `PREVIEW_ADMIN_TOKEN` the endpoint answers 404.
- **Who runs the preview today is a person**: nothing starts the report factory's *preview* from this site yet. The
  factory's brief has no such call for the public site. Until there is one, the alert email is the trigger, and the
  team page (below) is where it is marked ready. `PREVIEW_ALERT_EMAIL` must be set or nobody hears about a request
  (the server logs it).
- The preview page itself (`/p/<report_id>`) is drawn by the factory and its own order button decides how the
  buyer pays. Checkout is not keyed on `report_id` yet (see "Not done yet" in report-display.md).

## Team page (`/myoffice/previews`)

For the people who make the previews. Every team page lives under `/myoffice` (owner decision 2026-11-12: not
`/admin`, which every scanner tries) and opens with one shared key, `OFFICE_KEY`, at `/myoffice/login`. A browser
without the key is sent to that page; an email account alone does not get in. The key sets an office cookie for 30
days, and changing `OFFICE_KEY` signs every office browser out. Ten wrong keys from one address means a 15-minute wait.
A browser in the office also gets **Office** buttons on the dashboard. The old `/admin` addresses are plain "not found".

- **Waiting**: every open request with company, who it is for, country, website and who asked. Paste the report id,
  or the whole preview link (`…/p/<id>`), and press **Mark ready and email buyer**.
- **Ready**: shows whether the buyer was emailed. If the email failed the row says *Buyer not emailed yet* and offers
  **Email again**; **Change report** swaps in a different report id (the buyer is emailed the new link, never the same one twice).
- **Recent email**: the last 25 emails the site tried to send, with the error for any that failed.
- Marking ready never waits on the email: the request is ready either way, and the page says if the email did not go.

## Bought reports and their state

State is read from the report database (`reports.js` `chooseView`), statuses only, never the page, at most 4 seconds,
at most 30 orders. If it cannot be read the row has no label and **Open report still works**. Orders made before
the report database was connected have no `report_id`; their row links to the hub report.

## Settings

| Setting | Value |
|---|---|
| `PREVIEW_ALERT_EMAIL` | Where a new request is announced |
| `PREVIEW_ADMIN_TOKEN` | Bearer token for `POST /api/previews/<id>/ready`. Vault: `MIRRORMIRROR_PREVIEW_ADMIN_TOKEN` |
| `OFFICE_KEY` | The office key for every `/myoffice` page. Empty = the office cannot be opened. Not in git, not in code |

## Not built yet

- Starting the preview automatically in the report factory (needs a call from the factory's side).
- Telling the buyer when their full report finishes (the report page shows its own progress today).
- Searching the older orders (hub dives) by status.

## Country choice (2026-11-12)

The homepage forms (hero and the bottom "Mirror, mirror, show me.") and the dashboard request form show a **country chip per
researched country**, plus **Other country**. The list is `RESEARCHED_COUNTRIES` in [server/countries.js](../server/countries.js):
the countries the report factory has a prompt catalog for (company-diver `agy-lab/src/v21/catalog.ts` `COUNTRY_MAP`, folders
`catalog-data/<CC>-<industry>/`): Malaysia, Singapore, Australia, South Korea. Add a country there when the factory gets one.
The homepage reads it from `GET /api/countries` and keeps the same four as a fallback inside `site/index.html`.
Any other country is still accepted and typed in the Other box: the factory researches it with its general checklist.
The chosen country is carried to the dashboard (`/account?company=&who=&country=`) and saved with the request (`preview_requests.country`).
