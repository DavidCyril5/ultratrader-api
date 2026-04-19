/**
 * MT5 execution layer.
 *
 * Priority order:
 * 1. Python bridge (mt5_bridge.py running on VPS — calls mt5.order_send() directly)
 * 2. Browser/Puppeteer fallback (not reliable, kept for compatibility)
 */

import { logger } from "./logger.js";
import { AccountConnection } from "@workspace/db";

// Python bridge — runs on VPS alongside MT5 terminal in Wine
const PYTHON_BRIDGE_URL = process.env.MT5_BRIDGE_URL ?? "http://localhost:5000";
let pythonBridgeReady = false;

async function checkPythonBridge(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json() as { ok: boolean; connected?: boolean };
    pythonBridgeReady = data.ok === true && data.connected === true;
    return pythonBridgeReady;
  } catch {
    pythonBridgeReady = false;
    return false;
  }
}

// Poll Python bridge every 30 seconds
setInterval(async () => {
  const was = pythonBridgeReady;
  const now = await checkPythonBridge();
  if (now && !was) logger.info("Python MT5 bridge connected — using native MT5 for trade execution");
  if (!now && was) logger.warn("Python MT5 bridge disconnected — will retry");
}, 30_000);

// Check immediately on startup
checkPythonBridge().then(ok => {
  if (ok) logger.info("Python MT5 bridge available on startup");
  else logger.info("Python MT5 bridge not available — will use browser fallback");
});

interface AccountInfo {
  balance: number;
  equity: number;
  currency: string;
  login?: string;
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

export function isReady() {
  return pythonBridgeReady || browserReady;
}

export function isConnecting() {
  return browserConnecting;
}

/**
 * Starts the browser session in the background.
 * Does not block — polls until login succeeds.
 */
export async function connectInBackground(
  mt5Login: string,
  mt5Password: string,
  mt5Server: string,
  platform = "MT5"
) {
  if (browserConnecting) return;
  browserConnecting = true;
  browserReady = false;

  logger.info({ mt5Login, mt5Server }, "Starting browser session for MT5 terminal...");

  // Fire and forget — we keep retrying until success
  _connectLoop(mt5Login, mt5Password, mt5Server, platform).catch((err) => {
    logger.error({ err }, "Browser connect loop failed");
    browserConnecting = false;
  });
}

async function _connectLoop(
  mt5Login: string,
  mt5Password: string,
  mt5Server: string,
  platform: string,
  maxRetries = 5
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info({ attempt, mt5Login }, "Browser connect attempt...");
      await _launchAndLogin(mt5Login, mt5Password, mt5Server, platform);
      browserReady = true;
      browserConnecting = false;
      logger.info({ mt5Login }, "Browser session ready — MT5 terminal logged in");

      // Refresh balance every 30 seconds
      _startBalancePoller();
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, msg }, "Browser connect attempt failed, retrying...");
      if (attempt < maxRetries) {
        await _sleep(30_000);
      }
    }
  }
  logger.error({ mt5Login }, "All browser connect attempts failed");
  browserConnecting = false;
}

async function _launchAndLogin(
  mt5Login: string,
  mt5Password: string,
  mt5Server: string,
  _platform: string
) {
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
  }

  // Dynamic import to avoid crash if puppeteer is not installed
  let puppeteer;
  try {
    const mod = await import("puppeteer");
    puppeteer = mod.default;
  } catch {
    throw new Error("Puppeteer is not available in this environment. Install puppeteer to enable automatic trading.");
  }

  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
    ],
  });

  browserPage = await browserInstance.newPage();
  await browserPage.setViewport({ width: 1280, height: 800 });

  // Navigate to MT5 web terminal
  logger.info("Navigating to MT5 web terminal...");
  await browserPage.goto("https://metatraderweb.app/trade", { waitUntil: "networkidle2", timeout: 60_000 });

  // Wait for login form
  await browserPage.waitForSelector('input[name="Login"], input[placeholder*="Login"], input[placeholder*="login"]', { timeout: 15_000 });

  // Fill server
  try {
    const serverInput = await browserPage.$('input[name="Broker"], input[placeholder*="Server"], input[placeholder*="server"], select[name="Broker"]');
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

  // Fill login
  const loginInput = await browserPage.$('input[name="Login"], input[placeholder*="Login"]');
  if (loginInput) {
    await loginInput.click({ clickCount: 3 });
    await loginInput.type(mt5Login);
  }

  // Fill password
  const passwordInput = await browserPage.$('input[type="password"]');
  if (passwordInput) {
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(mt5Password);
  }

  // Submit
  await browserPage.keyboard.press("Enter");

  // Wait for the terminal to load (balance appears)
  await browserPage.waitForFunction(
    () => {
      const balanceEl = document.querySelector('[class*="balance"], [data-qa*="balance"], .balance-value');
      return balanceEl && balanceEl.textContent && balanceEl.textContent.length > 0;
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
        await AccountConnection.findOneAndUpdate(
          {},
          {
            balance: info.balance,
            equity: info.equity,
            currency: info.currency,
            updatedAt: new Date(),
          }
        );
        logger.debug({ balance: info.balance }, "Balance refreshed from browser");
      }
    } catch (err) {
      logger.warn({ err }, "Balance poll failed");
      browserReady = false;
    }
    setTimeout(poll, 30_000);
  };
  setTimeout(poll, 5_000);
}

