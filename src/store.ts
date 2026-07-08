/**
 * Persistent store abstraction for the Crypto Watcher bot.
 *
 * Durable domain data lives here — never in-memory maps. Uses the toolkit's
 * persistent storage (Redis-backed in production, in-memory in dev/test).
 *
 * IMPORTANT: No keyspace scans. Use index records to locate records.
 */

import type { StorageAdapter } from "grammy";

// ====== Data entity types ======

export interface UserProfile {
  telegramId: number;
  displayName: string;
  timeZone: string;
  quietHoursStart: string;   // "23:00"
  quietHoursEnd: string;     // "07:00"
  morningSummaryTime: string; // "08:00"
  alertCooldownMinutes: number;
  metricsOptIn: boolean;
  onboardingDone: boolean;
  createdAt: number; // epoch ms
}

export interface WatchlistItem {
  ticker: string;
  displayName: string;
  coingeckoId: string;
  alerts: Alert[];
  addedAt: number;
}

export interface Alert {
  id: string;
  type: "price_threshold" | "percent_move";
  direction?: "above" | "below";
  thresholdValue: number;         // USD for threshold, % for percent_move
  timeWindowMinutes?: number;     // for percent_move
  enabled: boolean;
  lastFiredAt: number | null;
  createdAt: number;
}

export interface NotificationLogEntry {
  id: string;
  userId: number;
  ticker: string;
  alertId: string;
  oldPrice: number | null;
  newPrice: number;
  percentChange: number | null;
  timestamp: number;
}

export interface OwnerMetrics {
  totalUsers: number;
  activeUsers: number;
  mostWatchedTickers: Array<{ ticker: string; count: number }>;
  mostFiredAlerts: Array<{ alertType: string; ticker: string; count: number }>;
  updatedAt: number;
}

export interface QueuedNotification {
  userId: number;
  ticker: string;
  alertId: string;
  oldPrice: number | null;
  newPrice: number;
  percentChange: number | null;
  queuedAt: number;
}

// ====== Index types (what we store for collection management) ======

interface UserIdsIndex {
  ids: number[];
}

interface TickerAlertIds {
  alertIds: string[];
}

// ====== Prefixes ======

const K_PROFILES = "cw:profile:";
const K_WATCHLIST = "cw:wl:";
const K_NOTIF_LOG = "cw:notif:";
const K_METRICS = "cw:metrics";
const K_QUEUED = "cw:q:";
const K_USER_IDS = "cw:user_ids";
const K_TICKER_ALERTS = "cw:tal:";

/**
 * Store holds all durable data operations for the Crypto Watcher bot.
 */
export class Store {
  constructor(private storage: StorageAdapter<unknown>) {}

  // ==================== User Profiles ====================

  private profileKey(id: number): string {
    return K_PROFILES + id;
  }

  async getProfile(userId: number): Promise<UserProfile | undefined> {
    return (await this.storage.read(this.profileKey(userId))) as UserProfile | undefined;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    await this.storage.write(this.profileKey(profile.telegramId), profile);
    // Maintain user-id index
    const idx = await this.readUserIds();
    if (!idx.ids.includes(profile.telegramId)) {
      idx.ids.push(profile.telegramId);
      await this.storage.write(K_USER_IDS, idx);
    }
  }

  async getAllUserIds(): Promise<number[]> {
    const idx = await this.readUserIds();
    return idx.ids;
  }

  async removeUser(userId: number): Promise<void> {
    const idx = await this.readUserIds();
    idx.ids = idx.ids.filter((id) => id !== userId);
    await this.storage.write(K_USER_IDS, idx);
    await this.storage.delete(this.profileKey(userId));
    await this.storage.delete(this.watchlistKey(userId));
    await this.storage.delete(K_NOTIF_LOG + userId);
    await this.storage.delete(K_QUEUED + userId);
  }

  private async readUserIds(): Promise<UserIdsIndex> {
    return ((await this.storage.read(K_USER_IDS)) as UserIdsIndex | undefined) ?? { ids: [] };
  }

  // ==================== Watchlist ====================

  private watchlistKey(userId: number): string {
    return K_WATCHLIST + userId;
  }

  async getWatchlist(userId: number): Promise<WatchlistItem[]> {
    return ((await this.storage.read(this.watchlistKey(userId))) as WatchlistItem[] | undefined) ?? [];
  }

  private async writeWatchlist(userId: number, items: WatchlistItem[]): Promise<void> {
    await this.storage.write(this.watchlistKey(userId), items);
  }

  async addCoinToWatchlist(userId: number, item: WatchlistItem): Promise<void> {
    const items = await this.getWatchlist(userId);
    if (!items.find((i) => i.ticker === item.ticker)) {
      items.push(item);
      await this.writeWatchlist(userId, items);
    }
  }

  async removeCoinFromWatchlist(userId: number, ticker: string): Promise<boolean> {
    const items = await this.getWatchlist(userId);
    const idx = items.findIndex((i) => i.ticker === ticker);
    if (idx < 0) return false;
    items.splice(idx, 1);
    await this.writeWatchlist(userId, items);
    return true;
  }

  async addAlertToWatchlistItem(userId: number, ticker: string, alert: Alert): Promise<void> {
    const items = await this.getWatchlist(userId);
    const item = items.find((i) => i.ticker === ticker);
    if (!item) return;
    item.alerts.push(alert);
    await this.writeWatchlist(userId, items);
    // Index the alert id
    const aiKey = K_TICKER_ALERTS + userId + ":" + ticker;
    const ai = ((await this.storage.read(aiKey)) as TickerAlertIds | undefined) ?? { alertIds: [] };
    ai.alertIds.push(alert.id);
    await this.storage.write(aiKey, ai);
  }

