import mongoose from "mongoose";

const signalSchema = new mongoose.Schema({
  action: { type: String, enum: ["BUY", "SELL"], required: true },
  asset: { type: String, required: true },
  price: { type: String, default: "" },
  sl: { type: String, default: "" },
  tp: { type: String, default: "" },
  lotSize: { type: Number, default: 0.01 },
  platform: { type: String, enum: ["MT4", "MT5"], default: "MT5" },
  note: { type: String, default: "" },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export const Signal = mongoose.model("Signal", signalSchema);
