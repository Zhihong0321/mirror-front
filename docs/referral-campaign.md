# Referral campaign landing page (plan, 17 Nov 2026)

Status: **draft page written, not live.** `site/refer.html` (opens as a file; not yet routed at `/refer`, nothing
pushed) with step screenshots in `site/assets/refer/`, and the web copy of the video in `site/assets/video/`
(H.264 CRF 27, faststart, silent, 9.9 MB, 3:24; full quality 47 MB in G:\e-intro-video\mirrormirror-referral\renders).
Owner decisions marked **(decide)**.

## Goal

One public page that turns a freelancer (first wave: recruited on Fiverr) into a signed-in referrer who has asked
for their first free preview. The video (G:\e-intro-video\mirrormirror-referral, silent with captions) is the
centre of the page.

Funnel to measure, step by step: page view → sign-in → first preview asked → link opened by an owner → sale.

## Address

`https://mirrormirror.cloud/refer` (a route in `server/app.js` that serves `site/refer.html`; the static server
already serves `site/`). Campaign links carry a source: `/refer?src=fiverr`, `/refer?src=whatsapp`. The visit
tracker already stores path and query (`visits.path`), so no new tracking code is needed to count them.

## Page, section by section (same order as the video)

| # | Section | Content | Source |
|---|---|---|---|
| 1 | Hero | "Most business owners never see what a stranger finds. You can show them, and earn $20 USDT for every sale." Button **Start referring, free** → `/login?next=/account/referrals`. Second link: **Watch the 3-minute video** (scrolls to 2) | video scene 1 |
| 2 | Video | The MP4, click to play (no autoplay), poster = first frame, captions burned in so it works muted | render |
| 3 | Real research, not marketing | The 7 sources read (websites, email and domain, certificate logs, web archive, LinkedIn, reviews, registers) and 4 real finding titles, as in the video | video scenes 4-5 |
| 4 | What the owner gets | Free preview first; full package $89 once: 2 full reports + 1 Social Media Ads report | business.md |
| 5 | How you earn, 3 steps | 1 Get the free preview · 2 Send your link · 3 Watch the tracker. Each with the real screen (sample data, the same screenshots the video uses) | referrals.md |
| 6 | Getting paid | $20 per sale, USDT (TRON or EVM address), paid by the team by hand, minimum withdrawal $50, own purchases count | referrals.md |
| 7 | Questions | No application · the company is never told who asked · what the tracker shows (time, city, device, read time; never names or IPs) · competitor previews allowed · who to contact | referrals.md, business.md |
| 8 | Last call | Same button as the hero | |

Rules for the copy: every number is one the product really has (no "earn $1,000 a month", no conversion rates we
have not measured). Sample names only on screen (no real company, owner rule 16 Nov 2026).

## Sign-up path (exists today, no change)

Button → `/login?next=/account/referrals` → email link → **Links and tracker**, where "How referring works" opens by
itself when the account has no previews → "Ask for a free preview" → `/account/previews`. To check on production
before launch: that `next=/account/referrals` survives the email link.

## Video hosting (decide)

| Option | For | Against |
|---|---|---|
| **A. On the site** (`site/assets/video/`, compressed to ~15-20 MB) | One domain, our own visit tracking, no third-party cookies | Needs a server change: the static handler has no MP4 type, no byte-range replies (Safari will not play without them) and reads the whole file into memory per request. Adds ~20 MB to the image |
| B. YouTube, unlisted, embedded | Free, adaptive quality, nothing to build | YouTube branding and cookies on our page; "watch on YouTube" leaks people off the page |
| C. Cloudflare R2 / Stream | Fast, no load on Railway | New account and bill; another credential |

Recommendation: **A**, with a streaming static handler (`fs.createReadStream`, `Range` → 206, `video/mp4`), plus
tests. Railway egress for 1,000 full views of a 20 MB file is about 20 GB.

## Build steps

1. Compress the render for the web (H.264, ~15-20 MB, `+faststart`), make the poster image.
2. Server: `video/mp4` type, Range support and streaming in `staticFile`, the `/refer` route; tests in `server/test`.
3. `site/refer.html` in the home page's style (same tokens, Inter, two-tone headlines), the sections above.
4. Link to it from the home page footer and from `/account/referrals` ("Share this page with other freelancers").
5. Local run and check on phone width; `npm test`; push; redeploy; check `/refer` and the video on production
   (iPhone Safari and Android Chrome).
6. Ops queries to watch the funnel (read only):
   - views by source: `select path, count(*) from visits where page_key = '/refer' group by path`
   - sign-ins after a /refer visit: join `visits` (visitor id) to the visitor's later signed-in visits.

## Open (decide)

- Hosting option A, B or C.
- Fiverr: their terms limit moving buyers off the platform; the page and video name no platform. Hiring
  freelancers there to refer is the owner's call.
- The live home page's checkout picture (`site/assets/checkout-bundle.png`, also the social share image) shows the
  real sample company on the report cover. The owner called that name sensitive on 16 Nov 2026; replace it?
