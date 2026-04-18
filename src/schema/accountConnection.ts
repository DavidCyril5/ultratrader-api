import mongoose, { Schema, Document } from "mongoose";

export interface IAccountConnection extends Document {
  licenseKey: string;
  mt5Login: string;
  mt5Password: string;
  mt5Server: string;
  platform: string;
  broker?: string;
  server?: string;
  login?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  currency: string;
  connected: boolean;
  botRunning: boolean;
  activeTrades: string;
  lastSignalAt?: Date;
  connectedAt: Date;
  updatedAt: Date;
}

const AccountConnectionSchema = new Schema<IAccountConnection>({
  licenseKey: { type: String, default: "" },
  mt5Login: { type: String, default: "" },
  mt5Password: { type: String, default: "" },
  mt5Server: { type: String, default: "" },
  platform: { type: String, default: "MT5" },
  broker: { type: String },
  server: { type: String },
  login: { type: String },
  balance: { type: Number, default: 0 },
  equity: { type: Number, default: 0 },
  margin: { type: Number, default: 0 },
  freeMargin: { type: Number, default: 0 },
  currency: { type: String, default: "USD" },
  connected: { type: Boolean, default: false },
  botRunning: { type: Boolean, default: false },
  activeTrades: { type: String, default: "0" },
  lastSignalAt: { type: Date },
  connectedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export const AccountConnection =
  (mongoose.models.AccountConnection as mongoose.Model<IAccountConnection>) ||
  mongoose.model<IAccountConnection>("AccountConnection", AccountConnectionSchema);
