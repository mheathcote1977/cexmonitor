# CeX UK M3 Pro monitor

TypeScript monitor for `macbook pro m3 pro`, using ReefAPI, GitHub Actions, durable repository JSON and Telegram. ReefAPI replaces the direct CeX adapter, which returned HTTP 403 on 31 October 2026. No direct CeX requests are made by this version.

## Schedule and credits

Checks run at **09:07, 11:07, 13:07, 15:07, 17:07 and 19:07 Europe/London**, including weekends: six checks/day. The seven-minute offset avoids the busiest scheduling period. A UTC schedule covers GMT and BST; a tested London-time guard selects odd local hours and prevents overnight API calls. The first check is 9am, allowing an hour after stores open, and the last check is 7pm. Adding a seventh daily check would exceed the monthly credit budget. Manual monitoring respects the same slots; an explicitly requested read-only probe may run at any time. Workflow edits no longer trigger live checks.

ReefAPI charges 1 credit per successful CeX search page. We request 100 results per page and make no product-detail requests. The live probe on 31 October 2026 returned 448 rows across five pages, of which 149 matched M3 Pro. Search is now capped at **five pages per check**. A larger total causes an error after the first page instead of spending credits on more pages or accepting a partial snapshot.

With the user-reported **985 credits remaining**, six five-page checks use **30 credits/day**, **900 per 30 days**, or **930 per 31 days**. That leaves 85 credits after 30 days or 55 after 31 days, assuming no extra manual probes/setup runs or other account usage. This is approximately 32 full days of scheduled checks. Failed and shorter searches can use fewer credits. Local title filtering does not reduce page charges.

Signup credits are not assumed to renew. The code never buys credits or enables a paid plan. Leave paid plans/automatic top-ups disabled in your ReefAPI account. Quota exhaustion fails visibly rather than treating it as an empty search. Enable GitHub failure notifications to see quota or result-limit failures.

## Setup in mheathcote1977/cexmonitor

1. In [repository Actions secrets](https://github.com/mheathcote1977/cexmonitor/settings/secrets/actions), add `REEF_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. Do not paste keys into chat or commit them. Create a Telegram bot with [BotFather](https://t.me/BotFather), send `/start`, then obtain your numeric chat ID using `getUpdates` locally.
2. Check that GitHub Actions are enabled and allow `actions/checkout@v4` and `actions/setup-node@v4`. The public repository uses standard Ubuntu runners, the intended free configuration. Only the monitor job requests `contents: write`. Verify branch rules permit state commits by `github-actions[bot]`; use a dedicated repository rather than weakening rules on another project.
3. Confirm **Tests** passes on the hosted Node 24 runtime. Then manually dispatch **CeX monitor**, mode **probe**. This reads ReefAPI, validates all pages and prints the snapshot. It never changes state or sends Telegram alerts. Check actual returned prices, IDs, matching titles and stock against CeX. The read-only hosted probe succeeded with your saved key on 31 October 2026: [successful run](https://github.com/mheathcote1977/cexmonitor/actions/runs/41201299319). It validated five pages, unique IDs, prices and reported online quantities. This verifies API access, not the physical stock accuracy or ID stability over time. The **Validate ReefAPI access** workflow also supports manual probing; its initial addition triggered this first check.
4. Monitoring is now enabled by default after the successful setup check. The first silent baseline saved 149 matching IDs on 31 October 2026. The setup workflow verified a real bot state commit/push and Telegram accepted the connection test: [setup run](https://github.com/mheathcote1977/cexmonitor/actions/runs/41202347207). Set repository Actions variable `MONITOR_ENABLED=false` or disable the CeX monitor workflow to pause. Clear that variable or set it to `true` to resume. Updating the workflow runs offline CI tests only; it no longer triggers an extra live check.

The workflows do not create secrets or change billing. The monitor schedule was enabled only after hosted tests, the ReefAPI probe, a durable baseline push, and a successful Telegram connection test. The setup workflow is available for manual rechecking; reruns preserve an existing baseline and send another labelled setup message.

## Behaviour and durability

Only titles containing both MacBook Pro and M3 Pro are tracked. M3 Max, base M3 and other chips are excluded after validating the complete search result. All A/B/C grades and configurations within that title match are included. The first successful snapshot is silent. Later new product IDs alert even when stock is zero or unknown. Restocks require an explicitly observed online quantity of zero followed by a positive quantity. Unknown stock preserves the last known observation; disappearance from results never implies zero stock. Online availability flags are not used to invent quantities. Missing prices are labelled unavailable. Stock is an observation reported by ReefAPI, not a reservation or guarantee of availability at notification time.

`data/state.json` retains seen IDs and a pending notification queue. Each complete snapshot and its alerts are committed and pushed before notifications are sent. Each successful notification is acknowledged by a further state commit. Workflow concurrency serializes runs; ordinary non-force pushes reject conflicting updates. Do not run multiple independent writers or edit state during a run.

Delivery is at least once: a crash after Telegram accepts a message but before its acknowledgement is pushed may produce a duplicate. A failed send leaves pending alerts for retry. Existing pending alerts are delivered before collecting the next snapshot. Malformed existing state fails closed; intentionally deleting state starts a fresh silent baseline.

The adapter validates success, UK/GBP scope, query, page numbers, counts, total consistency and duplicate IDs. It aborts on partial or inconsistent pagination, HTTP errors, non-JSON, invalid fields, or ReefAPI's five-page credit ceiling (500 results at the configured page size). It requests no availability filter so zero-stock products can be observed. Sorting uses the documented `name_asc` option. Pagination is not an atomic source snapshot; equal-title ordering and concurrent catalogue changes still require live validation. API errors never produce a new observation or an empty-catalogue notification. No automatic HTTP retries consume extra credits.

## Local verification

Use Node 24:

```sh
npm ci --ignore-scripts
npm run check
npm test
# Only with REEF_API_KEY set securely in your environment:
npm run probe
```

Tests use synthetic fixtures. They cover pagination, response failures, quota errors, missing stock/prices, new IDs, restocks, corrupt state, disabled monitoring, and every hour in both GMT and BST plus clock-change dates. No credentials are required for tests.

## References and limits

- [ReefAPI CeX request parameters](https://reefapi.com/docs/cex), [search response example and credit cost](https://reefapi.com/cex-api), [authentication and errors](https://reefapi.com/docs).
- [GitHub schedule behaviour](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): schedules run on the default branch and can be delayed or dropped; immediate alerts are not guaranteed.
- [Public standard-runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions): private repositories consume quota and may incur charges.
- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [workflow inactivity](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows): public schedules may be disabled after 60 days without repository activity. Enable GitHub failure notifications.
- [ReefAPI terms](https://reefapi.com/terms): a working API response does not itself establish CeX authorization.

The live ReefAPI probe and hosted strict checks/tests succeeded on Node 24.22.1. Telegram accepted the setup message and the production state push succeeded. The configured two-hourly daytime schedule is enabled; no new-item alert was sent for the initial baseline. Direct CeX permission/access was not validated; this version uses the third-party service at your request.
