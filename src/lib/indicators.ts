/**
 * Technical indicator calculations.
 * Pure functions — no side effects, no imports other than types.
 * Implements: SMA, EMA, RSI, MACD, Bollinger Bands
 */

import type { Candle } from "./marketData.js";

// ── Simple Moving Average ────────────────────────────────────────────────────

export function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

// ── Exponential Moving Average ───────────────────────────────────────────────

export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA of first `period` values
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(seed);

  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

// ── RSI ──────────────────────────────────────────────────────────────────────

export function rsi(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  const result: number[] = [];
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) result.push(100);
  else result.push(100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    if (avgLoss === 0) result.push(100);
    else result.push(100 - 100 / (1 + avgGain / avgLoss));
  }

  return result;
}

// ── MACD ─────────────────────────────────────────────────────────────────────

export interface MACDResult {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
}

export function macd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MACDResult {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);

  // Align: fastEma starts at index (fastPeriod-1), slowEma at (slowPeriod-1)
  // So macdLine starts at index (slowPeriod - fastPeriod) within fastEma
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];

  for (let i = 0; i < slowEma.length; i++) {
    macdLine.push(fastEma[i + offset] - slowEma[i]);
  }

  const signalLine = ema(macdLine, signalPeriod);
  const sigOffset = macdLine.length - signalLine.length;
  const histogram: number[] = signalLine.map((s, i) => macdLine[i + sigOffset] - s);

  return { macdLine, signalLine, histogram };
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function bollingerBands(closes: number[], period = 20, stdDevMult = 2): BollingerResult {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    middle.push(avg);
    upper.push(avg + stdDevMult * std);
    lower.push(avg - stdDevMult * std);
  }

  return { upper, middle, lower };
}

// ── Signal Detection Helpers ──────────────────────────────────────────────────

export interface StrategySignal {
  action: "BUY" | "SELL" | "NONE";
  reason: string;
  confidence: number; // 0-1
}

export function detectMACrossover(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  trendPeriod: number,
  direction: "both" | "buy_only" | "sell_only"
): StrategySignal {
  const fastMA = sma(closes, fastPeriod);
  const slowMA = sma(closes, slowPeriod);
  const trendMA = sma(closes, trendPeriod);

  if (fastMA.length < 2 || slowMA.length < 2) return { action: "NONE", reason: "Insufficient data", confidence: 0 };

  const fPrev = fastMA[fastMA.length - 2];
  const fCurr = fastMA[fastMA.length - 1];
  const sPrev = slowMA[slowMA.length - 2];
  const sCurr = slowMA[slowMA.length - 1];
  const trend = trendMA[trendMA.length - 1];
  const price = closes[closes.length - 1];

  const bullishCross = fPrev <= sPrev && fCurr > sCurr;
  const bearishCross = fPrev >= sPrev && fCurr < sCurr;
  const aboveTrend = price > trend;

  if (bullishCross && aboveTrend && direction !== "sell_only") {
    return { action: "BUY", reason: `MA${fastPeriod} crossed above MA${slowPeriod} (price above MA${trendPeriod})`, confidence: 0.7 };
  }
  if (bearishCross && !aboveTrend && direction !== "buy_only") {
    return { action: "SELL", reason: `MA${fastPeriod} crossed below MA${slowPeriod} (price below MA${trendPeriod})`, confidence: 0.7 };
  }
  return { action: "NONE", reason: "No MA crossover", confidence: 0 };
}

export function detectRSI(
  closes: number[],
  period: number,
  overbought: number,
  oversold: number,
  direction: "both" | "buy_only" | "sell_only"
): StrategySignal {
  const rsiValues = rsi(closes, period);
  if (rsiValues.length < 2) return { action: "NONE", reason: "Insufficient data", confidence: 0 };

  const prev = rsiValues[rsiValues.length - 2];
  const curr = rsiValues[rsiValues.length - 1];

  if (prev < oversold && curr >= oversold && direction !== "sell_only") {
    return { action: "BUY", reason: `RSI crossed above oversold (${curr.toFixed(1)})`, confidence: 0.65 };
  }
  if (prev > overbought && curr <= overbought && direction !== "buy_only") {
    return { action: "SELL", reason: `RSI crossed below overbought (${curr.toFixed(1)})`, confidence: 0.65 };
  }
  return { action: "NONE", reason: `RSI at ${curr.toFixed(1)}`, confidence: 0 };
}