  async removeAlertFromWatchlistItem(userId: number, ticker: string, alertId: string): Promise<boolean> {
    const items = await this.getWatchlist(userId);
    const item = items.find((i) => i.ticker === ticker);
    if (!item) return false;
    const idx = item.alerts.findIndex((a) => a.id === alertId);
    if (idx < 0) return false;
    item.alerts.splice(idx, 1);
    await this.writeWatchlist(userId, items);
    // Clean index
    const aiKey = K_TICKER_ALERTS + userId + ":" + ticker;
    const ai = ((await this.storage.read(aiKey)) as TickerAlertIds | undefined) ?? { alertIds: [] };
    ai.alertIds = ai.alertIds.filter((id) => id !== alertId);
    await this.storage.write(aiKey, ai);
    return true;
  }

  async updateAlertFiredAt(userId: number, ticker: string, alertId: string, timestamp: number): Promise<void> {
    const items = await this.getWatchlist(userId);
    const item = items.find((i) => i.ticker === ticker);
    if (!item) return;
    const alert = item.alerts.find((a) => a.id === alertId);
    if (!alert) return;
    alert.lastFiredAt = timestamp;
    await this.writeWatchlist(userId, items);
  }

  /** Collect all unique (ticker, coingeckoId) pairs across all users. */
  async getUniqueTickersForFetch(): Promise<Array<{ ticker: string; coingeckoId: string }>> {
    const userIds = await this.getAllUserIds();
    const map = new Map<string, string>();
    for (const uid of userIds) {
      const wl = await this.getWatchlist(uid);
      for (const item of wl) {
        if (!map.has(item.ticker)) {
          map.set(item.ticker, item.coingeckoId);
        }
      }
    }
    return Array.from(map.entries()).map(([ticker, cid]) => ({ ticker, coingeckoId: cid }));
  }

  /** All active alerts across all users. */
  async getAllActiveAlerts(): Promise<Array<{ userId: number; ticker: string; alert: Alert }>> {
    const userIds = await this.getAllUserIds();
    const out: Array<{ userId: number; ticker: string; alert: Alert }> = [];
    for (const uid of userIds) {
      const wl = await this.getWatchlist(uid);
      for (const item of wl) {
        for (const al of item.alerts) {
          if (al.enabled) {
            out.push({ userId: uid, ticker: item.ticker, alert: al });
          }
        }
      }
    }
    return out;
  }

  // ==================== Notification Log (90-day retention, capped at 1000) ====================

  private notifLogKey(userId: number): string {
    return K_NOTIF_LOG + userId;
  }

  async addNotificationLogEntry(entry: NotificationLogEntry): Promise<void> {
    const key = this.notifLogKey(entry.userId);
    const existing = ((await this.storage.read(key)) as NotificationLogEntry[] | undefined) ?? [];
    existing.push(entry);
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const trimmed = existing.filter((e) => e.timestamp >= cutoff).slice(-1000);
    await this.storage.write(key, trimmed);
  }

  async getRecentNotifications(userId: number, limit = 5): Promise<NotificationLogEntry[]> {
    const existing = ((await this.storage.read(this.notifLogKey(userId))) as NotificationLogEntry[] | undefined) ?? [];
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return existing.filter((e) => e.timestamp >= cutoff).slice(-limit);
  }

  // ==================== Queued Notifications (quiet hours) ====================

  async addQueuedNotification(entry: QueuedNotification): Promise<void> {
    const key = K_QUEUED + entry.userId;
    const existing = ((await this.storage.read(key)) as QueuedNotification[] | undefined) ?? [];
    existing.push(entry);
    await this.storage.write(key, existing);
  }

  async getAndClearQueuedNotifications(userId: number): Promise<QueuedNotification[]> {
    const key = K_QUEUED + userId;
    const existing = ((await this.storage.read(key)) as QueuedNotification[] | undefined) ?? [];
    await this.storage.delete(key);
    return existing;
  }

  // ==================== Owner Metrics ====================

  async getOwnerMetrics(): Promise<OwnerMetrics | undefined> {
    return (await this.storage.read(K_METRICS)) as OwnerMetrics | undefined;
  }

  async saveOwnerMetrics(metrics: OwnerMetrics): Promise<void> {
    await this.storage.write(K_METRICS, metrics);
  }

  async computeOwnerMetrics(): Promise<OwnerMetrics> {
    const userIds = await this.getAllUserIds();
    const tickerCount = new Map<string, number>();
    const alertCount = new Map<string, number>();

    for (const uid of userIds) {
      const wl = await this.getWatchlist(uid);
      for (const item of wl) {
        tickerCount.set(item.ticker, (tickerCount.get(item.ticker) ?? 0) + 1);
        for (const al of item.alerts) {
          const key = `${al.type}:${item.ticker}`;
          alertCount.set(key, (alertCount.get(key) ?? 0) + 1);
        }
      }
    }

    const mostWatched = Array.from(tickerCount.entries())
      .map(([t, c]) => ({ ticker: t, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const mostFired = Array.from(alertCount.entries())
      .map(([k, c]) => {
        const [alertType, ticker] = k.split(":");
        return { alertType, ticker, count: c };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const metrics: OwnerMetrics = {
      totalUsers: userIds.length,
      activeUsers: userIds.length,
      mostWatchedTickers: mostWatched,
      mostFiredAlerts: mostFired,
      updatedAt: Date.now(),
    };

    await this.saveOwnerMetrics(metrics);
    return metrics;
  }
}