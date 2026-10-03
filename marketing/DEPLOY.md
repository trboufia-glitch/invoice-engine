# Deploying invoice.engine

Everything below is verified working. The only thing I could not do is the part that
requires **your accounts** — Railway/Render/GitHub auth is yours, and I will not create
accounts or accept terms in your name.

## What's ready

| File | Purpose |
|---|---|
| `Dockerfile` | Railway builds this directly; `DATA_DIR=/data`, healthcheck included |
| `railway.json` | Railway build + healthcheck config |
| `render.yaml` | Render blueprint — connect the repo and it deploys as-is |
| `.dockerignore` | Keeps `data/` (live credentials) out of the image |

## Before you deploy — do not skip

**1. Mount a persistent volume.** A container filesystem is wiped on every deploy. Without
a volume, every live API key and every paid credit vanishes on restart. The service prints
a loud warning at boot if this is missing, but the warning is not a substitute.

- Railway: `railway add --volume /data`
- Render: add a Disk, mount at `/data`

**2. Set the payout ID.** `BINANCE_ID` defaults to `990584936`. Change it in
`render.yaml` or the Railway dashboard if that is not the ID you want paid.

**3. Change nothing else.** The app needs no environment variables to start.

## Deploy on Render (easiest)

```
1. Push this repo to GitHub (see below).
2. Render dashboard → New → Blueprint → select the repo.
3. render.yaml is picked up automatically; it deploys on the free tier.
4. Add a Disk mounted at /data, and set BINANCE_ID.
5. Your URL is https://invoice-engine.onrender.com
```

## Deploy on Railway

```
1. Push the repo to GitHub.
2. Railway → New Project → Deploy from GitHub repo → select it.
3. Railway detects the Dockerfile automatically.
4. Add a volume at /data.
5. Set BINANCE_ID in the service variables.
```

Locally, without a CLI:

```
npm i -g @railway/cli
railway login          # opens a browser — you complete this yourself
railway up
railway add --volume /data
railway variables set BINANCE_ID=990584936
```

## Pushing to GitHub

You do not have a GitHub repo, a git identity, or `gh` installed. Choose one:

**A. Use `gh`** (fastest)
```
winget install GitHub.cli
gh auth login          # you complete this yourself
gh repo create invoice-engine --private --source=. --push
```

**B. Use the GitHub web UI** — create an empty repo at github.com/new, then:
```
git config --global user.name "YOUR NAME"
git config --global user.email "YOU@EMAIL"
git commit -m "Invoice engine: deterministic invoice/CSV validator API"
git remote add origin https://github.com/YOUR_NAME/invoice-engine.git
git push -u origin main
```

I have not run `commit` or `push` — those need your name, email, and explicit go-ahead.

**Make the repo private.** It contains the payout ID and the distribution copy. Nothing
here is secret, but there is no reason to publish your payment details.

## Verify after deploy

```
curl https://https://invoice-checker-ie.surge.sh/health
open  https://https://invoice-checker-ie.surge.sh/playground      # click "Mismatched totals" → expect 3 errors
open  https://https://invoice-checker-ie.surge.sh/v1/ledger       # must NOT be empty (the seed ships in the image)
open  https://https://invoice-checker-ie.surge.sh/v1/funnel       # should show landing_view/playground_view
```

If `/v1/ledger` is empty, `seed/` did not make it into the image — check the Dockerfile
`COPY seed ./seed` line.

## Then: distribute

`marketing/DISTRIBUTION.md` has ready-to-post copy for Hacker News, r/Bookkeeping,
r/smallbusiness, Indie Hackers, and a 20-email direct outreach template.

The order that works: **r/Bookkeeping first** (most concentrated audience for this exact
pain), then direct outreach, then HN/Indie Hackers for reach. Post the pain, not the API.

Watch `/v1/funnel` after the first posts:

- high views → no keys: the free tier or the copy is wrong
- many keys → no orders: pricing or value proposition, **not** a feature gap

Do not build more features until there is a customer telling you what is missing.