export function detectMACD(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
  direction: "both" | "buy_only" | "sell_only"
): StrategySignal {
  const { macdLine, signalLine } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  if (macdLine.length < 2 || signalLine.length < 2) return { action: "NONE", reason: "Insufficient data", confidence: 0 };

  // Align arrays
  const sigOffset = macdLine.length - signalLine.length;
  const mPrev = macdLine[macdLine.length - 2];
  const mCurr = macdLine[macdLine.length - 1];
  const sPrev = signalLine[signalLine.length - 2];
  const sCurr = signalLine[signalLine.length - 1];

  const bullish = mPrev <= sPrev && mCurr > sCurr;
  const bearish = mPrev >= sPrev && mCurr < sCurr;

  if (bullish && direction !== "sell_only") {
    return { action: "BUY", reason: "MACD line crossed above signal", confidence: 0.7 };
  }
  if (bearish && direction !== "buy_only") {
    return { action: "SELL", reason: "MACD line crossed below signal", confidence: 0.7 };
  }
  return { action: "NONE", reason: "No MACD crossover", confidence: 0 };
}

export function detectBollinger(
  closes: number[],
  period: number,
  stdDevMult: number,
  direction: "both" | "buy_only" | "sell_only"
): StrategySignal {
  const { upper, lower } = bollingerBands(closes, period, stdDevMult);
  if (upper.length < 1) return { action: "NONE", reason: "Insufficient data", confidence: 0 };

  const price = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];
  const u = upper[upper.length - 1];
  const l = lower[lower.length - 1];

  if (prevPrice > l && price <= l && direction !== "sell_only") {
    return { action: "BUY", reason: `Price touched lower Bollinger Band (${l.toFixed(4)})`, confidence: 0.65 };
  }
  if (prevPrice < u && price >= u && direction !== "buy_only") {
    return { action: "SELL", reason: `Price touched upper Bollinger Band (${u.toFixed(4)})`, confidence: 0.65 };
  }
  return { action: "NONE", reason: "Price within Bollinger Bands", confidence: 0 };
}

// Combined: requires at least 2 strategies to agree
export function detectCombined(
  closes: number[],
  config: {
    fastMaPeriod: number;
    slowMaPeriod: number;
    trendMaPeriod: number;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;
    macdFastEma: number;
    macdSlowEma: number;
    macdSignal: number;
    bbPeriod: number;
    bbDeviation: number;
    tradeDirection: "both" | "buy_only" | "sell_only";
  }
): StrategySignal {
  const signals: StrategySignal[] = [
    detectMACrossover(closes, config.fastMaPeriod, config.slowMaPeriod, config.trendMaPeriod, config.tradeDirection),
    detectRSI(closes, config.rsiPeriod, config.rsiOverbought, config.rsiOversold, config.tradeDirection),
    detectMACD(closes, config.macdFastEma, config.macdSlowEma, config.macdSignal, config.tradeDirection),
    detectBollinger(closes, config.bbPeriod, config.bbDeviation, config.tradeDirection),
  ];

  const buys = signals.filter((s) => s.action === "BUY");
  const sells = signals.filter((s) => s.action === "SELL");

  if (buys.length >= 2) {
    const avgConf = buys.reduce((a, b) => a + b.confidence, 0) / buys.length;
    return {
      action: "BUY",
      reason: `Combined: ${buys.map((s) => s.reason).join(" + ")}`,
      confidence: avgConf,
    };
  }
  if (sells.length >= 2) {
    const avgConf = sells.reduce((a, b) => a + b.confidence, 0) / sells.length;
    return {
      action: "SELL",
      reason: `Combined: ${sells.map((s) => s.reason).join(" + ")}`,
      confidence: avgConf,
    };
  }
  return { action: "NONE", reason: "Strategies disagree — no trade", confidence: 0 };
}

// Extract close prices from candles
export function getCloses(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}
