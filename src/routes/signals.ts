import { Router } from "express";
import { Signal, License } from "../schema/index.js";

const router = Router();

router.get("/signals", async (req, res) => {
  try {
    const phoneSecret = (req.query.phone_secret as string) || (req.headers["x-phone-secret"] as string);
    const licenseKey = req.headers["x-license-key"] as string;
    let allowedSymbols: string[] | null = null;

    if (phoneSecret) {
      const license = await License.findOne({ phoneSecret, active: true });
      if (license?.allowedSymbols?.length) allowedSymbols = license.allowedSymbols;
    } else if (licenseKey) {
      const license = await License.findOne({ key: licenseKey, active: true });
      if (license?.allowedSymbols?.length) allowedSymbols = license.allowedSymbols;
    }

    const filter: Record<string, unknown> = { active: true };
    if (allowedSymbols) filter.asset = { $in: allowedSymbols };
    const signals = await Signal.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json(signals);
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get signals" }); }
});

router.get("/signals/latest", async (req, res) => {
  try {
    const phoneSecret = (req.query.phone_secret as string) || (req.headers["x-phone-secret"] as string);
    let allowedSymbols: string[] | null = null;
    if (phoneSecret) {
      const license = await License.findOne({ phoneSecret, active: true });
      if (license?.allowedSymbols?.length) allowedSymbols = license.allowedSymbols;
    }
    const filter: Record<string, unknown> = { active: true };
    if (allowedSymbols) filter.asset = { $in: allowedSymbols };
    const signals = await Signal.find(filter).sort({ createdAt: -1 }).limit(20).lean();
    const seen = new Set<string>();
    const latest = signals.filter((s) => { if (seen.has(s.asset)) return false; seen.add(s.asset); return true; });
    res.json(latest);
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to get latest signals" }); }
});

router.post("/signals", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"] as string;
    if (adminKey !== (process.env.ADMIN_KEY ?? "ultratrader-admin-2024")) { res.status(403).json({ error: "forbidden", message: "Invalid admin key" }); return; }
    const { action, asset, price, sl, tp, lotSize, platform, note } = req.body;
    if (!action || !asset) { res.status(400).json({ error: "validation_error", message: "action and asset are required" }); return; }
    const signal = await Signal.create({ action: action.toUpperCase(), asset: asset.toUpperCase(), price: price ?? "", sl: sl ?? "", tp: tp ?? "", lotSize: lotSize ?? 0.01, platform: platform ?? "MT5", note: note ?? "", active: true });
    res.json({ success: true, signal });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to create signal" }); }
});

router.delete("/signals/:id", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"] as string;
    if (adminKey !== (process.env.ADMIN_KEY ?? "ultratrader-admin-2024")) { res.status(403).json({ error: "forbidden" }); return; }
    await Signal.findByIdAndUpdate(req.params.id, { active: false });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "internal_error" }); }
});

export default router;
