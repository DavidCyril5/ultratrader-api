import { Router } from "express";
import { Trade } from "../schema/index.js";

const router = Router();

router.get("/trades", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await Trade.find().sort({ openTime: -1 }).limit(limit);
    res.json(trades.map(t => ({
      id: t._id, symbol: t.symbol, type: t.type, lots: t.lots,
      openPrice: t.openPrice, closePrice: t.closePrice ?? null,
      stopLoss: t.stopLoss ?? null, takeProfit: t.takeProfit ?? null,
      profit: t.profit ?? null, pips: t.pips ?? null,
      openTime: t.openTime?.toISOString(), closeTime: t.closeTime?.toISOString() ?? null,
      status: t.status, strategy: t.strategy ?? null,
    })));
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get trades" }); }
});

router.get("/trades/stats", async (req, res) => {
  try {
    const trades = await Trade.find();
    const closed = trades.filter(t => t.status === "closed");
    const open = trades.filter(t => t.status === "open");
    const wins = closed.filter(t => (t.profit ?? 0) > 0);
    const losses = closed.filter(t => (t.profit ?? 0) <= 0);
    const totalProfit = wins.reduce((s, t) => s + (t.profit ?? 0), 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.profit ?? 0), 0));
    const netProfit = totalProfit - totalLoss;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayProfit = closed.filter(t => t.closeTime && t.closeTime >= today).reduce((s, t) => s + (t.profit ?? 0), 0);
    res.json({
      totalTrades: trades.length, winCount: wins.length, lossCount: losses.length,
      winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      totalProfit, totalLoss, netProfit, profitFactor,
      avgWin: wins.length > 0 ? totalProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
      bestTrade: closed.length > 0 ? Math.max(...closed.map(t => t.profit ?? 0)) : 0,
      worstTrade: closed.length > 0 ? Math.min(...closed.map(t => t.profit ?? 0)) : 0,
      openTrades: open.length, todayProfit,
    });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get trade stats" }); }
});

export default router;
