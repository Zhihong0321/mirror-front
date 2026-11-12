# Website guide

How the MirrorMirror website is built around the pipeline. Read [pipeline.md](pipeline.md) for what the
pipeline does and [business.md](business.md) for why.

The website does four things:

1. **Admin panel**: the team's control room. Start jobs, follow them, open their reports.
2. **Calls the hub API** to start a company dive or a dive-deeper (full report) job.
3. **Shows the reports** the pipeline generates: company dive, preview, full report.
4. **Finds leads** with the country industry tool: every business of one industry in one country, with
   the contacts from their websites, ready to become company dives (section 6).

The pipeline itself never moves here. It runs in the hub (`automation-tools`, Railway service `ee-auto`).

## 1. How the pieces connect

```
 Browser (admin)                MirrorMirror server              Hub (ee-auto)
 ───────────────                ───────────────────              ─────────────
 Admin panel  ── login ──────▶  /myoffice/*  (own login)
              ── action ─────▶  /myoffice/api/*  ── Bearer LAB_TOKEN ──▶  /api/company-dive
                                                                  ──▶  /api/dive-deeper
                                                                  ──▶  /api/jobs (country.industry leads)
                                                                         └─▶ local worker does the search
 Client       ── opens link ─▶  /report/... (proxy or redirect) ────▶  /d/  /dp/  /dd/  (public, no token)
```

**Rule: the browser never talks to the hub API directly.** The hub token can start paid work, so it
lives only on the MirrorMirror server, which calls the hub on the admin's behalf. Public report pages
need no token and can be linked or proxied.

## 2. The hub

| | |
|---|---|
| Base URL | `https://ee-auto.up.railway.app` |
| Auth | `Authorization: Bearer <LAB_TOKEN>` |
| Token in the vault | `EE_AUTO_LAB_TOKEN` in `D:\Tools\my-vault\vault.json` |
| Website server setting | `HUB_URL`, `HUB_TOKEN` (environment variables, never in code or git) |

Which token works where:

| Route | `LAB_TOKEN` | `PORTAL_TOKEN` |
|---|---|---|
| `/api/company-dive*` | yes | yes |
| `/api/dive-deeper*` | yes | **no** |
| `/api/jobs*` (country industry leads) | yes | **no** |

So the website server uses **`LAB_TOKEN`**. (If a narrower token is wanted later, `/api/dive-deeper`
has to be added to the portal routes in `agy-lab/src/server.ts` `authorized()`. That is a hub change.)

## 3. Starting jobs

### Company dive (free research, step 1)

```
POST /api/company-dive
{ "company": "Eternalgy Sdn Bhd", "country": "Malaysia", "people": true }
```

- `company`: 2 to 200 characters. Required.
- `country`: defaults to `Malaysia`.
- `people`: default `true`; `false` skips the people step.

Reply `202`:

```json
{ "id": 42, "public_id": "…", "status": "queued", "queued_behind_another": false,
  "report_url": "https://ee-auto.up.railway.app/d/…", "api_url": "…/api/company-dive/42",
  "expected_minutes": "5-10" }
```

The hub runs **one company dive at a time**. `queued_behind_another: true` means it waits its turn.
When it finishes, the hub writes its **preview** by itself within about 2 minutes (`/dp/<same public_id>`).

### Full report (paid, step 3)

Start it **after payment**, on the company dive the client saw:

```
POST /api/dive-deeper
{ "dive_id": 42 }
```

Or start everything from a name (it starts a fresh company dive first, country Malaysia):

```
POST /api/dive-deeper
{ "company": "Eternalgy Sdn Bhd" }
```

Reply `202`:

```json
{ "id": 7, "public_id": "…", "company": "…", "dive_id": 42, "status": "queued",
  "report_url": "…/dd/…" }
```

Always prefer `dive_id`: it reuses the research the client already saw and costs nothing twice.
Full reports also run one at a time, on their own queue.

### Retry a failed full report

```
POST /api/dive-deeper/7/retry
```

Only for status `failed` (else `409`). It reuses the company dive if that finished, otherwise starts a new one.

### Errors to show the admin

| Code | Meaning |
|---|---|
| 400 | `company is required` (missing or wrong length) |
| 401 | Wrong or missing token |
| 404 | No such dive / run |
| 409 | Retry on a run that is not failed |
| 502 | The hub could not start the company dive behind a full report |
| 503 | Hub has no report database, or no search key (`BRAVE_API_KEYS`) |

## 4. Following jobs

