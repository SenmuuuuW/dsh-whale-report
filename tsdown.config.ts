/**
 * tsdown 构建：宿主 half（node ESM）+ 客户端 half（浏览器 CJS 闭包工厂）。
 *
 * 客户端 bundle 复刻官方 dsh-client-bundle 预设（packages/client/tsdown.client.ts）：
 * - react / cordis 等平台模块走 externals（运行时从官方模块表解析），
 *   其余全部内联；
 * - 产物通过 window.__ModuleLoader__.load({id, factory}) 注册，
 *   id 必须与 package.json 的 name 一致（client-modules 按包名装配）；
 * - CJS 闭包工厂形状（module/exports + require 仅解析模块表条目）。
 *
 * 样式不走打包管线：客户端源码用 JS 注入 <style data-plugin>。
 */
import { defineConfig } from "tsdown";

/** 官方 web 模块表的种子词（apps/web 的 PLATFORM_MODULES）。 */
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "cordis",
];

export default defineConfig([
  // ── 宿主 half：node ESM（类型声明由 tsc -p tsconfig.build.json 产出） ──
  {
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: "esm",
    platform: "node",
    target: "es2024",
    dts: false,
    clean: false,
    // 宿主 bundle 绝不能把 @deepseek-ai/* 打进产物：它们由 profile 提供。
    external: [/^@deepseek-ai\//],
  },
  // ── 客户端 half：浏览器 CJS 闭包工厂 ──
  {
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    dts: false,
    sourcemap: true,
    clean: false,
    external: CLIENT_EXTERNALS,
    outputOptions: {
      entryFileNames: "client.js",
      banner: "window.__ModuleLoader__.load({ id: 'dsh-whale-report', factory: (require) => {",
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
    },
  },
]);
