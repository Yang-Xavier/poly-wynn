import { Router } from "express";
import { getChanceLogsHandler } from "../controllers/chanceController";

const router = Router();

/**
 * Chance 路由
 * GET /spreadArbitrage/logs?date=yyyy-mm-dd
 */
router.get("/spreadArbitrage/logs", getChanceLogsHandler);

export default router;

