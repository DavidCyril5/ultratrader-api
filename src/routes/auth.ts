import { Router } from "express";
import { License } from "../schema/index.js";

const router = Router();

router.post("/auth/activate", async (req, res) => {
  try {
    const { licenseKey, phoneSecret } = req.body;
    if (!licenseKey) { res.status(400).json({ error: "validation_error", message: "License key is required" }); return; }

    const license = await License.findOne({ key: licenseKey, active: true });
    if (!license) { res.status(401).json({ error: "invalid_license", message: "Invalid or inactive license key" }); return; }
    if (license.expiresAt && new Date() > license.expiresAt) { res.status(401).json({ error: "expired_license", message: "License key has expired" }); return; }
    if (license.phoneSecret && license.phoneSecret !== "" && phoneSecret !== license.phoneSecret) {
      res.status(401).json({ error: "invalid_secret", message: "Invalid phone secret" }); return;
    }

    res.json({ valid: true, licenseKey: license.key, ownerName: license.ownerName, ownerEmail: license.ownerEmail, allowedSymbols: license.allowedSymbols, expiresAt: license.expiresAt?.toISOString() ?? null, message: "License activated successfully" });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to validate license" }); }
});

router.get("/auth/check", async (req, res) => {
  try {
    const licenseKey = req.headers["x-license-key"] as string;
    if (!licenseKey) { res.status(401).json({ valid: false }); return; }
    const license = await License.findOne({ key: licenseKey, active: true });
    if (!license || (license.expiresAt && new Date() > license.expiresAt)) { res.status(401).json({ valid: false }); return; }
    res.json({ valid: true, ownerName: license.ownerName, allowedSymbols: license.allowedSymbols, expiresAt: license.expiresAt?.toISOString() ?? null });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to check license" }); }
});

router.post("/auth/license", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"] as string;
    if (adminKey !== (process.env.ADMIN_KEY ?? "ultratrader-admin-2024")) { res.status(403).json({ error: "forbidden", message: "Invalid admin key" }); return; }
    const { key, ownerName, ownerEmail, phoneSecret, allowedSymbols, expiresAt } = req.body;
    if (!key) { res.status(400).json({ error: "validation_error", message: "License key is required" }); return; }
    const license = await License.findOneAndUpdate(
      { key },
      { key, ownerName: ownerName ?? "", ownerEmail: ownerEmail ?? "", phoneSecret: phoneSecret ?? "", allowedSymbols: allowedSymbols ?? ["XAUUSD", "USDZAR", "BTCUSD"], expiresAt: expiresAt ? new Date(expiresAt) : null, active: true },
      { upsert: true, new: true }
    );
    res.json({ success: true, license: { key: license.key, ownerName: license.ownerName, phoneSecret: license.phoneSecret, allowedSymbols: license.allowedSymbols } });
  } catch { res.status(500).json({ error: "internal_error", message: "Failed to create license" }); }
});

router.get("/auth/licenses", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"] as string;
    if (adminKey !== (process.env.ADMIN_KEY ?? "ultratrader-admin-2024")) { res.status(403).json({ error: "forbidden" }); return; }
    const licenses = await License.find({}).lean();
    res.json(licenses);
  } catch { res.status(500).json({ error: "internal_error" }); }
});

export default router;
