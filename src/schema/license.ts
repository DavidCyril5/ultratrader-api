import mongoose from "mongoose";

const licenseSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  phoneSecret: { type: String, default: "" },
  ownerName: { type: String, default: "" },
  ownerEmail: { type: String, default: "" },
  expiresAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  allowedSymbols: { type: [String], default: ["XAUUSD", "USDZAR", "BTCUSD"] },
  createdAt: { type: Date, default: Date.now },
});

export const License = mongoose.model("License", licenseSchema);
