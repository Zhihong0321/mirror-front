# Standard footer and legal pages

Code: [server/legal.js](../server/legal.js). Text: [server/legal/](../server/legal) (markdown). Tests: [server/test/legal.test.js](../server/test/legal.test.js).

## Where the footer is

| Surface | How |
|---|---|
| Every server page (order, login, account, invoice, report status pages, office) | `page()` in `pages.js` adds `siteFooter()`. Pass `footer: false` to leave it off |
| Report preview page (`/p/`, from `preview-template/page.js`) | `legalrow` line in its own footer |
| Report frame (`reportFrame` in `report-pages.js`) | slim `legalbar` under the frame |
| Emails | `emailLegal()` is added in `emails.js` (`wrap`, HTML) and `mailer.js` (plain text) |
| Homepage `site/index.html` | static: its footer is **written by hand**. When you change the link list or the notice in `legal.js`, change it there too |

The report body itself (`/r/` factory HTML, `/raw`) is the factory's page, shown whole in the frame: the frame's bar carries the notice.

## Legal pages

`/legal`, `/terms`, `/privacy`, `/disclaimer`, `/corrections`: public, indexable, read from `server/legal/*.md` at startup.
Drafted 2026-11-12. **Owner decision 2026-11-12: no lawyer review.** Details still unknown show as a highlighted
"to be confirmed", and the page carries a one-line note while any remain. Once every detail is filled the note goes away
by itself. Nothing is hidden or blocked because a detail is missing.

Fill the details with service variables, then redeploy:

| Variable | Fills |
|---|---|
| `LEGAL_OPERATOR_NAME` | "Operated by ..." on the legal notice, terms, privacy and in the footer |
| `LEGAL_SSM_NO` | business registration number |
| `LEGAL_ADDRESS` | business address |
| `LEGAL_TAX` | SST / VAT / GST line (or "not registered") |
| `LEGAL_UPDATED` | "Last updated" date |

The Privacy text still has `[COUNTRY]` and `[CONFIRM]` items (where the AI provider processes data, retention); edit
`server/legal/privacy.md` and `terms.md` directly for those.
