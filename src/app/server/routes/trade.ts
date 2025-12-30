import { Router } from "express";
import { getTradeLogsHandler } from "../controllers/tradeController";

const router = Router();

/**
 * Trade 路由
 * GET /trade?date=yyyy-mm-dd
 */
router.get("/", getTradeLogsHandler);

export default router;

