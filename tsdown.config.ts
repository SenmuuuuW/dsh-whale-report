/**
 * tsdown 构建：只为客户端 half 打单文件 bundle。
 *
 * 宿主 half 不需要打包 —— tsc 产出的 lib/index.js 就是纯相对 import 的
 * node ESM（与官方 dsh-tool-todo 等发布形态一致），运行时由 profile 的
 * node_modules 解析 @deepseek-ai/*。
 *
 * 客户端 bundle 复刻官方 dsh-client-bundle 预设：
 * - react 等平台模块走 externals（运行时从官方模块表解析），其余内联；
 * - 产物通过 window.__ModuleLoader__.load({id, factory}) 注册，
 *   id 必须与 package.json 的 name 一致（client-modules 按包名装配）；
 * - 必须保持单文件（模块表只服务 /plugins/<id>/client.js），
 *   所以客户端源码里不能有动态 import。
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

export default defineConfig({
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
});
