import { Router } from "express";
import { getDataHandler } from "../controllers/dataController";

const router = Router();

/**
 * Data 路由
 * GET /data/:appName?date=yyyy-mm-dd&traceId=xxxx
 */
router.get("/:appName", getDataHandler);

export default router;

