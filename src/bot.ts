import { Composer } from "grammy";
import { readdirSync } from "node:fs";
import {
  createBot,
  MemorySessionStorage,
  defaultRedisStorage,
  type BotContext,
} from "./toolkit/index.js";
import { Store } from "./store.js";
import { PriceFeed } from "./price-feed.js";
import { systemClock, type Clock } from "./clock.js";

/**
 * Ephemeral conversation state only.
 * Durable domain data goes in the Store (persistent storage).
 */
export interface Session {
  step?: string;
  /** Watchlist: awaiting ticker text input */
  wlAwaitingTicker?: boolean;
  /** Alert: ticker being configured */
  alertTargetTicker?: string;
  /** Alert: direction for price threshold */
  alertDirection?: "above" | "below";
  /** Alert: threshold value (USD) */
  alertThresholdUsd?: number;
  /** Alert: percentage value */
  alertPercent?: number;
  /** Alert: time window in minutes */
  alertTimeWindowMinutes?: number;
  /** Onboarding: awaiting timezone input */
  onboardingAwaitingTz?: boolean;
}

export type Ctx = BotContext<Session>;

// Singletons shared across handlers (set by buildBot)
let _store: Store;
let _priceFeed: PriceFeed;
let _clock: Clock = systemClock;
let _ownerId: number | null = null;

export function getStore(): Store {
  return _store;
}

export function getPriceFeed(): PriceFeed {
  return _priceFeed;
}

export function getClock(): Clock {
  return _clock;
}

export function getOwnerId(): number | null {
  return _ownerId;
}

/**
 * Create a persistent storage adapter for domain data.
 * In-memory for dev/test; Redis in production (when REDIS_URL is set).
 */
function createDomainStorage() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return defaultRedisStorage<unknown>(redisUrl);
  }
  return new MemorySessionStorage<unknown>();
}

/**
 * buildBot — assembles the bot, auto-loads every feature handler from
 * src/handlers/, then registers the global fallback. Does NOT start the bot.
 */
export async function buildBot(token: string) {
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  // Set up shared infrastructure
  _store = new Store(createDomainStorage());
  _priceFeed = new PriceFeed();
  _clock = systemClock;

  // Parse owner ID from env
  const ownerIdStr = process.env.OWNER_ID;
  if (ownerIdStr) {
    const parsed = parseInt(ownerIdStr, 10);
    if (!isNaN(parsed)) _ownerId = parsed;
  }

  const dir = new URL("./handlers/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".js") || f.endsWith(".ts")) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.includes(".spec."),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    files = [];
  }
  for (const file of files.sort()) {
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx> };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    bot.use(mod.default);
  }

  bot.on("message", (ctx) => ctx.reply("Sorry, I didn't understand that. Try /help."));

  return bot;
}