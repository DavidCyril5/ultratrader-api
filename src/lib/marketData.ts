/**
 * Market data fetcher — pulls live OHLCV price candles from Yahoo Finance.
 * Free, no API key required. Works for forex, gold, and crypto.
 */

import { logger } from "./logger.js";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Map MT5 symbol names → Yahoo Finance tickers
const SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "GC=F",       // Gold futures
  BTCUSD: "BTC-USD",    // Bitcoin
  USDZAR: "ZAR=X",      // USD/ZAR
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "JPY=X",
  USDCHF: "CHF=X",
  AUDUSD: "AUDUSD=X",
  NZDUSD: "NZDUSD=X",
  USDCAD: "CAD=X",
  ETHUSD: "ETH-USD",
  XAGUSD: "SI=F",       // Silver
};

// Map BotConfig timeframe → Yahoo Finance interval + range
const TIMEFRAME_MAP: Record<string, { interval: string; range: string }> = {
  M1:  { interval: "1m",  range: "1d"  },
  M5:  { interval: "5m",  range: "5d"  },
  M15: { interval: "15m", range: "5d"  },
  M30: { interval: "30m", range: "1mo" },
  H1:  { interval: "60m", range: "1mo" },
  H4:  { interval: "60m", range: "3mo" }, // use 1h candles, check every 4h
  D1:  { interval: "1d",  range: "1y"  },
};

function toYahooSymbol(mt5Symbol: string): string {
  return SYMBOL_MAP[mt5Symbol.toUpperCase()] ?? `${mt5Symbol}=X`;
}

export async function fetchCandles(mt5Symbol: string, timeframe: string, count = 250): Promise<Candle[]> {
  const yahooSymbol = toYahooSymbol(mt5Symbol);
  const tf = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP["H1"];

  try {
    // Use Yahoo Finance v8 chart API directly — no API key needed
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${tf.interval}&range=${tf.range}&includePrePost=false`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Yahoo Finance HTTP ${res.status}`);
    }

    const json = await res.json() as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>;
        error?: { message: string };
      };
    };

    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(json?.chart?.error?.message ?? "No data returned");

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const opens = quote.open ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];
    const closes = quote.close ?? [];
    const volumes = quote.volume ?? [];

    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({
        time: timestamps[i],
        open: o,
        high: h,
        low: l,
        close: c,
        volume: volumes[i] ?? 0,
      });
    }

    // Return most recent `count` candles
    const trimmed = candles.slice(-count);
    logger.debug({ symbol: mt5Symbol, yahooSymbol, candles: trimmed.length, timeframe }, "Fetched candles");
    return trimmed;
  } catch (err) {
    logger.warn({ err, symbol: mt5Symbol, yahooSymbol }, "Failed to fetch market data");
    return [];
  }
}

export function getLatestPrice(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  return candles[candles.length - 1].close;
}

// How often to run the strategy for each timeframe (milliseconds)
export const TIMEFRAME_INTERVAL_MS: Record<string, number> = {
  M1:  1 * 60 * 1000,
  M5:  5 * 60 * 1000,
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1:  60 * 60 * 1000,
  H4:  4 * 60 * 60 * 1000,
  D1:  24 * 60 * 60 * 1000,
};
