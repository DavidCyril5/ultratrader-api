import mongoose, { Schema, Document } from "mongoose";

export interface ITrade extends Document {
  externalId?: string;
  symbol: string;
  type: string;
  lots: number;
  openPrice: number;
  closePrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  profit?: number;
  pips?: number;
  openTime: Date;
  closeTime?: Date;
  status: string;
  strategy?: string;
  signalId?: string;
}

const TradeSchema = new Schema<ITrade>({
  externalId: { type: String, index: true, sparse: true },
  symbol: { type: String, required: true },
  type: { type: String, required: true },
  lots: { type: Number, required: true },
  openPrice: { type: Number, required: true },
  closePrice: { type: Number },
  stopLoss: { type: Number },
  takeProfit: { type: Number },
  profit: { type: Number },
  pips: { type: Number },
  openTime: { type: Date, default: Date.now },
  closeTime: { type: Date },
  status: { type: String, default: "open" },
  strategy: { type: String },
  signalId: { type: String, index: true, sparse: true },
});

export const Trade =
  (mongoose.models.Trade as mongoose.Model<ITrade>) ||
  mongoose.model<ITrade>("Trade", TradeSchema);
