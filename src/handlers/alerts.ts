import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getStore, getClock } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { v4 as uuid } from "../uuid.js";

// Register the "Alerts" button on the main menu
registerMainMenuItem({ label: "🔔 Alerts", data: "alerts:menu", order: 20 });

const composer = new Composer<Ctx>();

// ====== Alerts main menu ======

composer.callbackQuery("alerts:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const watchlist = await store.getWatchlist(ctx.from!.id);

  if (watchlist.length === 0) {
    await ctx.editMessageText(
      "You don't have any coins in your watchlist yet. 📋 Watchlist to add some first, then set alerts.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📋 Go to Watchlist", "watchlist:manage")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  // Show coins the user can set alerts on
  const rows = watchlist.map((item) => [
    inlineButton(`${item.ticker} — ${item.displayName}`, `alerts:coin:${item.ticker}`),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText("Pick a coin to manage alerts:", {
    reply_markup: inlineKeyboard(rows),
  });
});

// ====== Coin-specific alert management ======

composer.callbackQuery(/^alerts:coin:(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  const store = getStore();
  const watchlist = await store.getWatchlist(ctx.from!.id);
  const coin = watchlist.find((c) => c.ticker === ticker);

  if (!coin) {
    await ctx.editMessageText("Coin not found in your watchlist.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "alerts:menu")]]),
    });
    return;
  }

  // Show existing alerts + add options
  let text = `🔔 Alerts for ${ticker} (${coin.displayName})\n\n`;
  if (coin.alerts.length === 0) {
    text += "No alerts yet. Create one below:\n\n";
  } else {
    const active = coin.alerts.filter((a) => a.enabled).length;
    text += `${coin.alerts.length} alert(s), ${active} active\n\n`;
    for (const alert of coin.alerts) {
      const status = alert.enabled ? "🟢" : "🔴";
      if (alert.type === "price_threshold") {
        text += `${status} Price ${alert.direction} $${alert.thresholdValue}\n`;
      } else {
        text += `${status} ${alert.thresholdValue}% move (${alert.timeWindowMinutes ?? 60}min)\n`;
      }
    }
  }

  const rows = [
    [inlineButton("💰 Price threshold", `alerts:create:price:${ticker}`)],
    [inlineButton("📊 Percent move", `alerts:create:percent:${ticker}`)],
  ];

  // Add toggle/remove for existing alerts
  for (const alert of coin.alerts) {
    rows.push([
      inlineButton(
        alert.enabled ? `🔴 Disable #${alert.id.slice(0, 4)}` : `🟢 Enable #${alert.id.slice(0, 4)}`,
        `alerts:toggle:${ticker}:${alert.id}`,
      ),
      inlineButton(`🗑️ #${alert.id.slice(0, 4)}`, `alerts:delete:${ticker}:${alert.id}`),
    ]);
  }

  rows.push([inlineButton("⬅️ Back to alerts menu", "alerts:menu")]);

  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard(rows),
  });
});

// ====== Create price threshold alert - step 1: choose direction ======

composer.callbackQuery(/^alerts:create:price:(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  ctx.session.alertTargetTicker = ticker;
  ctx.session.step = "alert_price_direction";

  await ctx.editMessageText(
    `Set a price alert for ${ticker}.\n\nDo you want to be notified when the price goes above or below a certain value?`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬆️ Above", `alert:price_dir:above:${ticker}`)],
        [inlineButton("⬇️ Below", `alert:price_dir:below:${ticker}`)],
        [inlineButton("⬅️ Back", `alerts:coin:${ticker}`)],
      ]),
    },
  );
});

composer.callbackQuery(/^alert:price_dir:(above|below):(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const direction = ctx.match[1] as "above" | "below";
  const ticker = ctx.match[2];
  ctx.session.alertDirection = direction;
  ctx.session.step = "alert_price_value";

  await ctx.editMessageText(
    `Got it — notify when ${ticker} goes ${direction} a certain price.\n\n` +
    `Enter the USD price (e.g., 50000.50):`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", `alerts:create:price:${ticker}`)],
      ]),
    },
  );
});

