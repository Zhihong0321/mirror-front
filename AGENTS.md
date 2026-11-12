# Working in mirror-front

- **Start with [CLAUDE.md](CLAUDE.md)**: production facts, deploy steps, the ops tool recipes and the rules.

- This repo is the **live MirrorMirror website**. Railway deploys every push to `main` (once linked).
  Read [README.md](README.md) first, then [docs/ops.md](docs/ops.md).
- **Reading production:** use the ops API (`scripts/ops.mjs`, `/ops/api/*`) for logs, status and read-only
  queries. Do not ask the owner to paste logs or to log in. The token is `MIRRORMIRROR_OPS_TOKEN` in
  `D:\Tools\my-vault\vault.json` (read it from there; never copy it into this repo).
- Never commit tokens, `.env` files, `server/data/` (the live database copy) or the GeoIP file.
- Report work with the status words from the owner's global rules. A change is DONE only after it is live
  and checked on the live site.
- The report factory's tables (`v21_*`) are read-only from this site. Never write to them.
- Owner decision 2026-11-12: `/r/` and `/p/` report pages are public by link. Do not add a payment or token
  check to them unasked.
