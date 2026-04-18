import mongoose, { Schema, Document } from "mongoose";

export interface IBotConfig extends Document {
  strategy: string;
  symbols: string[];
  timeframe: string;
  lotMode: string;
  fixedLot: number;
  riskPercent: number;
  fixedDollarRisk: number;
  stopLossPips: number;
  takeProfitPips: number;
  useTrailingStop: boolean;
  trailingPips: number;
  useBreakEven: boolean;
  breakEvenPips: number;
  maxPositions: number;
  maxBuys: number;
  maxSells: number;
  tradeDirection: string;
  session: string;
  useSpreadFilter: boolean;
  maxSpreadPips: number;
  useDailyProfitLimit: boolean;
  dailyProfitLimit: number;
  useDailyLossLimit: boolean;
  dailyLossLimit: number;
  fastMaPeriod: number;
  slowMaPeriod: number;
  trendMaPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  macdFastEma: number;
  macdSlowEma: number;
  macdSignal: number;
  bbPeriod: number;
  bbDeviation: number;
  updatedAt: Date;
}

const BotConfigSchema = new Schema<IBotConfig>({
  strategy: { type: String, default: "combined" },
  symbols: { type: [String], default: ["XAUUSD", "USDZAR", "BTCUSD"] },
  timeframe: { type: String, default: "H1" },
  lotMode: { type: String, default: "percent_balance" },
  fixedLot: { type: Number, default: 0.01 },
  riskPercent: { type: Number, default: 1.5 },
  fixedDollarRisk: { type: Number, default: 50 },
  stopLossPips: { type: Number, default: 30 },
  takeProfitPips: { type: Number, default: 60 },
  useTrailingStop: { type: Boolean, default: true },
  trailingPips: { type: Number, default: 20 },
  useBreakEven: { type: Boolean, default: true },
  breakEvenPips: { type: Number, default: 15 },
  maxPositions: { type: Number, default: 3 },
  maxBuys: { type: Number, default: 2 },
  maxSells: { type: Number, default: 2 },
  tradeDirection: { type: String, default: "both" },
  session: { type: String, default: "all" },
  useSpreadFilter: { type: Boolean, default: true },
  maxSpreadPips: { type: Number, default: 5 },
  useDailyProfitLimit: { type: Boolean, default: true },
  dailyProfitLimit: { type: Number, default: 200 },
  useDailyLossLimit: { type: Boolean, default: true },
  dailyLossLimit: { type: Number, default: 100 },
  fastMaPeriod: { type: Number, default: 20 },
  slowMaPeriod: { type: Number, default: 50 },
  trendMaPeriod: { type: Number, default: 200 },
  rsiPeriod: { type: Number, default: 14 },
  rsiOverbought: { type: Number, default: 70 },
  rsiOversold: { type: Number, default: 30 },
  macdFastEma: { type: Number, default: 12 },
  macdSlowEma: { type: Number, default: 26 },
  macdSignal: { type: Number, default: 9 },
  bbPeriod: { type: Number, default: 20 },
  bbDeviation: { type: Number, default: 2.0 },
  updatedAt: { type: Date, default: Date.now },
});

export const BotConfig =
  (mongoose.models.BotConfig as mongoose.Model<IBotConfig>) ||
  mongoose.model<IBotConfig>("BotConfig", BotConfigSchema);
