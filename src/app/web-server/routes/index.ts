import Router from "@koa/router";
import apiRouter from "./api";

const router = new Router();

/**
 * 路由注册
 */
router.use("/api", apiRouter.routes(), apiRouter.allowedMethods());

export default router;