// ====== Handle price threshold value text input ======

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "alert_price_value") return next();

  const valueStr = ctx.message.text.trim();
  const value = parseFloat(valueStr);

  if (isNaN(value) || value <= 0) {
    await ctx.reply("Please enter a valid USD amount (e.g., 50000.50):");
    return;
  }

  ctx.session.alertThresholdUsd = value;
  ctx.session.step = undefined;

  const store = getStore();
  const clock = getClock();
  const ticker = ctx.session.alertTargetTicker!;
  const direction = ctx.session.alertDirection!;

  const alert = {
    id: uuid(),
    type: "price_threshold" as const,
    direction,
    thresholdValue: value,
    enabled: true,
    lastFiredAt: null,
    createdAt: clock.nowMs(),
  };

  await store.addAlertToWatchlistItem(ctx.from!.id, ticker, alert);

  // Clean up session
  ctx.session.alertTargetTicker = undefined;
  ctx.session.alertDirection = undefined;
  ctx.session.alertThresholdUsd = undefined;

  await ctx.reply(
    `✅ Alert set! I'll notify you when ${ticker} goes ${direction} $${value}.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(`🔔 ${ticker} alerts`, `alerts:coin:${ticker}`)],
        [inlineButton("⬅️ Alerts menu", "alerts:menu")],
      ]),
    },
  );
});

// ====== Create percent move alert - step 1: enter percentage ======

composer.callbackQuery(/^alerts:create:percent:(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  ctx.session.alertTargetTicker = ticker;
  ctx.session.step = "alert_percent_value";

  await ctx.editMessageText(
    `Set a percentage move alert for ${ticker}.\n\n` +
    `Enter the percentage change (e.g., 5 for 5% move, or -3 for 3% drop):`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back", `alerts:coin:${ticker}`)],
      ]),
    },
  );
});

// ====== Handle percent value text input ======

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "alert_percent_value") return next();

  const valueStr = ctx.message.text.trim();
  const value = parseFloat(valueStr);

  if (isNaN(value) || value === 0) {
    await ctx.reply("Please enter a valid percentage (e.g., 5 for 5% or -3 for -3%):");
    return;
  }

  ctx.session.alertPercent = value;
  ctx.session.step = "alert_percent_window";

  await ctx.editMessageText(
    `Got it — notify on ${ctx.session.alertTargetTicker} moving ${value > 0 ? "+" : ""}${value}%.\n\n` +
    `Over what time window?\n\n` +
    `(e.g., 60 for 1 hour, 1440 for 24 hours, 10080 for 1 week)`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("1 hour", `alert:pct_window:60`), inlineButton("4 hours", `alert:pct_window:240`)],
        [inlineButton("24 hours", `alert:pct_window:1440`), inlineButton("1 week", `alert:pct_window:10080`)],
        [inlineButton("⬅️ Back", `alerts:create:percent:${ctx.session.alertTargetTicker}`)],
      ]),
    },
  );
});

// ====== Handle percent window selection ======

composer.callbackQuery(/^alert:pct_window:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const windowMinutes = parseInt(ctx.match[1], 10);
  ctx.session.alertTimeWindowMinutes = windowMinutes;
  ctx.session.step = undefined;

  const store = getStore();
  const clock = getClock();
  const ticker = ctx.session.alertTargetTicker!;
  const percent = ctx.session.alertPercent!;

  const alert = {
    id: uuid(),
    type: "percent_move" as const,
    thresholdValue: percent,
    timeWindowMinutes: windowMinutes,
    enabled: true,
    lastFiredAt: null,
    createdAt: clock.nowMs(),
  };

  await store.addAlertToWatchlistItem(ctx.from!.id, ticker, alert);

  // Clean up session
  ctx.session.alertTargetTicker = undefined;
  ctx.session.alertPercent = undefined;
  ctx.session.alertTimeWindowMinutes = undefined;

  await ctx.reply(
    `✅ Alert set! I'll notify you when ${ticker} moves ${percent > 0 ? "+" : ""}${percent}% within ${windowMinutes} minutes.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(`🔔 ${ticker} alerts`, `alerts:coin:${ticker}`)],
        [inlineButton("⬅️ Alerts menu", "alerts:menu")],
      ]),
    },
  );
});

// ====== Toggle alert enable/disable ======

composer.callbackQuery(/^alerts:toggle:(\w+):([a-f0-9-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  const alertId = ctx.match[2];
  const store = getStore();
  const watchlist = await store.getWatchlist(ctx.from!.id);
  const coin = watchlist.find((c) => c.ticker === ticker);
  if (!coin) return;

  const alert = coin.alerts.find((a) => a.id === alertId);
  if (!alert) return;

  alert.enabled = !alert.enabled;
  await store.saveWatchlist(ctx.from!.id, watchlist);

  await ctx.answerCallbackQuery({ text: alert.enabled ? "Alert enabled" : "Alert disabled" });

  // Re-show the coin page
  await ctx.editMessageText(
    `✅ ${alert.enabled ? "Enabled" : "Disabled"} alert for ${ticker}.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(`🔔 ${ticker} alerts`, `alerts:coin:${ticker}`)],
        [inlineButton("⬅️ Back to alerts menu", "alerts:menu")],
      ]),
    },
  );
});

// ====== Delete alert ======

composer.callbackQuery(/^alerts:delete:(\w+):([a-f0-9-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  const alertId = ctx.match[2];
  const store = getStore();
  await store.removeAlertFromWatchlistItem(ctx.from!.id, ticker, alertId);

  await ctx.editMessageText(
    `🗑️ Alert deleted.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(`🔔 ${ticker} alerts`, `alerts:coin:${ticker}`)],
        [inlineButton("⬅️ Back to alerts menu", "alerts:menu")],
      ]),
    },
  );
});

export default composer;