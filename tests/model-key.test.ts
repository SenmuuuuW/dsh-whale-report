/** splitModelKey：provider/model 前缀键拆分（UI 集成用）。 */

import { describe, expect, it } from "vitest";
import { splitModelKey } from "../src/client/model-key.js";

describe("splitModelKey", () => {
  it("带前缀键拆分为 provider + model", () => {
    expect(splitModelKey("opencode-go/deepseek-v4-flash")).toEqual({
      provider: "opencode-go",
      model: "deepseek-v4-flash",
    });
    expect(splitModelKey("deepseek/deepseek-v4-pro")).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
  });

  it("无前缀历史键（旧报告）→ provider null", () => {
    expect(splitModelKey("deepseek-v4-flash")).toEqual({ provider: null, model: "deepseek-v4-flash" });
    expect(splitModelKey("unknown-model")).toEqual({ provider: null, model: "unknown-model" });
  });

  it("空字符串安全", () => {
    expect(splitModelKey("")).toEqual({ provider: null, model: "" });
  });
});
