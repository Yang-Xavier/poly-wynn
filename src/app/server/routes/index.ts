import { Router } from "express";
import tradeRouter from "./trade";
import logRouter from "./log";
import chanceRouter from "./chance";

const router = Router();

/**
 * 路由注册
 * 所有路由都在这里统一注册，便于扩展
 * 注意：具体路由要在参数路由之前注册
 */
router.use("/log", logRouter); // /log?date=xxx&traceId=xxx&appName=xxx
router.use("/", chanceRouter); // /spreadArbitrage/chance
router.use("/", tradeRouter); // /:appName/trade

export default router;
