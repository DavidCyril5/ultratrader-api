import { logger } from "./logger.js";
import { AccountConnection } from "../schema/index.js";

interface AccountInfo {
  balance: number;
  equity: number;
  currency: string;
}

interface TradeParams {
  symbol: string;
  action: "BUY" | "SELL";
  lotSize: number;
  sl?: number;
  tp?: number;
}

let browserReady = false;
let browserConnecting = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserPage: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserInstance: any = null;

export function isReady() { return browserReady; }
export function isConnecting() { return browserConnecting; }

export async function connectInBackground(mt5Login: string, mt5Password: string, mt5Server: string, platform = "MT5") {
  if (browserConnecting) return;
  browserConnecting = true;
  browserReady = false;
  logger.info({ mt5Login, mt5Server }, "Starting browser session for MT5 terminal...");
  _connectLoop(mt5Login, mt5Password, mt5Server, platform).catch((err) => {
    logger.error({ err }, "Browser connect loop failed");
    browserConnecting = false;
  });
}

async function _connectLoop(mt5Login: string, mt5Password: string, mt5Server: string, _platform: string, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info({ attempt, mt5Login }, "Browser connect attempt...");
      await _launchAndLogin(mt5Login, mt5Password, mt5Server);
      browserReady = true;
      browserConnecting = false;
      logger.info({ mt5Login }, "Browser session ready");
      _startBalancePoller();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, msg }, "Connect attempt failed, retrying...");
      if (attempt < maxRetries) await _sleep(30_000);
    }
  }
  logger.error({ mt5Login }, "All browser connect attempts failed");
  browserConnecting = false;
}

async function _launchAndLogin(mt5Login: string, mt5Password: string, mt5Server: string) {
  if (browserInstance) { try { await browserInstance.close(); } catch {} }

  let puppeteer;
  try {
    const mod = await import("puppeteer");
    puppeteer = mod.default;
  } catch {
    throw new Error("Puppeteer not available");
  }

  browserInstance = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  browserPage = await browserInstance.newPage();
  await browserPage.setViewport({ width: 1280, height: 800 });
  await browserPage.goto("https://metatraderweb.app/trade", { waitUntil: "networkidle2", timeout: 60_000 });
  await browserPage.waitForSelector('input[name="Login"], input[placeholder*="Login"]', { timeout: 15_000 });

  try {
    const serverInput = await browserPage.$('input[name="Broker"], input[placeholder*="Server"], select[name="Broker"]');
    if (serverInput) {
      const tag = await serverInput.evaluate((el: Element) => el.tagName.toLowerCase());
      if (tag === "select") {
        await browserPage.select('select[name="Broker"]', mt5Server);
      } else {
        await serverInput.click({ clickCount: 3 });
        await serverInput.type(mt5Server);
      }
    }
  } catch { /* server field might not exist */ }

  const loginInput = await browserPage.$('input[name="Login"], input[placeholder*="Login"]');
  if (loginInput) { await loginInput.click({ clickCount: 3 }); await loginInput.type(mt5Login); }

  const passwordInput = await browserPage.$('input[type="password"]');
  if (passwordInput) { await passwordInput.click({ clickCount: 3 }); await passwordInput.type(mt5Password); }

  await browserPage.keyboard.press("Enter");

  await browserPage.waitForFunction(
    () => {
      const el = document.querySelector('[class*="balance"], [data-qa*="balance"], .balance-value');
      return el && el.textContent && el.textContent.length > 0;
    },
    { timeout: 60_000 }
  );
  logger.info({ mt5Login }, "MT5 terminal loaded successfully");
}

function _startBalancePoller() {
  const poll = async () => {
    if (!browserReady || !browserPage) return;
    try {
      const info = await getAccountInfo();
      if (info) {
        await AccountConnection.findOneAndUpdate({}, { balance: info.balance, equity: info.equity, currency: info.currency, updatedAt: new Date() });
      }
    } catch { browserReady = false; }
    setTimeout(poll, 30_000);
  };
  setTimeout(poll, 5_000);
}

export async function getAccountInfo(): Promise<AccountInfo | null> {
  if (!browserPage) return null;
  try {
    return await browserPage.evaluate(() => {
      const getVal = (sels: string[]) => {
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el?.textContent) { const n = parseFloat(el.textContent.replace(/[^0-9.-]/g, "")); if (!isNaN(n)) return n; }
        }
        return null;
      };
      return {
        balance: getVal(['[data-qa="balance"]', '.balance-value', '[class*="balance"]']) ?? 0,
        equity: getVal(['[data-qa="equity"]', '.equity-value', '[class*="equity"]']) ?? 0,
        currency: "USD",
      };
    });
  } catch { return null; }
}

export async function placeTrade(params: TradeParams): Promise<{ success: boolean; message: string }> {
  if (!browserReady || !browserPage) return { success: false, message: "Browser not ready" };
  try {
    const result = await browserPage.evaluate((p: TradeParams) => {
      const btn = document.querySelector('[data-qa="new-order"], button[class*="new-order"], [title*="New Order"]') as HTMLElement;
      if (!btn) return { success: false, message: "New Order button not found" };
      btn.click();
      return { success: true, message: "Order dialog opened" };
    }, params);
    if (!result.success) return result;
    await _sleep(1000);
    await browserPage.evaluate((p: TradeParams) => {
      const symInput = document.querySelector('[data-qa="symbol-input"], input[placeholder*="Symbol"]') as HTMLInputElement;
      if (symInput) { symInput.value = p.symbol; symInput.dispatchEvent(new Event("input", { bubbles: true })); }
      const lotInput = document.querySelector('[data-qa="volume-input"], input[placeholder*="Volume"]') as HTMLInputElement;
      if (lotInput) { lotInput.value = String(p.lotSize); lotInput.dispatchEvent(new Event("input", { bubbles: true })); }
      if (p.sl) { const i = document.querySelector('[data-qa="sl-input"]') as HTMLInputElement; if (i) { i.value = String(p.sl); i.dispatchEvent(new Event("input", { bubbles: true })); } }
      if (p.tp) { const i = document.querySelector('[data-qa="tp-input"]') as HTMLInputElement; if (i) { i.value = String(p.tp); i.dispatchEvent(new Event("input", { bubbles: true })); } }
    }, params);
    await _sleep(500);
    return await browserPage.evaluate((action: string) => {
      const btn = document.querySelector(action === "BUY" ? '[data-qa="buy-btn"], button[class*="buy"]' : '[data-qa="sell-btn"], button[class*="sell"]') as HTMLElement;
      if (!btn) return { success: false, message: "Buy/Sell button not found" };
      btn.click();
      return { success: true, message: `${action} order placed` };
    }, params.action);
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeBrowser() {
  browserReady = false;
  browserConnecting = false;
  if (browserInstance) { try { await browserInstance.close(); } catch {} browserInstance = null; browserPage = null; }
}

function _sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
