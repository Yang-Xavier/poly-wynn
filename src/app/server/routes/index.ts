import { Router } from "express";
import tradeRouter from "./trade";
import logRouter from "./log";

const router = Router();

/**
 * 路由注册
 * 所有路由都在这里统一注册，便于扩展
 */
router.use("/trade", tradeRouter);
router.use("/log", logRouter);

export default router;