| Call | Gives |
|---|---|
| `GET /api/dive-deeper/pipeline` | **The admin home list.** Up to 200 companies, newest first: company dive status, preview status and link, full report status and link |
| `GET /api/company-dive` | Last 50 company dives with status, call counts and links |
| `GET /api/company-dive/:id` | One dive in full: live log, stage, result, dossier, sources |
| `GET /api/dive-deeper` | Last 200 full-report runs, plus how many are active and queued |
| `GET /api/dive-deeper/:id` | One run: stage, log, each lane's status, findings and warnings |

Statuses:

| Job | Statuses |
|---|---|
| Company dive | `queued` → `running` → `done` / `partial` / `failed` |
| Preview (from `/pipeline`) | `no dive yet`, `waiting`, `writing`, `ready`, `ready, fallback wording` |
| Full report | `queued` → `waiting_dive` → `running` → `done` / `partial` / `failed` |

`partial` is a finished report: one or more sections fell back. The pipeline never aborts on a weak
section (no kill gates), so treat `partial` as deliverable.

Jobs take minutes (company dive 5–10, full report longer). **Poll** the status every 15–30 seconds while
an admin page is open. Do not hold a request open waiting.

## 5. Reports

Every report has a public page on the hub. The long random id in the link is the permission. No token,
and the pages tell search engines not to index them.

| Report | Hub link | Data |
|---|---|---|
| Company dive | `/d/<dive public_id>` | `/d/<dive public_id>/data` (JSON: status, log, dossier, identity, cited sources, people) |
| Free preview | `/dp/<dive public_id>` | HTML only |
| Full report | `/dd/<run public_id>` | HTML only (desktop, mobile and A4 print in one page) |

While a job runs, these pages show live progress and refresh themselves. So a link can be sent the
moment a job starts.

**How the website shows them**, two options:

- **Link (start here).** The admin panel opens the hub link. Simple, but the client sees the
  `ee-auto.up.railway.app` address.
- **Proxy under the MirrorMirror domain (for clients).** The website serves
  `mirrormirror.cloud/r/<public_id>` (full report) and `/p/<public_id>` (preview), fetching the hub page
  server side and passing it through. The client only ever sees MirrorMirror. Pass `no-store` and
  `noindex` through as the hub sends them.

The newer **v21 reports** (company-diver, tables `v21_*`) are shown differently: the site reads them from
Postgres itself, preview at `/p/<report_id>` and full report at `/r/<report_id>` behind a payment check. See
[report-display.md](report-display.md).

Full reports are redrawn from stored results on every visit, so report fixes in the hub reach links
already sent. Never cache or copy report HTML into the website.

## 6. Lead generation: country industry research

The hub's tool at `https://ee-auto.up.railway.app/country-industry` finds **every business of one
industry in one country** on Google Maps, reads their websites for published contacts, and returns a
CSV. In MirrorMirror it is the **top of the funnel**: it fills the list of companies to dive on.

```
Country + industry  ──▶  lead list (CSV)  ──▶  admin picks companies  ──▶  company dive  ──▶  preview link sent
"Malaysia" + "Advertising agency"                                      POST /api/company-dive
```

### Where it runs

- Code: hub page `agy-lab/src/country-industry-page.ts`, CSV helpers `agy-lab/src/country-industry-csv.js`,
  hub doc `docs/country-industry.md` (all in `automation-tools`).
- The research itself runs on a **local worker** (the separate `local-worker` checkout), not on the hub.
  A worker with `WORKER_TYPES=country.industry` must be online, or jobs wait in the queue.
- No LLM. Maps discovery, then deterministic website reading.
- It is a **generic hub job** (`/api/jobs`), not its own API. `LAB_TOKEN` only (not `PORTAL_TOKEN`).

### Start a search

```
POST /api/jobs
{ "type": "country.industry",
  "payload": { "country": "Malaysia", "industry": "Advertising agency" },
  "timeoutMs": 300000 }
```

- `country`: English country name, up to 120 characters. `industry`: keyword, up to 160.
- `timeoutMs: 300000` is the worker's lease (renewed by its heartbeat), not a limit on the whole search.
  Send it as the hub's page does.
- Reply: `{ "job": { "id": "<12 hex chars>", "status": "pending", … } }`.

### Follow it

| Call | Gives |
|---|---|
| `GET /api/jobs` | All hub jobs (filter `type === "country.industry"`) **and** the workers: `workers[]` with `name`, `status` (`online`), `types` |
| `GET /api/jobs/<id>` | `{ job }`: `status`, `worker`, `progress`, `result`, `error` |

- `status`: `pending` (waiting for a worker) → `running` → `done` / `failed`.
- `progress.phase`: `maps` (finding listings), then `contacts` (reading websites), each with
  `completed` / `total`. Show them as two progress bars.
- Poll every 5–10 seconds while the page is open. Large countries take a long time.
- Show "No country worker online, the job will wait" when no online worker lists `country.industry`.

