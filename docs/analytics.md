# Visitor analytics

Built into the website server. There is no third-party service, and the data stays in the site's own SQLite file
(`DATA_DIR/mirrormirror.db`, table `visits`). Owner decision 2026-11-12: record IP, location, device and time on page.

## What is recorded

One row per HTML page the server sends:

| Field | From |
|---|---|
| Time, page (path + query, secrets hidden), title | the request, the page |
| IP | `x-forwarded-for` (Railway puts the visitor first) |
| Country, region, city, lat/lon | local GeoIP file, DB-IP City Lite (`server/geo/dbip-city.mmdb`) |
| Browser, OS, device (desktop / mobile / tablet / bot) | the user agent (raw string kept too) |
| Referrer and its host | the `Referer` header |
| Signed-in account | the session cookie, if any |
| Screen, language, time zone, visitor id, scroll depth | the page's beacon |
| Time on page (visible time only) | the page's beacon |

- **Two steps.** (1) The server records the view as it sends the page, so a visitor whose browser runs no script
  is still counted. (2) A small inline script (added before `</body>`) posts to `POST /api/v` on load and when the
  page is hidden or closed. The row then gets the screen size, the time on page, and a visitor id kept in
  `localStorage` (`mm_vid`), which groups one browser's visits.
- **Labelled, never dropped.** Bots are recorded with `device = bot`. A view whose script never reported back shows
  "no script". Nothing in this code can stop or change a page except adding the script. Every step is wrapped, and a
  problem is logged.
- **Not recorded:** `/myoffice/*`, `/api/*`, the sandboxed report frame `/r/<id>/raw`.
- **Recorded but not changed:** the stored full report and the factory's preview are sent exactly as stored
  (report-display.md), so they get no script. Their views are counted, but their time on page is not measured.
- **Secrets:** query keys that look like `token`, `key`, `secret`, `session`, `code`, `sig`, `password` are stored
  as `(hidden)`.

## Team pages

These use the office key, `OFFICE_KEY`. Each one lets you choose the period (24h to all
time) and hide bots.

| Page | Shows |
|---|---|
| `/myoffice/visitors` | Overview: totals, top pages, referrers, countries, cities, devices, OS and browsers, then the whole visit log. Click an IP or a visitor id to see only those rows |
| `/myoffice/visitors/pages` | One row per page: views, visitors, average time, total time, average scroll, last view. Each row links to that page's tracker log |
| `/myoffice/visitors/previews` | **Every free preview report** (from the report database), viewed or not. Each has its own tracker log |
| `/myoffice/visitors/page?key=/p/<report id>` | **One page's own tracker log**: the company name, its totals, the people who viewed it (visitor, IP, location, device, views, total time, furthest scroll, first and last view), where they came from, and every view |

The free-previews list at `/myoffice/reports/previews` also has a Visitors column ("3 views · 2 visitors" or "Not viewed
yet") that links to each preview's tracker log.

- **One key per page:** `page_key` is the path without its query or a trailing slash, with report ids in lower case.
  So `/p/<id>?ref=x` and `/P/<ID>/` both count toward the same preview.
- **Every status counts:** a preview link opened before the preview is written (the 404 "Preview on its way" page)
  is still recorded, labelled with its status. Icon or image requests that get an HTML error page are not page views
  and are not recorded.
- **Scroll depth:** the furthest point down the page the visitor reached, in %. Scrolling back up never lowers it.

Times are shown in `ANALYTICS_TZ` (default `Asia/Kuala_Lumpur`).

## GeoIP file

- `node server/geo-fetch.js` downloads the current month's DB-IP City Lite file (about 60 MB download, 127 MB on
  disk) to `server/geo/`. The Docker build runs it, so each deploy gets a fresh file. `GEOIP_DB` overrides the path.
- The file is read into memory at start (about 130 MB of RAM). If the file is missing, locations are empty and
  everything else works.
- Licence CC BY 4.0: the team page credits DB-IP.

## Privacy

An IP address is personal data under Malaysia's PDPA (and the EU's GDPR). The site's privacy notice should say that
visits are logged with IP, approximate location and device, for analytics. Nothing deletes old rows yet. Add a
retention rule if one is decided.
