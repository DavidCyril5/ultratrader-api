import app from "./app.js";
import { logger } from "./lib/logger.js";
import { connectDB } from "./lib/db.js";
import { AccountConnection } from "./schema/index.js";
import { connectInBackground } from "./lib/browser.js";
import { startTradingEngine } from "./lib/tradingEngine.js";
import { startStrategyEngine } from "./lib/strategyEngine.js";

const port = parseInt(process.env.PORT ?? "3000");

async function autoReconnect() {
  try {
    const account = await AccountConnection.findOne();
    if (!account?.connected || !account?.mt5Login) return;
    logger.info({ login: account.mt5Login, server: account.mt5Server }, "Auto-reconnecting browser session after restart");
    connectInBackground(account.mt5Login, account.mt5Password, account.mt5Server, account.platform ?? "MT5");
    if (account.botRunning) {
      logger.info("Bot was running before restart — resuming trading engine + strategy engine");
      startTradingEngine("browser");
      startStrategyEngine();
    }
  } catch (err) {
    logger.warn({ err }, "Auto-reconnect skipped");
  }
}

connectDB()
  .then(async () => {
    app.listen(port, () => {
      logger.info({ port }, "UltraTrader API server listening");
    });
    autoReconnect();
  })
  .catch((err) => {
    logger.error({ err }, "Failed to connect to MongoDB");
    process.exit(1);
  });
