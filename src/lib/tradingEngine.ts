import { BotConfig, AccountConnection, Trade, Signal, License } from "../schema/index.js";
import { logger } from "./logger.js";
import * as BrowserService from "./browser.js";

let tradingInterval: ReturnType<typeof setInterval> | null = null;

async function processSignals() {
  try {
    const [account, config] = await Promise.all([AccountConnection.findOne(), BotConfig.findOne()]);
    if (!account?.botRunning || !config) return;

    if (config.session && config.session !== "all") {
      const hour = new Date().getUTCHours();
      if (config.session === "london" && !(hour >= 8 && hour < 17)) return;
      if (config.session === "new_york" && !(hour >= 13 && hour < 22)) return;
      if (config.session === "tokyo" && !(hour >= 0 && hour < 9)) return;
    }

    const symbols = (config.symbols as string[]) ?? ["XAUUSD", "USDZAR", "BTCUSD"];
    let allowedSymbols: string[] | null = null;
    if (account.licenseKey) {
      const license = await License.findOne({ key: account.licenseKey, active: true });
      if (license?.allowedSymbols?.length) allowedSymbols = license.allowedSymbols;
    }

    const activeSignals = await Signal.find({ active: true, asset: { $in: allowedSymbols ?? symbols } }).sort({ createdAt: -1 }).limit(10).lean();
    if (activeSignals.length === 0) return;

    for (const signal of activeSignals) {
      const alreadyExecuted = await Trade.findOne({ symbol: signal.asset, signalId: String(signal._id), status: { $in: ["open", "closed"] } });
      if (alreadyExecuted) continue;

      let lots = Number(config.fixedLot ?? 0.01);
      if (signal.lotSize) lots = signal.lotSize;
      const sl = signal.sl ? parseFloat(signal.sl) : undefined;
      const tp = signal.tp ? parseFloat(signal.tp) : undefined;

      logger.info({ signal: signal._id, asset: signal.asset, action: signal.action }, "Executing signal...");

      let execResult = { success: false, message: "Browser not ready" };
      if (BrowserService.isReady()) {
        execResult = await BrowserService.placeTrade({ symbol: signal.asset, action: signal.action as "BUY" | "SELL", lotSize: lots, sl, tp });
      }

      await new Trade({
        symbol: signal.asset,
        type: signal.action.toLowerCase(),
        lots,
        openPrice: signal.price ? parseFloat(signal.price) : 0,
        stopLoss: sl,
        takeProfit: tp,
        openTime: new Date(),
        status: execResult.success ? "open" : "pending",
        signalId: String(signal._id),
        strategy: "signal",
      }).save();

      if (execResult.success) {
        await Signal.findByIdAndUpdate(signal._id, { active: false });
        await AccountConnection.findOneAndUpdate({}, { lastSignalAt: new Date(), updatedAt: new Date() });
        logger.info({ asset: signal.asset, action: signal.action }, "Signal executed successfully");
      } else {
        logger.warn({ asset: signal.asset, msg: execResult.message }, "Signal execution failed — recorded as pending");
      }
    }
  } catch (err) {
    logger.error({ err }, "Signal processing error");
  }
}

export function startTradingEngine(_mode: string) {
  if (tradingInterval) return;
  logger.info("Trading engine started");
  tradingInterval = setInterval(async () => {
    try { await processSignals(); } catch (err) { logger.error({ err }, "Trading loop error"); }
  }, 30_000);
}

export function stopTradingEngine() {
  if (tradingInterval) { clearInterval(tradingInterval); tradingInterval = null; }
  logger.info("Trading engine stopped");
}
