/**
 * INDEX（RFC §29-B）:
 * - INDEX_VERSION = 17
 * - tool identity 保留（toolTimeouts 按工具）
 * - 旧 v16 索引自动失效重建
 * - 无敏感内容（timeout contribution 只存 tool identity + count）
 */
import { describe, expect, it } from "vitest";
import { INDEX_VERSION } from "../src/tools.js";
import { bucketizeOwnEvents } from "../src/stats.js";
import { bashTimedOutResult, codeTimedOutResult, ev } from "./apply-harness.js";

const T = Date.parse("2026-08-25T10:00:00+08:00");

describe("INDEX_VERSION 17 migration", () => {
  it("INDEX_VERSION = 17", () => {
    expect(INDEX_VERSION).toBe(17);
  });

  it("旧 v16 条目自动失效（ingest 侧版本门）", async () => {
    // 版本门由 index-fingerprint.test 与 ingest.test 覆盖（v:17 断言已更新）；
    // 此处断言常量已从 16 迁移。
    expect(INDEX_VERSION).not.toBe(16);
  });

  it("bucket 持久化形态: toolTimeouts 只存 tool identity + count, 无 command/content", () => {
    const events = [
      ev("tool/call", T, { name: "bash", callId: "c1" }),
      ev("tool/result", T + 1000, bashTimedOutResult("c1", 60_000)),
      ev("tool/call", T + 5000, { name: "web_search", callId: "c2" }),
      ev("tool/result", T + 6000, codeTimedOutResult("c2")),
    ];
    const built = bucketizeOwnEvents("s1", events, 0);
    const bucket = built.buckets[0];
    expect(bucket.toolTimeouts).toEqual({ bash: 1, web_search: 1 });
    const json = JSON.stringify(bucket);
    // 无 command / 无 timeout message / 无 content 文本
    expect(json).not.toMatch(/timed out after|killed by signal|connection|content.*text/i);
    // 无会话正文、无 secret
    expect(json).not.toMatch(/sk-|ghp_|password/i);
    expect(bucket.toolTimeoutSessions).toEqual({ bash: ["s1"], web_search: ["s1"] });
  });
});
