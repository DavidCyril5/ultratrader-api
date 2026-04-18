/**
   * Auto Strategy Engine — the "brain" of UltraTrader.
   * Standalone version: imports from local schema, not @workspace/db
   */

  import { BotConfig, AccountConnection, Signal, Trade } from "../schema/index.js";
  import { logger } from "./logger.js";
  import { fetchCandles, getLatestPrice, TIMEFRAME_INTERVAL_MS } from "./marketData.js";
  import {
    getCloses,
    detectMACrossover,
    detectRSI,
    detectMACD,
    detectBollinger,
    detectCombined,
    type StrategySignal,
  } from "./indicators.js";

  let strategyTimer: ReturnType<typeof setInterval> | null = null;
  let lastTimeframe = "H1";

  const lastSignalTime: Record<string, number> = {};
  const MIN_SIGNAL_GAP_MS = 60 * 60 * 1000;

  export async function runStrategyOnce() {
    try {
      const [config, account] = await Promise.all([
        BotConfig.findOne(),
        AccountConnection.findOne(),
      ]);

      if (!config || !account?.botRunning) return;

      if (config.session && config.session !== "all") {
        const hour = new Date().getUTCHours();
        const sessions: Record<string, boolean> = {
          london:   hour >= 8 && hour < 17,
          new_york: hour >= 13 && hour < 22,
          tokyo:    hour >= 0 && hour < 9,
          overlap:  hour >= 13 && hour < 17,
        };
        if (!sessions[config.session]) {
          logger.debug({ session: config.session }, "Outside trading session — skipping");
          return;
        }
      }

      if (config.useDailyLossLimit || config.useDailyProfitLimit) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTrades = await Trade.find({ openTime: { $gte: today }, status: "closed" });
        const todayPnl = todayTrades.reduce((sum: number, t: any) => sum + (t.profit ?? 0), 0);

        if (config.useDailyLossLimit && todayPnl < -Math.abs(config.dailyLossLimit)) {
          logger.info({ todayPnl, limit: config.dailyLossLimit }, "Daily loss limit reached — no more trades today");
          return;
        }
        if (config.useDailyProfitLimit && todayPnl > config.dailyProfitLimit) {
          logger.info({ todayPnl, limit: config.dailyProfitLimit }, "Daily profit target reached — no more trades today");
          return;
        }
      }

      const openCount = await Trade.countDocuments({ status: "open" });
      if (openCount >= config.maxPositions) {
        logger.debug({ openCount, max: config.maxPositions }, "Max positions reached — skipping");
        return;
      }

      const symbols: string[] = (config.symbols as string[]) ?? ["XAUUSD", "USDZAR", "BTCUSD"];
      const timeframe: string = (config.timeframe as string) ?? "H1";
      const strategy: string = (config.strategy as string) ?? "combined";

      logger.info({ strategy, timeframe, symbols }, "Running auto strategy scan...");

      for (const symbol of symbols) {
        try {
          await analyzeSymbol(symbol, timeframe, strategy, config, openCount, config.maxPositions as number);
        } catch (err) {
          logger.warn({ err, symbol }, "Strategy analysis failed for symbol");
        }
      }
    } catch (err) {
      logger.error({ err }, "Strategy engine error");
    }
  }

  async function analyzeSymbol(
    symbol: string,
    timeframe: string,
    strategy: string,
    config: any,
    openCount: number,
    maxPositions: number
  ) {
    const lastTime = lastSignalTime[symbol] ?? 0;
    if (Date.now() - lastTime < MIN_SIGNAL_GAP_MS) {
      logger.debug({ symbol }, "Signal gap not met — skipping");
      return;
    }

    const openBuys = await Trade.countDocuments({ symbol, type: "buy", status: "open" });
    const openSells = await Trade.countDocuments({ symbol, type: "sell", status: "open" });

    const candles = await fetchCandles(symbol, timeframe, 250);
    if (candles.length < 50) {
      logger.warn({ symbol, candles: candles.length }, "Not enough candles for analysis");
      return;
    }

    const closes = getCloses(candles);
    const latestPrice = getLatestPrice(candles);
    if (!latestPrice) return;

    let signal: StrategySignal;
    const dir = (config.tradeDirection as "both" | "buy_only" | "sell_only") ?? "both";

    switch (strategy) {
      case "ma_crossover":
        signal = detectMACrossover(closes, config.fastMaPeriod, config.slowMaPeriod, config.trendMaPeriod, dir);
        break;
      case "rsi":
        signal = detectRSI(closes, config.rsiPeriod, config.rsiOverbought, config.rsiOversold, dir);
        break;
      case "macd":
        signal = detectMACD(closes, config.macdFastEma, config.macdSlowEma, config.macdSignal, dir);
        break;
      case "bollinger":
        signal = detectBollinger(closes, config.bbPeriod, config.bbDeviation, dir);
        break;
      case "combined":
      default:
        signal = detectCombined(closes, config);
    }

    if (signal.action === "NONE") {
      logger.debug({ symbol, reason: signal.reason }, "No signal");
      return;
    }

    if (signal.action === "BUY" && openBuys >= config.maxBuys) {
      logger.debug({ symbol, openBuys, max: config.maxBuys }, "Max buys reached");
      return;
    }
    if (signal.action === "SELL" && openSells >= config.maxSells) {
      logger.debug({ symbol, openSells, max: config.maxSells }, "Max sells reached");
      return;
    }

    const pipSize = getPipSize(symbol);
    const sl = signal.action === "BUY"
      ? (latestPrice - config.stopLossPips * pipSize).toFixed(5)
      : (latestPrice + config.stopLossPips * pipSize).toFixed(5);
    const tp = signal.action === "BUY"
      ? (latestPrice + config.takeProfitPips * pipSize).toFixed(5)
      : (latestPrice - config.takeProfitPips * pipSize).toFixed(5);

    const lots = calculateLots(config, latestPrice);

    const existingSignal = await Signal.findOne({
      asset: symbol,
      action: signal.action,
      active: true,
    });
    if (existingSignal) {
      logger.debug({ symbol, action: signal.action }, "Active signal already exists — skipping");
      return;
    }

    await Signal.create({
      action: signal.action,
      asset: symbol,
      price: latestPrice.toFixed(5),
      sl,
      tp,
      lotSize: lots,
      platform: "MT5",
      note: `Auto: ${signal.reason} (conf: ${(signal.confidence * 100).toFixed(0)}%)`,
      active: true,
    });

    lastSignalTime[symbol] = Date.now();

    logger.info({
      symbol,
      action: signal.action,
      price: latestPrice.toFixed(5),
      sl,
      tp,
      lots,
      reason: signal.reason,
      confidence: `${(signal.confidence * 100).toFixed(0)}%`,
    }, "Auto signal generated");
  }

  function getPipSize(symbol: string): number {
    const upper = symbol.toUpperCase();
    if (upper.includes("XAU") || upper.includes("GOLD")) return 0.1;
    if (upper.includes("BTC") || upper.includes("ETH")) return 1.0;
    if (upper.includes("JPY")) return 0.01;
    if (upper.includes("ZAR")) return 0.001;
    return 0.0001;
  }

  function calculateLots(config: any, price: number): number {
    switch (config.lotMode) {
      case "fixed":
        return Number(config.fixedLot ?? 0.01);
      case "fixed_dollar":
        if (config.stopLossPips > 0) {
          const pipValue = 10;
          const lots = config.fixedDollarRisk / (config.stopLossPips * pipValue);
          return Math.max(0.01, parseFloat(lots.toFixed(2)));
        }
        return Number(config.fixedLot ?? 0.01);
      case "percent_balance":
      default:
        return Number(config.fixedLot ?? 0.01);
    }
  }

  export function startStrategyEngine() {
    if (strategyTimer) stopStrategyEngine();
    setTimeout(() => runStrategyOnce(), 5000);
    scheduleNext();
    logger.info("Auto strategy engine started");
  }

  async function scheduleNext() {
    try {
      const config = await BotConfig.findOne();
      const timeframe = (config?.timeframe as string) ?? "H1";
      const intervalMs = TIMEFRAME_INTERVAL_MS[timeframe] ?? TIMEFRAME_INTERVAL_MS["H1"];

      if (strategyTimer) clearInterval(strategyTimer);
      strategyTimer = setInterval(async () => {
        await runStrategyOnce();
        const fresh = await BotConfig.findOne();
        const newTf = (fresh?.timeframe as string) ?? "H1";
        if (newTf !== lastTimeframe) {
          lastTimeframe = newTf;
          scheduleNext();
        }
      }, intervalMs);

      lastTimeframe = timeframe;
      logger.info({ timeframe, intervalMs: intervalMs / 60000 + "min" }, "Strategy engine scheduled");
    } catch (err) {
      logger.error({ err }, "Failed to schedule strategy engine");
    }
  }

  export function stopStrategyEngine() {
    if (strategyTimer) {
      clearInterval(strategyTimer);
      strategyTimer = null;
    }
    logger.info("Auto strategy engine stopped");
  }

  export function isStrategyRunning() {
    return strategyTimer !== null;
  }
  