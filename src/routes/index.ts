import { Router } from "express";
import authRouter from "./auth.js";
import signalsRouter from "./signals.js";
import botRouter from "./bot.js";
import tradesRouter from "./trades.js";

const router = Router();

router.get("/healthz", (_req, res) => res.json({ status: "ok" }));
router.use(authRouter);
router.use(signalsRouter);
router.use(botRouter);
router.use(tradesRouter);

export default router;
