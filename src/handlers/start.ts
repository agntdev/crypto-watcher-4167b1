import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  mainMenuKeyboard,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { getStore, getClock } from "../bot.js";

// Onboarding: first time a user runs /start, we ask for their time zone.
// After timezone is set, we show the main menu. Subsequent /start calls
// show the main menu directly.

const composer = new Composer<Ctx>();

const WELCOME =
  "👋 Welcome! Tap a button below to get started.";

// Onboarding hero text shown after timezone is set
const ONBOARDING_COMPLETE =
  "👋 Welcome to Crypto Watcher!\n\n" +
  "Here's how to get started:\n\n" +
  "• 📋 Watchlist — add coins you want to track\n" +
  "• 🔔 Alerts — set price or percentage move alerts\n" +
  "• 💰 Send /price <ticker> to check any coin\n\n" +
  "Tap a button below!";

composer.command("start", async (ctx) => {
  const store = getStore();
  const profile = await store.getProfile(ctx.from!.id);

  if (!profile || !profile.onboardingDone) {
    // Start onboarding: ask for timezone first
    ctx.session.onboardingAwaitingTz = true;
    ctx.session.step = "awaiting_timezone";

    await ctx.reply(
      "👋 Welcome to Crypto Watcher!\n\n" +
      "I'll help you track cryptocurrency prices and set alerts.\n\n" +
      "First, what's your time zone? (e.g., UTC, UTC+2, UTC-5, " +
      "America/New_York, Europe/London, Asia/Tokyo)",
      { reply_markup: { force_reply: true, input_field_placeholder: "Your time zone..." } },
    );
    return;
  }

  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// Handle timezone input during onboarding
composer.on("message:text", async (ctx, next) => {
  if (!ctx.session.onboardingAwaitingTz) return next();

  const tz = ctx.message.text.trim();
  ctx.session.onboardingAwaitingTz = false;
  ctx.session.step = undefined;

  const store = getStore();
  const clock = getClock();

  // Accept any non-empty timezone-like input
  const valid = tz.length > 0 && tz.length < 100;

  await store.saveProfile({
    telegramId: ctx.from!.id,
    displayName: ctx.from?.first_name ?? "User",
    timeZone: valid ? tz : "UTC",
    quietHoursStart: "23:00",
    quietHoursEnd: "07:00",
    morningSummaryTime: "08:00",
    alertCooldownMinutes: 60,
    metricsOptIn: true,
    onboardingDone: true,
    createdAt: clock.nowMs(),
  });

  if (valid) {
    await ctx.reply(`✅ Time zone set to ${tz}!`, {
      reply_markup: { force_reply: false, remove_keyboard: true },
    });
  }

  await ctx.reply(ONBOARDING_COMPLETE, { reply_markup: mainMenuKeyboard() });
});

// Back to main menu
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;