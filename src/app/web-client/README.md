# Poly Wynn Web Client

Poly Wynn 项目的 Web 前端应用，基于 React + TypeScript + Vite 构建。

## 项目信息

- **名称**: poly-wynn-web-client
- **技术栈**: React 18, TypeScript, Vite
- **包管理器**: npm (workspace)

## 开发

### 安装依赖

在项目根目录运行（会自动安装所有 workspace 依赖）：
```bash
npm install
```

或者只安装当前子项目依赖：
```bash
npm install --workspace=poly-wynn-web-client
```

### 启动开发服务器

```bash
npm run dev
```

或者从项目根目录：
```bash
npm run web:client:dev
```

开发服务器将在 `http://localhost:5173` 启动，并自动代理 `/api` 请求到后端服务器（`http://localhost:8080`）。

## 构建

### 构建生产版本

```bash
npm run build
```

或者从项目根目录：
```bash
npm run web:client:build
```

构建产物将输出到 `dist/web` 目录（相对于项目根目录）。

## 预览构建结果

```bash
npm run preview
```

## 项目结构

```
src/
├── App.tsx          # 主应用组件
├── App.css          # 应用样式
├── main.tsx         # 应用入口
└── index.css        # 全局样式
```

## 配置

- `vite.config.ts` - Vite 构建配置
- `tsconfig.json` - TypeScript 配置
- `tsconfig.node.json` - Node.js 环境 TypeScript 配置

## 作为 Workspace 子项目

此项目是 `poly-wynn` monorepo 的一个 workspace 子项目。在根目录的 `package.json` 中已配置：

```json
{
  "workspaces": [
    "src/app/web-client"
  ]
}
```

这意味着：
- 依赖可以在根目录统一安装：`npm install`
- 可以使用 workspace 命令：`npm run <script> --workspace=poly-wynn-web-client`
- 可以共享依赖，减少重复安装

## 环境变量

开发环境下的 API 代理配置在 `vite.config.ts` 中：

```typescript
proxy: {
  "/api": {
    target: "http://localhost:8080",
    changeOrigin: true,
  },
}
```

## 相关文档

- [Vite 文档](https://vitejs.dev/)
- [React 文档](https://react.dev/)
- [TypeScript 文档](https://www.typescriptlang.org/)

