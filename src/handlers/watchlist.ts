import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getStore, getPriceFeed, getClock } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "../toolkit/index.js";
import { POPULAR_COINS } from "../price-feed.js";

// Register the "Manage Watchlist" button on the main menu
registerMainMenuItem({ label: "📋 Watchlist", data: "watchlist:manage", order: 10 });

const composer = new Composer<Ctx>();

// --- Show watchlist management ---
composer.callbackQuery("watchlist:manage", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from!.id;
  const watchlist = await store.getWatchlist(userId);

  if (watchlist.length === 0) {
    // Empty state — show popular coins to add
    await showPopularCoins(ctx, "Your watchlist is empty. Pick a popular coin or type a ticker:");
  } else {
    // Show current watchlist with remove options
    const lines = watchlist.map(
      (item, i) => `${i + 1}. ${item.ticker} (${item.displayName})`,
    );
    const text = `📋 Your watchlist:\n\n${lines.join("\n")}\n\nTap a coin below or type a ticker to add:`;

    // Build keyboard: each watchlist item with a remove button, then popular coins
    const rows = watchlist.map((item) => [
      inlineButton(`❌ ${item.ticker}`, `watchlist:remove:${item.ticker}`),
    ]);

    // Add popular coin quick-add buttons (first 4)
    const popularRow = POPULAR_COINS.slice(0, 4).map((c) =>
      inlineButton(`+${c.ticker}`, `watchlist:add_popular:${c.ticker}`),
    );
    rows.push(popularRow);

    rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

    // Set session flag so text messages are treated as ticker input
    ctx.session.wlAwaitingTicker = true;
    ctx.session.step = "watchlist_adding";

    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard(rows),
    });
  }
});

// --- Show popular coins for empty watchlist ---
async function showPopularCoins(
  ctx: Ctx,
  header: string,
) {
  const rows = POPULAR_COINS.map((c) => [
    inlineButton(`${c.ticker} — ${c.name}`, `watchlist:add_popular:${c.ticker}`),
  ]);
  rows.push([
    inlineButton("✏️ Type a ticker", "watchlist:type_ticker"),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  ctx.session.wlAwaitingTicker = true;
  ctx.session.step = "watchlist_adding";

  await ctx.editMessageText(header, {
    reply_markup: inlineKeyboard(rows),
  });
}

// --- "Type a ticker" button → show input prompt ---
composer.callbackQuery("watchlist:type_ticker", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.wlAwaitingTicker = true;
  ctx.session.step = "watchlist_adding";
  await ctx.editMessageText("Type the ticker symbol (e.g., BTC, ETH, SOL):", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "watchlist:manage")]]),
  });
});

