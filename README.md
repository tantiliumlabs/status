# Tantilium Status

The public status page for Tantilium, served at https://status.tantilium.cloud.

It runs entirely on GitHub, outside our AWS network, so it stays up when the platform doesn't.

- `.github/workflows/status.yml` checks every service every 5 minutes and commits the results to `data/`.
- `site/` is the page. It reads `data/` live from this repo, so data commits don't redeploy it.
- `.github/workflows/pages.yml` deploys `site/` to GitHub Pages when it changes.

## Posting an incident

Incidents are GitHub issues. Write them for customers: what's affected and what they should expect. Leave out internal hostnames, error dumps and names of people.

1. Open an issue. The title becomes the headline, for example "Deployments are delayed". The body becomes the first update.
2. Add labels:
   - `incident` (required, nothing is published without it)
   - `major` or `minor` for impact, or `maintenance` for planned work
   - `component:<id>` for each affected service: `website`, `docs`, `console`, `signin`, `api`, `deployments`, `billing`
3. Post each update as a comment. Move the stage with labels: no label means **Investigating**, then add `identified`, then `monitoring`.
4. Close the issue when it's fixed. That marks it **Resolved**.

The page refreshes within a few minutes of each change.

Only text from people with write access to this repo is published. Anyone can comment on a public issue, but their comments are skipped. Only people with triage rights can add the `incident` label.

## Changing what's checked

Edit `config.json`:

- `components[].checks[]` takes `url` (public) or `urlEnv` (the name of a repo secret, for URLs that shouldn't be public). Optional: `expectStatus` (default 200) and `expectBody` (text the response must contain).
- A service shows **Degraded** when it responds slower than `slowMs`, **Partial outage** when some of its checks fail, and **Major outage** when all of them fail. Each failed check is retried once after 5 seconds.
- `maintenance` lists daily windows in UTC. Failures inside a window show as maintenance and don't count against uptime.

Current secrets: `KUBEOPERA_API_HEALTH_URL`, `BUILDS_HEALTH_URL`, `CICD_HEALTH_URL`.

## Running locally

```bash
node scripts/check.mjs                 # needs Node 18+; set the secrets as env vars to check every service
python3 -m http.server 8000            # then open http://localhost:8000/site/
```

## Limits

- GitHub runs scheduled workflows on a best-effort basis. Checks can be a few minutes late, and the page warns when data is more than 20 minutes old.
- GitHub turns off scheduled workflows in a public repo after 60 days without activity. The data commits count as activity, so this only matters if checks stop for another reason.