/**
 * Reads account balance/equity from the open MT5 terminal.
 */
export async function getAccountInfo(): Promise<AccountInfo | null> {
  if (!browserPage) return null;
  try {
    const info = await browserPage.evaluate(() => {
      // Try common selectors used in the MT5 web terminal
      const getVal = (selectors: string[]) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent) {
            const n = parseFloat(el.textContent.replace(/[^0-9.-]/g, ""));
            if (!isNaN(n)) return n;
          }
        }
        return null;
      };

      const balance = getVal(['[data-qa="balance"]', '.balance-value', '[class*="balance"]', 'td[class*="balance"]']);
      const equity = getVal(['[data-qa="equity"]', '.equity-value', '[class*="equity"]']);

      return { balance, equity, currency: "USD" };
    });
    return info;
  } catch {
    return null;
  }
}

/**
 * Places a trade — tries Python bridge first (native MT5), then Puppeteer fallback.
 */
export async function placeTrade(params: TradeParams): Promise<{ success: boolean; message: string }> {
  // Try Python bridge first — native MT5 connection via Wine
  if (pythonBridgeReady) {
    try {
      logger.info({ params }, "Placing trade via Python MT5 bridge...");
      const res = await fetch(`${PYTHON_BRIDGE_URL}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15000),
      });
      const result = await res.json() as { success: boolean; message?: string; error?: string; ticket?: number };
      if (result.success) {
        logger.info({ result, params }, "Trade placed via Python bridge successfully");
        return { success: true, message: result.ticket ? `Order #${result.ticket} placed` : "Trade placed" };
      }
      logger.warn({ result }, "Python bridge trade failed, falling back to browser");
    } catch (err) {
      logger.warn({ err }, "Python bridge request failed, falling back to browser");
    }
  }

  if (!browserReady || !browserPage) {
    return { success: false, message: "No trade execution method available (Python bridge not connected, browser not ready)" };
  }

  try {
    logger.info({ params }, "Placing trade via browser...");

    const result = await browserPage.evaluate(
      (p: TradeParams) => {
        // Try to find and click "New Order" button
        const newOrderBtn = document.querySelector(
          '[data-qa="new-order"], button[class*="new-order"], [title*="New Order"]'
        ) as HTMLElement;

        if (!newOrderBtn) return { success: false, message: "New Order button not found" };
        newOrderBtn.click();

        return { success: true, message: "New order dialog opened" };
      },
      params
    );

    if (!result.success) return result;

    // Wait for order dialog
    await _sleep(1000);

    // Fill in the order form
    await browserPage.evaluate(
      (p: TradeParams) => {
        // Set symbol
        const symbolInput = document.querySelector(
          '[data-qa="symbol-input"], input[placeholder*="Symbol"]'
        ) as HTMLInputElement;
        if (symbolInput) {
          symbolInput.value = p.symbol;
          symbolInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Set lot size
        const lotInput = document.querySelector(
          '[data-qa="volume-input"], input[placeholder*="Volume"], input[placeholder*="Lot"]'
        ) as HTMLInputElement;
        if (lotInput) {
          lotInput.value = String(p.lotSize);
          lotInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Set SL/TP
        if (p.sl) {
          const slInput = document.querySelector(
            '[data-qa="sl-input"], input[placeholder*="Stop Loss"]'
          ) as HTMLInputElement;
          if (slInput) {
            slInput.value = String(p.sl);
            slInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        if (p.tp) {
          const tpInput = document.querySelector(
            '[data-qa="tp-input"], input[placeholder*="Take Profit"]'
          ) as HTMLInputElement;
          if (tpInput) {
            tpInput.value = String(p.tp);
            tpInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      },
      params
    );

    await _sleep(500);

    // Click Buy or Sell
    const tradeResult = await browserPage.evaluate((action: string) => {
      const btn = document.querySelector(
        action === "BUY"
          ? '[data-qa="buy-btn"], button[class*="buy"]'
          : '[data-qa="sell-btn"], button[class*="sell"]'
      ) as HTMLElement;

      if (!btn) return { success: false, message: "Buy/Sell button not found" };
      btn.click();
      return { success: true, message: `${action} order placed` };
    }, params.action);

    logger.info({ tradeResult, params }, "Trade placement result");
    return tradeResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, params }, "Trade placement failed");
    return { success: false, message: msg };
  }
}

export async function closeBrowser() {
  browserReady = false;
  browserConnecting = false;
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    browserPage = null;
  }
}

function _sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
