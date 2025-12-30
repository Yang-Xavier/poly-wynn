import { Router } from "express";
import { getLogsByTraceIdHandler } from "../controllers/logController";

const router = Router();

/**
 * Log 路由
 * GET /log?date=yyyy-mm-dd&traceId=xxxx
 */
router.get("/", getLogsByTraceIdHandler);

export default router;

