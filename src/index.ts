import app from "./app.js";
  import { logger } from "./lib/logger.js";
  import { connectDB } from "./lib/db.js";
  import { AccountConnection } from "./schema/index.js";
  import { connectInBackground } from "./lib/browser.js";
  import { startTradingEngine } from "./lib/tradingEngine.js";
  import { startStrategyEngine } from "./lib/strategyEngine.js";

  const port = parseInt(process.env.PORT ?? "3000");
  const SELF_URL = process.env.SELF_URL ?? "https://ultratrader.davidcyril.name.ng";

  // Ping self every 14 minutes so Render never puts the server to sleep
  function startSelfPing() {
    const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes
    setInterval(async () => {
      try {
        const res = await fetch(`${SELF_URL}/`);
        logger.debug({ status: res.status }, "Self-ping OK");
      } catch (err) {
        logger.warn({ err }, "Self-ping failed");
      }
    }, PING_INTERVAL);
    logger.info({ url: SELF_URL, intervalMin: 14 }, "Self-ping started — server will stay awake");
  }

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
      startSelfPing();
      autoReconnect();
    })
    .catch((err) => {
      logger.error({ err }, "Failed to connect to MongoDB");
      process.exit(1);
    });
  