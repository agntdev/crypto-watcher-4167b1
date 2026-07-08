import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getStore, getOwnerId } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

/**
 * /admin_stats — owner-only view of usage metrics.
 */
composer.command("admin_stats", async (ctx) => {
  const ownerId = getOwnerId();
  const userId = ctx.from!.id;

  // Verify owner identity
  if (ownerId !== null && userId !== ownerId) {
    await ctx.reply("This command is only available to the bot owner.");
    return;
  }

  // If no OWNER_ID is set, allow the first user who runs it
  // In practice OWNER_ID should be set in env

  const store = getStore();
  const metrics = await store.computeOwnerMetrics();
  const allUserIds = await store.getAllUserIds();

  // Count total watchlist items and alerts
  let totalWatchlistItems = 0;
  let totalAlerts = 0;
  for (const uid of allUserIds) {
    const wl = await store.getWatchlist(uid);
    totalWatchlistItems += wl.length;
    for (const item of wl) {
      totalAlerts += item.alerts.length;
    }
  }

  const text =
    `📊 Owner Metrics\n\n` +
    `👥 Total users: ${metrics.totalUsers}\n` +
    `👤 Active users: ${metrics.activeUsers}\n` +
    `📋 Watchlist items: ${totalWatchlistItems}\n` +
    `🔔 Total alerts: ${totalAlerts}\n\n` +
    `🏆 Most watched:\n${
      metrics.mostWatchedTickers.length > 0
        ? metrics.mostWatchedTickers
            .map((t) => `  ${t.ticker}: ${t.count} user(s)`)
            .join("\n")
        : "  (none yet)"
    }\n\n` +
    `🔥 Top alerts fired:\n${
      metrics.mostFiredAlerts.length > 0
        ? metrics.mostFiredAlerts
            .map((a) => `  ${a.alertType} — ${a.ticker}: ${a.count}x`)
            .join("\n")
        : "  (none yet)"
    }`;

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("📥 Export CSV", "admin:export_csv")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

/**
 * CSV export of aggregated metrics.
 */
composer.callbackQuery("admin:export_csv", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const metrics = await store.getOwnerMetrics();
  const allUserIds = await store.getAllUserIds();

  if (!metrics) {
    await ctx.editMessageText("No metrics data available yet.");
    return;
  }

  // Build CSV
  const lines: string[] = [
    "Metric,Value",
    `Total Users,${metrics.totalUsers}`,
    `Active Users,${metrics.activeUsers}`,
    `Updated At,${new Date(metrics.updatedAt).toISOString()}`,
    "",
    "Most Watched Tickers",
    "Ticker,User Count",
    ...metrics.mostWatchedTickers.map((t) => `${t.ticker},${t.count}`),
    "",
    "Most Fired Alerts",
    "Alert Type,Ticker,Count",
    ...metrics.mostFiredAlerts.map((a) => `${a.alertType},${a.ticker},${a.count}`),
    "",
    "User IDs (anonymized count)",
    `${allUserIds.length} user(s)`,
  ];

  const csv = lines.join("\n");

  // Send as a text file
  await ctx.reply(`📥 Metrics CSV\n\n\`\`\`\n${csv}\n\`\`\``, {
    parse_mode: "MarkdownV2",
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to stats", "menu:main")],
    ]),
  });
});

export default composer;