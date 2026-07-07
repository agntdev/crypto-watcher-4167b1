# Crypto Watcher — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A personal Telegram bot that lets users maintain a private watchlist of cryptocurrencies, set price threshold and percentage move alerts, request on-demand prices, and receive optional daily summaries. The bot respects quiet hours, rate-limits alerts, and provides an admin view for the owner with usage metrics.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Retail crypto traders
- Crypto holders
- Non-technical Telegram users

## Success criteria

- Users can add/remove coins to their watchlist
- Price threshold and percentage move alerts trigger reliably
- Daily summaries are delivered at configured times
- Owner can view usage metrics and top alerts

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu and start onboarding
- **/price** (command, actor: user, command: /price) — Request current price for a specific coin or all watchlist coins
- **Manage Watchlist** (button, actor: user, callback: watchlist:manage) — Open the watchlist management screen with popular coin buttons and add-by-ticker option
- **Add Price Alert** (button, actor: user, callback: alert:price_threshold) — Start creating a price threshold alert for a selected coin
- **Add Percent Alert** (button, actor: user, callback: alert:percent_move) — Start creating a percentage move alert for a selected coin
- **/admin_stats** (command, actor: owner, command: /admin_stats) — Show owner-only metrics about users, watchlists, and most-fired alerts

## Flows

### onboarding
_Trigger:_ /start

1. Ask for time zone
2. Explain basic commands and inline buttons

_Data touched:_ user profile

### add_coin
_Trigger:_ watchlist:manage

1. Show popular coin buttons
2. Handle ticker input and validation
3. Confirm coin addition

_Data touched:_ watchlist item

### remove_coin
_Trigger:_ watchlist:remove

1. Show confirmation dialog
2. Remove from watchlist

_Data touched:_ watchlist item

### price_threshold_alert
_Trigger:_ alert:price_threshold

1. Select direction (above/below)
2. Enter USD value
3. Confirm alert creation

_Data touched:_ alert

### percent_move_alert
_Trigger:_ alert:percent_move

1. Enter percentage
2. Select time window
3. Confirm alert creation

_Data touched:_ alert

### price_check
_Trigger:_ /price

1. Parse ticker parameter
2. Fetch and display price
3. Show 24h change and recent alerts

_Data touched:_ notification log

### morning_summary
_Trigger:_ scheduled

1. Check user's enabled status
2. Fetch prices for all watchlist coins
3. Format summary with 24h changes and recent alerts

_Data touched:_ user profile, notification log

### admin_stats
_Trigger:_ /admin_stats

1. Verify owner identity
2. Fetch and display metrics
3. Offer CSV export

_Data touched:_ owner metrics

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **user profile** _(retention: persistent)_ — Telegram ID, display name, time zone, quiet hours, morning summary time, alert cooldown length, metrics opt-in
  - fields: Telegram ID, display name, time zone, quiet hours start, quiet hours end, morning summary time, alert cooldown length, metrics opt-in
- **watchlist item** _(retention: persistent)_ — Ticker symbol, display name, list of active alerts
  - fields: ticker symbol, display name, active alerts
- **alert** _(retention: persistent)_ — Type, direction, threshold value, enabled state, last-fired timestamp
  - fields: type, direction, threshold value, enabled, last-fired timestamp
- **notification log** _(retention: 90 days)_ — Sent alerts with details
  - fields: user, ticker, alert id, old price, new price, percent change, timestamp
- **owner metrics** _(retention: persistent)_ — Aggregated usage statistics
  - fields: total users, active users, most-watched tickers, most-fired alerts

## Integrations

- **Telegram** (required) — Bot API messaging and notifications
- **Price feed API** (required) — Fetch cryptocurrency prices
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- /admin_stats command to view metrics
- CSV export of aggregated metrics

## Notifications

- Price threshold alerts
- Percentage move alerts
- Daily morning summaries
- Queued alerts after quiet hours

## Permissions & privacy

- Private watchlists per user
- Minimal data retention (90 days for logs)
- No user financial data stored

## Edge cases

- Unknown tickers with typo suggestions
- Price feed failures with silent retries
- Alert cooldowns to prevent spam
- Quiet hours with queued alerts

## Required tests

- Verify alert triggers with price changes
- Test quiet hours queue and delivery
- Validate ticker validation and typo suggestions
- Confirm morning summary delivery at correct local times

## Assumptions

- Time zone defaults to Telegram locale if skipped
- Price feed has caching and retry logic
- Default alert cooldown is 1 hour
- Default quiet hours are 23:00-07:00
