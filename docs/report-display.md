# Showing company-diver reports

Recorded 2026-11-11 from `G:\company-diver\docs\public-site-display-prompt.md` (the report factory's own brief
for this site). **company-diver** writes the reports; this site only shows them. Code: [server/reports.js](../server/reports.js),
[server/reportdb.js](../server/reportdb.js), [server/report-pages.js](../server/report-pages.js).
Tests: [server/test/reports.test.js](../server/test/reports.test.js).

This is the **v21 pipeline** (tables `v21_*`), newer than the hub's `/dp` and `/dd` pages described in
[pipeline.md](pipeline.md). The two exist side by side until checkout moves over (see "Not done yet").

## Two reports, two ways to show them

| | Free preview | Full report ($59, after payment) |
|---|---|---|
| What it is | The bait page: proves the problems are real, keeps the answers back | The complete deeper report |
| Who may see it | Anyone with the link | Anyone with the link (owner, 2026-11-12: no payment check in this code; the site's own auth rules go on top) |
| Where it lives | Not stored as a page. Drawn from the `v21_raw` rows | One finished, self-contained HTML page in Postgres: `v21_deeper_run.report_html` |
| Site route | `GET /p/{report_id}` | `GET /r/{report_id}` |
| How it is shown | Drawn by the site itself with `server/preview-template/` (exported from company-diver), see below; falls back to the factory page `GET <REPORT_HUB_URL>/v21/r/{report_id}` | `report_html` returned as stored |

`report_id` is a UUID (`v21_report.report_id`, stored as text). Never re-implement the preview page: the factory
draws it (`agy-lab/src/v21/step3.ts`, `reportPage`) and its wording changes often.

## Full report: which run is shown

Newest run of the report wins (`v21_deeper_run`, newest `created_at`). Decided by `chooseView` in `reports.js`:

| Newest run | Shown |
|---|---|
| `done`, page stored | The stored page, exactly as stored, alone (`text/html`, noindex, `private, no-store`) |
| `incomplete`, page stored | The page in a frame, label above: "Some parts of this report could not be completed." |
| `queued` / `running`, no page | Progress page, refreshes every 20 s, shows `stage` |
| `failed`, no page | "Something went wrong with your report. We are looking into it." The raw `error` is never shown. The server logs an `ALERT` line |
| No run | "Your report has not started yet." |
| Newer run failed or running, an older run has a page | The older page, in a frame, with a note |
| Unknown status | A page if one is stored (labelled with the status), else the progress page with the status named |
| Database cannot be read | "We cannot load your report right now", refreshes, 503. Nothing crashes |

The stored page is never parsed, stripped or restyled. A label needs a frame: `/r/{id}` returns a wrapper with
the label and an `<iframe>` whose source is `/r/{id}/raw?run={run_id}`. The brief asks for
`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` on the frame. The site sends the same
rules as a `Content-Security-Policy: sandbox …` header on the `/raw` response instead, because the browser then
enforces them on the page itself (also when opened directly), and the in-app browser pane refused to load a
frame with an opaque-origin `sandbox` attribute (`ERR_BLOCKED_BY_CLIENT`). The raw route has the same payment
check and only serves a run of that report.

## The payment gate (REMOVED 2026-11-12)

The owner made `/r/{id}` and `/r/{id}/raw` public: no sign-in, no order check. The text below is the old rule, kept for history. The site's own auth rules are the owner's to add on top.

### Old rule

The factory has no payment code. Before any `report_html` leaves, the signed-in account must own an order for
that `report_id`. Not signed in: redirect to `/login?next=/r/{id}`. Signed in without an order: 403, no database
read. A hard-to-guess UUID is not a permission. The site's `orders` table has a `report_id` column for this
(`store.hasReportOrder`); the account page links each such order to `/r/{report_id}`.

## Ordering a report (checkout keyed on `report_id`)

Decided 2026-11-11. Code: `orderReportPage`, `checkoutReport`, `fulfil` in `server/app.js`; `server/factory.js`.

```
/order?report=<uuid>  (or ?preview=<any link holding the uuid>)   company read from v21_report
  -> sign in (email link) -> POST /order/checkout {report}        Stripe metadata: report_id, company, account_email
  -> paid: webhook and /order/done both call fulfil (safe to repeat, one at a time per report)
       -> factory.startReport(report_id)
       -> order recorded with report_id and report_url = <site>/r/<report_id>; invoice emailed; sign-in link emailed
  -> buyer opens /r/<report_id> (public: no check), or signs in to /account and sees the report's status
```

The report takes about 120 minutes (`REPORT_MINUTES`). The order page, the done page, the progress page and the
dashboard say so. The sign-in link is described in [email.md](email.md).

- **Start a run:** `POST <REPORT_HUB_URL>/api/v21/deeper {"report_id"}` with the operator token
  (`REPORT_HUB_TOKEN`, else `HUB_TOKEN`), answer `202 {run_id}`. **The factory does not check for an existing
  run: every POST makes a new, paid run.** So the site reads the report's runs first (`reportdb.runs`) and posts
  only when none exists that has not failed. Queued, running, done, incomplete and even unknown statuses all
  count as "exists". Only `failed` allows a new start (the same rule the hub flow uses).
- **Never lost, never doubled:** if the runs cannot be read or the factory refuses, the webhook answers 500 and
  Stripe retries. The order is recorded only after the start succeeds.
- **Already bought:** the order page and checkout send an account that owns the report straight to `/r/<id>`.
- **Dry run:** `HUB_DRY_RUN=1` logs the run it would start and starts nothing. The order is still recorded.
- Not gated on the factory's `step2_status`: the order page only needs the `v21_report` row. The preview itself
  (`/p/`) is the factory's page, and shows "being prepared" until it exists.
- The older hub flow (`/order?dive=<id>`, [payments.md](payments.md)) still works beside it.

## What is read, and what never is

- **Read only.** Every query is a `select`, and the connection is opened with `default_transaction_read_only=on`, so
  even a full-access login cannot change a `v21_` table from this site. Use a read-only Postgres user anyway.
- By `report_id` only. Never list or scan tables to find reports.
- Used: `v21_report` (`company`, `country`, `industry`, `website`, `created_at`) for the title; `v21_deeper_run`
  (`run_id`, `status`, `stage`, `created_at`, `finished_at`, `report_html`) for the report.
- `report_html` can be several MB. It is read alone, for one run, only when about to be shown, never in the run list.
- **Never read or show:** `v21_raw`, `v21_deeper_lane`, `v21_deeper_run.log`, `.error`, `.blocked_html`,
  `.gate_failures`, or any cost data.
- Price, if ever shown: `select value from hub_setting where key = 'full_report_price'` (USD, `59` = $59). Not
  hard-coded, and not shown by these pages yet (Stripe charges `PRICE_CENTS`).

## Never hide a report

Anything odd is shown with a plain label. No page returns an error where a report exists. There is no deliberate refusal any more: the payment check was removed on 2026-11-12.

## Settings

| Setting | Value |
|---|---|
| `REPORT_DB_URL` | Postgres URL of the company-diver database, read-only login. Without it `/r/` pages say the report cannot be loaded |
| `REPORT_HUB_URL` | The factory's public address, for the preview and to start runs. **Ask the owner; do not guess; not the old `ee-auto.up.railway.app`.** Without it `/p/` shows "being prepared" and a paid order cannot start its run (the webhook answers 500 until it is set) |
| `REPORT_HUB_TOKEN` | The factory's operator token (`LAB_TOKEN` on the factory). Empty = `HUB_TOKEN`. Server side only |

## Not done yet

- **The preview's order button** goes to `<site>/order?report=<uuid>`: `reports.js` passes that link to the template
  (`orderUrl`), so checkout is keyed on the report. If the site falls back to the factory's own preview page instead,
  that page's order line is the factory's and is not checked here.
- Checkout and the paid start were tested with a fake Stripe and a fake factory only. No real run was started.
- Not checked against the live database: the vault's pg-proxy token was rejected (401) on 2026-11-11, so the
  table shape was checked against the factory's source (`v21-store.ts`, `divedeeper/v21/store.ts`) instead.
- Proof list from the brief, still to run on a real `report_id` (one with a finished full report): preview loads
  through the site; stored HTML shows with working copy buttons and table of contents; `incomplete`, `running`,
  `failed` pages; a non-buyer is refused; phone width. The tests cover the logic with a fake database.