// --- Add popular coin ---
composer.callbackQuery(/^watchlist:add_popular:(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  const coin = POPULAR_COINS.find((c) => c.ticker === ticker);
  if (!coin) {
    await ctx.answerCallbackQuery({ text: "Unknown coin" });
    return;
  }

  const store = getStore();
  const clock = getClock();

  // Validate the coin exists via price API
  const price = await getPriceFeed().fetchPrice(coin.coingeckoId);
  if (!price) {
    await ctx.editMessageText(
      `Couldn't fetch data for ${coin.ticker} — try again later.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to watchlist", "watchlist:manage")],
        ]),
      },
    );
    return;
  }

  await store.addCoinToWatchlist(ctx.from!.id, {
    ticker: coin.ticker,
    displayName: coin.name,
    coingeckoId: coin.coingeckoId,
    alerts: [],
    addedAt: clock.nowMs(),
  });

  // Re-render the watchlist
  const watchlist = await store.getWatchlist(ctx.from!.id);
  const lines = watchlist.map(
    (item, i) => `${i + 1}. ${item.ticker} (${item.displayName})`,
  );
  const text = `✅ ${coin.ticker} added!\n\n📋 Your watchlist:\n\n${lines.join("\n")}\n\nTap a coin to remove or add another:`;

  const rows = watchlist.map((item) => [
    inlineButton(`❌ ${item.ticker}`, `watchlist:remove:${item.ticker}`),
  ]);
  const popularRow = POPULAR_COINS.slice(0, 4).map((c) =>
    inlineButton(`+${c.ticker}`, `watchlist:add_popular:${c.ticker}`),
  );
  rows.push(popularRow);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard(rows),
  });
});

// --- Remove coin confirmation ---
composer.callbackQuery(/^watchlist:remove:(\w+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  await ctx.editMessageText(
    `Remove ${ticker} from your watchlist?`,
    { reply_markup: confirmKeyboard(`watchlist:confirm_remove:${ticker}`, {
      yes: "✅ Remove",
      no: "⬅️ Keep",
    })},
  );
});

composer.callbackQuery(/^watchlist:confirm_remove:(\w+):(yes|no)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  const action = ctx.match[2];

  if (action === "no") {
    // Go back to watchlist
    return showWatchlistAfterChange(ctx);
  }

  const store = getStore();
  await store.removeCoinFromWatchlist(ctx.from!.id, ticker);

  const watchlist = await store.getWatchlist(ctx.from!.id);
  if (watchlist.length === 0) {
    await showPopularCoins(ctx, `✅ ${ticker} removed. Your watchlist is now empty. Add some coins:`);
  } else {
    const lines = watchlist.map(
      (item, i) => `${i + 1}. ${item.ticker} (${item.displayName})`,
    );
    const rows = watchlist.map((item) => [
      inlineButton(`❌ ${item.ticker}`, `watchlist:remove:${item.ticker}`),
    ]);
    const popularRow = POPULAR_COINS.slice(0, 4).map((c) =>
      inlineButton(`+${c.ticker}`, `watchlist:add_popular:${c.ticker}`),
    );
    rows.push(popularRow);
    rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

    await ctx.editMessageText(`✅ ${ticker} removed.\n\n📋 Your watchlist:\n\n${lines.join("\n")}`, {
      reply_markup: inlineKeyboard(rows),
    });
  }
});

// --- Handle typed ticker input ---
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "watchlist_adding" || !ctx.session.wlAwaitingTicker) {
    return next();
  }

  const ticker = ctx.message.text.trim().toUpperCase();
  if (ticker.length === 0) {
    await ctx.reply("Type a ticker symbol (e.g., BTC, ETH, SOL):");
    return;
  }

  // Try to find the coin via search
  const priceFeed = getPriceFeed();
  const searchResults = await priceFeed.searchCoin(ticker);

  // Filter to exact ticker match first
  let match = searchResults.find(
    (c) => c.symbol.toUpperCase() === ticker || c.name.toUpperCase() === ticker,
  );

  if (!match && searchResults.length > 0) {
    // Use first result
    match = searchResults[0];
  }

  if (!match) {
    // Try direct price fetch with ticker as coingecko-id
    const price = await priceFeed.fetchPrice(ticker.toLowerCase());
    if (!price) {
      // Show typo suggestions
      if (searchResults.length > 0) {
        const suggestions = searchResults
          .slice(0, 5)
          .map((c) => `${c.symbol.toUpperCase()} — ${c.name}`)
          .join("\n");
        await ctx.reply(
          `Couldn't find "${ticker}". Did you mean one of these?\n\n${suggestions}\n\nType another ticker or tap Back:`,
          {
            reply_markup: inlineKeyboard([
              [inlineButton("⬅️ Back to watchlist", "watchlist:manage")],
            ]),
          },
        );
      } else {
        await ctx.reply(
          `Couldn't find "${ticker}" — check the spelling and try again.`,
          {
            reply_markup: inlineKeyboard([
              [inlineButton("⬅️ Back to watchlist", "watchlist:manage")],
            ]),
          },
        );
      }
      return;
    }
    match = { id: ticker.toLowerCase(), symbol: ticker, name: price.name };
  }

  const store = getStore();
  const clock = getClock();

  await store.addCoinToWatchlist(ctx.from!.id, {
    ticker: match.symbol.toUpperCase(),
    displayName: match.name,
    coingeckoId: match.id,
    alerts: [],
    addedAt: clock.nowMs(),
  });

  await ctx.reply(`✅ ${match.symbol.toUpperCase()} (${match.name}) added to your watchlist!`, {
    reply_markup: inlineKeyboard([
      [inlineButton("📋 Back to watchlist", "watchlist:manage")],
    ]),
  });

  ctx.session.wlAwaitingTicker = false;
  ctx.session.step = undefined;
});

async function showWatchlistAfterChange(ctx: Ctx) {
  const store = getStore();
  const watchlist = await store.getWatchlist(ctx.from!.id);

  if (watchlist.length === 0) {
    await showPopularCoins(ctx, "Your watchlist is empty. Pick a popular coin or type a ticker:");
    return;
  }

  const lines = watchlist.map(
    (item, i) => `${i + 1}. ${item.ticker} (${item.displayName})`,
  );
  const rows = watchlist.map((item) => [
    inlineButton(`❌ ${item.ticker}`, `watchlist:remove:${item.ticker}`),
  ]);
  const popularRow = POPULAR_COINS.slice(0, 4).map((c) =>
    inlineButton(`+${c.ticker}`, `watchlist:add_popular:${c.ticker}`),
  );
  rows.push(popularRow);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText(`📋 Your watchlist:\n\n${lines.join("\n")}`, {
    reply_markup: inlineKeyboard(rows),
  });
}

export default composer;