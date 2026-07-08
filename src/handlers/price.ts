import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getStore, getPriceFeed } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

/**
 * /price <ticker> — request current price for a specific coin or all watchlist coins.
 * If called without a ticker, shows prices for all watchlist coins.
 */
composer.command("price", async (ctx) => {
  const store = getStore();
  const priceFeed = getPriceFeed();
  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  const ticker = parts[1]?.toUpperCase();

  if (ticker) {
    // Fetch price for a specific coin
    // First, try to find the coingecko id from the user's watchlist
    const watchlist = await store.getWatchlist(ctx.from!.id);
    let coingeckoId = watchlist.find((c) => c.ticker === ticker)?.coingeckoId;

    // If not in watchlist, try direct fetch by ticker as ID
    if (!coingeckoId) {
      coingeckoId = ticker.toLowerCase();
    }

    const price = await priceFeed.fetchPrice(coingeckoId);
    if (!price) {
      await ctx.reply(
        `Couldn't fetch the price for ${ticker}. Check the ticker and try again.`,
      );
      return;
    }

    const sign = price.priceChange24hPercent >= 0 ? "📈" : "📉";
    const changeStr = `${sign} ${Math.abs(price.priceChange24hPercent).toFixed(2)}% (24h)`;

    // Check for recent alerts on this coin
    const recentAlerts = await store.getRecentNotifications(ctx.from!.id, 3);
    const coinAlerts = recentAlerts.filter((a) => a.ticker === ticker);
    let alertStr = "";
    if (coinAlerts.length > 0) {
      alertStr = `\n\n🔔 Recent alerts:\n${coinAlerts
        .map((a) => {
          const when = formatTime(a.timestamp);
          return `  • $${a.oldPrice?.toFixed(2) ?? "—"} → $${a.newPrice.toFixed(2)}${a.percentChange ? ` (${a.percentChange.toFixed(2)}%)` : ""} — ${when}`;
        })
        .join("\n")}`;
    }

    await ctx.reply(
      `${price.name} (${price.symbol})\n` +
      `💰 $${price.currentPriceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `${changeStr}${alertStr}`,
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([
          [inlineButton(`🔔 Set alert for ${ticker}`, `alerts:coin:${ticker}`)],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
  } else {
    // Show all watchlist prices
    const watchlist = await store.getWatchlist(ctx.from!.id);
    if (watchlist.length === 0) {
      await ctx.reply(
        "Your watchlist is empty. Add some coins first with 📋 Watchlist.",
        {
          reply_markup: inlineKeyboard([
            [inlineButton("📋 Go to Watchlist", "watchlist:manage")],
          ]),
        },
      );
      return;
    }

    await ctx.reply("Fetching prices... 🔄");

    const ids = watchlist.map((c) => c.coingeckoId);
    const prices = await priceFeed.fetchPrices(ids);

    const lines: string[] = [];
    for (const item of watchlist) {
      const price = prices.get(item.coingeckoId);
      if (price) {
        const sign = price.priceChange24hPercent >= 0 ? "📈" : "📉";
        const changeStr = `${sign} ${Math.abs(price.priceChange24hPercent).toFixed(2)}%`;
        lines.push(
          `${item.ticker}: $${price.currentPriceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${changeStr}`,
        );
      } else {
        lines.push(`${item.ticker}: price unavailable`);
      }
    }

    await ctx.reply(
      `📊 Your watchlist prices:\n\n${lines.join("\n")}`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📋 Manage Watchlist", "watchlist:manage")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
  }
});

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export default composer;