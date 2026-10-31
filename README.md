# CeX UK M3 Pro monitor

TypeScript monitor for `macbook pro m3 pro`, using ReefAPI, GitHub Actions, durable repository JSON and Telegram. ReefAPI replaces the direct CeX adapter, which returned HTTP 403 on 31 October 2026. No direct CeX requests are made by this version.

## Schedule and credits

Checks run hourly at **08:07, 09:07, …, 20:07 Europe/London**, including weekends: 13 checks/day. The seven-minute offset avoids the busiest GitHub scheduling period. A UTC schedule covers both GMT and BST; a tested London-time guard skips the extra hour and prevents overnight API calls. Manual monitoring also respects the hours; a manually requested read-only probe may run at any time. Delayed jobs are checked against the actual local hour before requesting data.

ReefAPI currently charges 1 credit per successful CeX search page. We request 100 results per page, its documented maximum, with no product-detail requests. Assuming one page per check: 13 credits/day, 390 per 30 days, and about 77 days from 1,000 signup credits. Multiple pages and manual probes use more. Signup credits are not assumed to renew. The code does not buy credits or enable a paid plan; leave paid plans/automatic top-ups disabled in your ReefAPI account. Quota exhaustion fails visibly instead of treating it as an empty search.

## Setup in mheathcote1977/cexmonitor

1. In [repository Actions secrets](https://github.com/mheathcote1977/cexmonitor/settings/secrets/actions), add `REEF_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. Do not paste keys into chat or commit them. Create a Telegram bot with [BotFather](https://t.me/BotFather), send `/start`, then obtain your numeric chat ID using `getUpdates` locally.
2. Check that GitHub Actions are enabled and allow `actions/checkout@v4` and `actions/setup-node@v4`. The public repository uses standard Ubuntu runners, the intended free configuration. Only the monitor job requests `contents: write`. Verify branch rules permit state commits by `github-actions[bot]`; use a dedicated repository rather than weakening rules on another project.
3. Confirm **Tests** passes on the hosted Node 24 runtime. Then manually dispatch **CeX monitor**, mode **probe**. This reads ReefAPI, validates all pages and prints the snapshot. It never changes state or sends Telegram alerts. Check actual returned prices, IDs, matching titles and stock against CeX. The API adapter follows the published documentation but has not yet been live-validated with your account.
4. Once the probe succeeds, set repository Actions variable `MONITOR_ENABLED=true`. Manually dispatch **monitor** during the allowed hours. The first run creates a silent baseline and commits state; verify that run succeeds to confirm actual `GITHUB_TOKEN` write permission. Later new IDs and returns to online stock trigger Telegram messages. Verify delivery with a separate test chat before relying on alerts. Unset the variable to pause scheduling.

This repository's workflows do not create secrets, change billing, or enable themselves automatically. Hosted runtime and bot state-write permission must be checked by actual successful runs before relying on the monitor.

## Behaviour and durability

All returned catalogue IDs are tracked, including variants and imperfect search matches. The first successful snapshot is silent. Later new product IDs alert even when stock is zero or unknown. Restocks require an explicitly observed online quantity of zero followed by a positive quantity. Unknown stock preserves the last known observation; disappearance from results never implies zero stock. Online availability flags are not used to invent quantities. Missing prices are labelled unavailable. Stock is an observation reported by ReefAPI, not a reservation or guarantee of availability at notification time.

`data/state.json` retains seen IDs and a pending notification queue. Each complete snapshot and its alerts are committed and pushed before notifications are sent. Each successful notification is acknowledged by a further state commit. Workflow concurrency serializes runs; ordinary non-force pushes reject conflicting updates. Do not run multiple independent writers or edit state during a run.

Delivery is at least once: a crash after Telegram accepts a message but before its acknowledgement is pushed may produce a duplicate. A failed send leaves pending alerts for retry. Existing pending alerts are delivered before collecting the next snapshot. Malformed existing state fails closed; intentionally deleting state starts a fresh silent baseline.

The adapter validates success, UK/GBP scope, query, page numbers, counts, total consistency and duplicate IDs. It aborts on partial or inconsistent pagination, HTTP errors, non-JSON, invalid fields, or ReefAPI's 1,000-result paging cap. It requests no availability filter so zero-stock products can be observed. Sorting uses the documented `name_asc` option. Pagination is not an atomic source snapshot; equal-title ordering and concurrent catalogue changes still require live validation. API errors never produce a new observation or an empty-catalogue notification. No automatic HTTP retries consume extra credits.

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

No live ReefAPI or Telegram request has been made with your credentials yet. Direct CeX permission/access was not validated; this version uses the third-party service at your request.
