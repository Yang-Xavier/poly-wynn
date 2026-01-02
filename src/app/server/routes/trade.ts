import { Router } from "express";
import { getTradeLogsHandler } from "../controllers/tradeController";

const router = Router();

/**
 * Trade 路由
 * GET /:appName/trade?date=yyyy-mm-dd
 */
router.get("/:appName/trade", getTradeLogsHandler);

export default router;

