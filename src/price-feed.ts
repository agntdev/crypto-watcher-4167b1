/**
 * Price feed — fetches cryptocurrency prices from the CoinGecko API.
 *
 * Call external APIs against their real contract (correct endpoints, ids, params);
 * credentials from env. Uses CoinGecko's free public API (no key needed for basic
 * price queries) with caching and gentle retry logic.
 *
 * CoinGecko API: https://api.coingecko.com/api/v3/
 * Rate limit: 10-30 calls/min for free tier (no API key).
 */

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  currentPriceUsd: number;
  priceChange24hPercent: number;
  lastUpdated: string;
}

export interface PriceFeedConfig {
  /** Base URL for CoinGecko API. Default: https://api.coingecko.com/api/v3 */
  baseUrl?: string;
  /** Retry delay on rate-limit (ms). Default 30000 (30s). */
  rateLimitRetryMs?: number;
  /** Max retries on rate-limit. Default 3. */
  maxRetries?: number;
}

const DEFAULT_CONFIG: Required<PriceFeedConfig> = {
  baseUrl: "https://api.coingecko.com/api/v3",
  rateLimitRetryMs: 30000,
  maxRetries: 3,
};

export class PriceFeed {
  private config: Required<PriceFeedConfig>;

  constructor(config?: PriceFeedConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch current price for one coin by CoinGecko ID.
   * Returns null on error (price feed failures with silent retries).
   */
  async fetchPrice(coingeckoId: string): Promise<CoinPrice | null> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const url = `${this.config.baseUrl}/coins/${encodeURIComponent(coingeckoId)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });

        if (res.status === 429) {
          // Rate-limited — wait and retry
          if (attempt < this.config.maxRetries) {
            await this.sleep(this.config.rateLimitRetryMs);
          }
          continue;
        }

        if (!res.ok) {
          // Non-recoverable — return null silently
          return null;
        }

        const data = (await res.json()) as {
          id: string;
          symbol: string;
          name: string;
          market_data?: {
            current_price?: { usd?: number };
            price_change_percentage_24h?: number;
          };
          last_updated?: string;
        };

        return {
          id: data.id,
          symbol: data.symbol?.toUpperCase() ?? coingeckoId,
          name: data.name ?? coingeckoId,
          currentPriceUsd: data.market_data?.current_price?.usd ?? 0,
          priceChange24hPercent: data.market_data?.price_change_percentage_24h ?? 0,
          lastUpdated: data.last_updated ?? new Date().toISOString(),
        };
      } catch {
        // Network error — retry
        if (attempt < this.config.maxRetries) {
          await this.sleep(2000);
        }
      }
    }
    return null;
  }

  /**
   * Fetch prices for multiple coins in one call (CoinGecko /simple/price).
   * Returns a map of coingeckoId -> CoinPrice.
   * CoinGecko allows up to 250 ids per call.
   */
  async fetchPrices(
    ids: string[],
  ): Promise<Map<string, CoinPrice>> {
    const result = new Map<string, CoinPrice>();
    if (ids.length === 0) return result;

    // Batch in chunks of 250 (CoinGecko limit)
    const batchSize = 250;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const batchResult = await this.fetchPriceBatch(batch);
      for (const [k, v] of batchResult) {
        result.set(k, v);
      }
    }

    return result;
  }

  private async fetchPriceBatch(
    ids: string[],
  ): Promise<Map<string, CoinPrice>> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const idsParam = ids.map((id) => encodeURIComponent(id)).join(",");
        const url = `${this.config.baseUrl}/simple/price?ids=${idsParam}&vs_currencies=usd&include_24hr_change=true`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });

        if (res.status === 429) {
          if (attempt < this.config.maxRetries) {
            await this.sleep(this.config.rateLimitRetryMs);
          }
          continue;
        }

        if (!res.ok) return new Map();

        const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
        const map = new Map<string, CoinPrice>();
        for (const [id, prices] of Object.entries(data)) {
          map.set(id, {
            id,
            symbol: id.toUpperCase(),
            name: id,
            currentPriceUsd: prices.usd ?? 0,
            priceChange24hPercent: prices.usd_24h_change ?? 0,
            lastUpdated: new Date().toISOString(),
          });
        }
        return map;
      } catch {
        if (attempt < this.config.maxRetries) {
          await this.sleep(2000);
        }
      }
    }
    return new Map();
  }

  /**
   * Search for a coin by ticker or name (CoinGecko /search).
   * Returns matching coins with their IDs for use in fetchPrice.
   */
  async searchCoin(query: string): Promise<Array<{ id: string; symbol: string; name: string }>> {
    try {
      const url = `${this.config.baseUrl}/search?query=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) return [];

      const data = (await res.json()) as {
        coins?: Array<{ id: string; symbol: string; name: string }>;
      };

      return (data.coins ?? []).slice(0, 10);
    } catch {
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Known popular coins for quick-add buttons
export const POPULAR_COINS: Array<{ ticker: string; name: string; coingeckoId: string }> = [
  { ticker: "BTC", name: "Bitcoin", coingeckoId: "bitcoin" },
  { ticker: "ETH", name: "Ethereum", coingeckoId: "ethereum" },
  { ticker: "SOL", name: "Solana", coingeckoId: "solana" },
  { ticker: "XRP", name: "XRP", coingeckoId: "ripple" },
  { ticker: "ADA", name: "Cardano", coingeckoId: "cardano" },
  { ticker: "DOGE", name: "Dogecoin", coingeckoId: "dogecoin" },
  { ticker: "DOT", name: "Polkadot", coingeckoId: "polkadot" },
  { ticker: "AVAX", name: "Avalanche", coingeckoId: "avalanche-2" },
  { ticker: "MATIC", name: "Polygon", coingeckoId: "matic-network" },
  { ticker: "LINK", name: "Chainlink", coingeckoId: "chainlink" },
];