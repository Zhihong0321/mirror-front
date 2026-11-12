# The pipeline (lives in automation-tools, not here)

All research, AI and report building runs in **`E:\000\automation-tools`**
(GitHub `Zhihong0321/automation-tools`), inside the hub deployed on Railway (service `ee-auto`).
Every AI step uses DeepSeek (`deepseek-v4.1-flash-1017`). Nothing calls Claude or Gemini.

This folder only builds the website. It talks to the pipeline over HTTP.

## Three steps, plus the lead source in front

```
0. Leads (country industry)  ->  1. Company dive  ->  2. Preview (free)  ->  client pays  ->  3. Full report (paid)
   /api/jobs, CSV                   /d/<id>             /dp/<id>                               /dd/<id>
```

**0. Leads.** The country industry tool (`/country-industry` on the hub, job type `country.industry`)
finds every business of one industry in one country on Google Maps and reads their websites for
contacts. It runs on a local worker (`local-worker` checkout), not on the hub, and returns a CSV. Code:
`agy-lab/src/country-industry-page.ts`, `agy-lab/src/country-industry-csv.js`, doc `docs/country-industry.md`.
How the website uses it: [website-guide.md](website-guide.md) section 6.

| Step | What it does | Code (in automation-tools) | Stored in (Postgres) |
|---|---|---|---|
| 1. Company dive | Researches one company from public sources: identity, registration, people, cited facts, contradictions, gaps. Runs before anyone pays. | `agy-lab/src/companydive.ts` (+ `companydive-people.ts`, `companydive-report.ts`, `companydive-page.ts`) | `company_dive` |
| 2. Preview | One AI pass over a finished company dive writes a landing page for the owner: what we know, warning signs (most locked), and an order panel. Written automatically every 2 minutes for new dives. | `agy-lab/src/divedeeper.ts` (`previewSweep`, `handlePreview`), `agy-lab/src/divedeeper/preview-html.ts`, `preview-editor.ts` | `dive_preview` |
| 3. Full report | The dive-deeper run on the same company dive: stage 1 lanes, then advice, then editing, then one HTML report (desktop, mobile, A4). | `agy-lab/src/divedeeper.ts` (`execute`), `agy-lab/src/divedeeper/runner.ts`, `sections/*`, `report-html.ts` | `dive_deeper` (`lanes`, `report_html`) |

## Full report lanes (`agy-lab/src/divedeeper/sections/`)

| Lane | Chapter | What it checks |
|---|---|---|
| `H-plan`, `H-maps`, `H-web` | Search and Maps | Google Maps rank and web-search rank for "<trade> in <area>" in each town served; who sits above |
| `G-fixed`, `G-free`, `G-grounded` | AI assistants | What AI models say: a fixed question set, customer-voice prompts, and answers with web search |
| `E-maps`, `E-web` | Reputation | Google reviews and replies; complaints and mentions on the open web |
| `C-rules`, `C-llm`, `C-merged` | Your websites | Broken links, SSL, WhatsApp/phone links, legal details, grammar |
| `D-common`, `D-registry`, `D-web` | Licences and awards | Each claimed licence or award, checked in its official register or on the web |
| `S2-consult` | (stage 2) | Advice: fixes in order, 30-day plan, homepage copy, review replies, AI plan, FAQ |
| `S3-editor` | (stage 3) | Plain titles, verdict, the main stories, screenshots |

## API the website will use (hub, needs the hub token, server side only)

| Call | Use |
|---|---|
| `POST /api/company-dive` | Start a company dive for a prospect |
| `GET /api/dive-deeper/pipeline` | Every company with its dive, preview and report status and links |
| `POST /api/dive-deeper` `{"dive_id": n}` | Start the full report after payment (reuses the dive) |
| `GET /api/dive-deeper/:id` | One full-report run: status, stage, lane results |
| `POST /api/dive-deeper/:id/retry` | Retry a failed run |

Public pages (no token; the long random id is the permission; not indexed):
`/d/<public_id>` company dive, `/dp/<public_id>` preview, `/dd/<public_id>` full report.

Hub settings for the preview's order panel: `DD_PREVIEW_PRICE`, `DD_PREVIEW_CONTACT`,
`DD_PREVIEW_ORDER_URL`. Switches: `DIVE_DEEPER_ENABLED`, `DD_PREVIEW_AUTO`.

## Docs in automation-tools

- `docs/dive-deeper-business-model.md`: how the preview sells the full report
- `docs/dive-deeper-plan.md`: original plan, sections, testing method, hard rules
- `docs/dive-deeper-results.md`: test results per lane
- `docs/country-deeper-dive-plan.md`: planned split into one pipeline per country (`malaysia-deeper-dive` first). Planning only, not built.
- Samples: `docs/dive-preview-eternalgy.html`, `docs/dive-deeper-report-eternalgy.html`

## Rules that carry over

- Company dive is the bait and must never break. Dive-deeper never edits `companydive*` files or the `company_dive` table.
- No kill gates: a stage that fails falls back and the report ends `partial`; it never aborts.
- Personal data is a private warning, never bait.
