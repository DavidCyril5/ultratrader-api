import { Router } from "express";
import { BotConfig, AccountConnection } from "../schema/index.js";
import { startTradingEngine, stopTradingEngine } from "../lib/tradingEngine.js";
import { startStrategyEngine, stopStrategyEngine } from "../lib/strategyEngine.js";
import { logger } from "../lib/logger.js";
import * as BrowserService from "../lib/browser.js";

const router = Router();

router.get("/bot/status", async (req, res) => {
  try {
    const account = await AccountConnection.findOne();
    res.json({
      running: account?.botRunning ?? false,
      message: account?.botRunning ? "Bot is actively trading" : "Bot is stopped",
      connectedBroker: account?.broker ?? null,
      activeTrades: parseInt(account?.activeTrades ?? "0"),
      connected: account?.connected ?? false,
      lastSignalAt: account?.lastSignalAt?.toISOString() ?? null,
      browserReady: BrowserService.isReady(),
    });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get bot status" }); }
});

router.post("/bot/start", async (req, res) => {
  try {
    const account = await AccountConnection.findOne();
    if (!account?.connected) { res.status(400).json({ error: "not_connected", message: "No MT5 account connected" }); return; }
    account.botRunning = true;
    account.lastSignalAt = new Date();
    account.updatedAt = new Date();
    await account.save();
    startTradingEngine("browser");
    startStrategyEngine();
    res.json({ running: true, message: "Bot started — auto strategy engine active", connectedBroker: account.broker, activeTrades: 0 });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to start bot" }); }
});

router.post("/bot/stop", async (req, res) => {
  try {
    const account = await AccountConnection.findOne();
    if (account) { account.botRunning = false; account.updatedAt = new Date(); await account.save(); }
    stopTradingEngine();
    stopStrategyEngine();
    res.json({ running: false, message: "Bot stopped", connectedBroker: account?.broker ?? null, activeTrades: 0 });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to stop bot" }); }
});

router.post("/bot/account", async (req, res) => {
  try {
    const { mt5Login, mt5Password, mt5Server, platform, licenseKey } = req.body;
    if (!mt5Login || !mt5Password || !mt5Server) { res.status(400).json({ error: "validation_error", message: "MT5 login, password and server are required" }); return; }
    logger.info({ mt5Login, mt5Server }, "Connecting MT5 account...");
    const accountData = {
      mt5Login: String(mt5Login), mt5Password: String(mt5Password), mt5Server: String(mt5Server),
      platform: platform ?? "MT5", licenseKey: licenseKey ?? "",
      broker: mt5Server.split("-")[0] ?? "Broker", login: String(mt5Login), server: mt5Server,
      balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: "USD",
      connected: true, botRunning: false, updatedAt: new Date(),
    };
    await AccountConnection.findOneAndUpdate({}, accountData, { new: true, upsert: true });
    BrowserService.connectInBackground(String(mt5Login), String(mt5Password), String(mt5Server), platform ?? "MT5");
    res.json({ broker: accountData.broker, server: mt5Server, login: mt5Login, balance: 0, equity: 0, connected: true, connecting: true, message: "Account connected. Opening MT5 terminal..." });
  } catch { res.status(400).json({ error: "connection_error", message: "Failed to connect account" }); }
});

router.get("/bot/account/info", async (req, res) => {
  try {
    const account = await AccountConnection.findOne();
    if (!account?.connected) { res.json({ connected: false }); return; }
    if (BrowserService.isReady()) {
      try {
        const info = await BrowserService.getAccountInfo();
        if (info && info.balance !== undefined) {
          await AccountConnection.findOneAndUpdate({}, { balance: info.balance, equity: info.equity, currency: info.currency, updatedAt: new Date() });
          account.balance = info.balance; account.equity = info.equity ?? account.equity; account.currency = info.currency ?? account.currency;
        }
      } catch {}
    }
    res.json({ broker: account.broker, server: account.server ?? account.mt5Server, login: account.login ?? account.mt5Login, balance: account.balance, equity: account.equity, currency: account.currency, connected: account.connected, synced: BrowserService.isReady() });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get account info" }); }
});

router.delete("/bot/account", async (req, res) => {
  try {
    stopTradingEngine();
    await BrowserService.closeBrowser();
    await AccountConnection.deleteMany({});
    res.json({ success: true, message: "Account disconnected" });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to disconnect" }); }
});

router.get("/bot/config", async (req, res) => {
  try {
    let config = await BotConfig.findOne();
    if (!config) config = await new BotConfig({}).save();
    res.json(config.toObject());
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get bot config" }); }
});

router.put("/bot/config", async (req, res) => {
  try {
    const config = await BotConfig.findOneAndUpdate({}, { ...req.body, updatedAt: new Date() }, { new: true, upsert: true });
    res.json(config!.toObject());
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to update bot config" }); }
});

export default router;