### The result

When `done`, `job.result` holds:

| Field | |
|---|---|
| `csv` | The whole CSV as text (can be several MB; up to the hub's 32 MB result limit) |
| `filename` | Suggested download name |
| `summary` | `processed`, `withEmail`, `failed` (website checks), `possibleLimits` (searches Maps may have capped) |
| `imported` | `true` when it reused saved research instead of searching again |

A **qualified lead** is a row with `name`, a reachable `website`, at least one `emails`, and
`research_status` of `ok` or `partial` (rule from `countQualifiedLeads`). Show that count first.

Google Maps can return capped, incomplete or unrelated listings, and contacts come from public pages.
Say so on the page, and let the admin check rows before using them.

### What the website adds on top of the hub page

The hub page only searches and downloads. MirrorMirror makes it a lead tool:

1. **Lead list view**: the CSV as a table: search, "has email" filter, paging (50 rows), download.
2. **Pick and dive**: tick companies → one `POST /api/company-dive` each (`company` = the row's `name`,
   `country` = the search's country). The hub runs dives one at a time, so many picks simply queue.
   Mark rows already dived (match by name against `GET /api/dive-deeper/pipeline`) so nobody pays twice.
3. **Send the preview**: once a dive's preview is `ready`, its `/dp/` link and the row's email sit side
   by side for outreach. (Sending itself is not built; see section 10.)
4. **Saved searches**: keep the job ids. Results stay on the hub (`/data` volume on Railway), so the
   list can be reopened later with `GET /api/jobs/<id>`.

## 7. Admin panel

Behind its own login (admins only). The hub token stays on the server.

| Page | Does | Hub calls |
|---|---|---|
| **Find leads** | Country + industry search, worker status, progress, saved searches | `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id` |
| **Lead list** | One search's CSV as a table; qualified count; pick companies and start dives | `GET /api/jobs/:id`, `POST /api/company-dive` |
| **Companies** (home) | One row per company: company dive, preview, full report, each with status and link | `GET /api/dive-deeper/pipeline` |
| **New company dive** | Form: company, country, people on/off | `POST /api/company-dive` |
| **Company detail** | Dive log and result; preview link; "Start full report" button; full report status and lanes | `GET /api/company-dive/:id`, `GET /api/dive-deeper/:id` |
| **Start full report** | Confirm and start on this dive (after payment) | `POST /api/dive-deeper {dive_id}` |
| **Runs** | All full-report runs, queue size, retry for failed ones | `GET /api/dive-deeper`, `POST /api/dive-deeper/:id/retry` |

Things the admin panel must make hard to do by mistake:
- **Starting a full report costs real money.** Confirm first, and prefer the button on a company's row
  (uses its `dive_id`) over a free-text name.
- **Double starts.** Disable the button once clicked; check `/pipeline` for a run already on that dive.

## 8. Website server settings

| Setting | Value |
|---|---|
| `HUB_URL` | `https://ee-auto.up.railway.app` |
| `HUB_TOKEN` | the hub `LAB_TOKEN` (from the vault, `EE_AUTO_LAB_TOKEN`) |
| Admin login | the website's own users; not the hub token |
| Stripe settings | see [payments.md](payments.md) |

## 9. Settings on the hub side (not in this repo)

Set on Railway service `ee-auto`, they change what the hub pages show:

| Hub setting | Effect |
|---|---|
| `DIVE_DEEPER_ENABLED` | Must be on for previews, full reports and `/api/dive-deeper` |
| `DD_PREVIEW_AUTO` | `off` stops previews writing themselves (then written on first open) |
| `DD_PREVIEW_PRICE` | Price on the preview's order panel, e.g. `RM 990` |
| `DD_PREVIEW_CONTACT` | How to order, shown on the preview |
| `DD_PREVIEW_ORDER_URL` | Order or payment page the preview links to: `<site>/order` (see [payments.md](payments.md)) |

## 10. Not covered yet

- Payment: built with Stripe, see [payments.md](payments.md).
- Reports still carry the hub's own look and wording; rebranding them as MirrorMirror is a hub change
  (`agy-lab/src/divedeeper/report-html.ts`, `preview-html.ts`, `companydive-report.ts`).
- Client accounts: built for buyers (email sign-in, their orders and invoices, see [email.md](email.md)). Not built: a client seeing a live list of their reports beyond the links.
- Sending the preview to a lead (email or WhatsApp outreach). The lead list only puts the email and the
  preview link side by side.
- The full CSV column list of country industry results is set by the worker (`local-worker`); read the
  header row of a real result rather than hard-coding columns beyond `name`, `website`, `emails`,
  `research_status`.
