/**
 * PNG 导出（exportReportImage）回归测试：
 * mock canvas 2D context，实际驱动完整绘制流程，验证
 * - daily / weekly / monthly / custom(≥30 天) 四种预设下底部 footer 均完整落在画布内；
 * - 活跃区超过 7 天时明确标注 LAST 7 DAYS；
 * - ≤7 天时不出现多余的 LAST 7 DAYS 标注。
 */

import { describe, expect, it, beforeAll } from "vitest";

let exportReportImage: (report: never) => void;

interface TextRecord {
  text: string;
  x: number;
  y: number;
  font: string;
}

interface RectRecord {
  x: number;
  y: number;
  w: number;
  h: number;
}

class FakeCtx {
  texts: TextRecord[] = [];
  rects: RectRecord[] = [];
  scaleFactor = 1;
  fillStyle = "";
  font = "";
  textAlign = "left";
  strokeStyle = "";

  scale(n: number): void {
    this.scaleFactor = n;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h });
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 8 };
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, font: this.font });
  }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  download = "";
  href = "";
  clicked = false;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
  toDataURL(): string {
    return "data:image/png;base64,";
  }
  click(): void {
    this.clicked = true;
  }
}

let lastCanvas: FakeCanvas;

/** 构造导出所需的最小 stats / report 形状（导出函数只用其中一部分字段）。 */
function makeStats(days: number): unknown {
  return {
    tokens: { input: 1_000_000, output: 500_000, cacheRead: 300_000, reasoning: 200_000 },
    sessions: 8,
    toolCallsTotal: 42,
    dayHourSeries: Array.from({ length: days }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      hours: Array.from({ length: 24 }, (_, h) => (h + i) % 5),
    })),
    models: {
      "model-alpha": { input: 600_000, output: 300_000, cacheRead: 200_000, reasoning: 100_000 },
    },
    dangerousCommands: [],
    sessionsDetail: [
      {
        title: "会话一",
        cost: 1.2,
        sessionId: "s1",
        redDanger: 0,
        retryBursts: 0,
        toolCalls: 5,
        modelTokens: {},
        firstTime: 0,
        lastTime: 1000,
        events: 3,
        commands: 2,
      },
    ],
  };
}

function makeReport(days: number, preset: string): unknown {
  return {
    preset,
    to: Date.now(),
    stats: makeStats(days),
    cost: { total: 9.99, perModel: {}, currency: "CNY", source: "official-page" },
  };
}

/** 校验：所有绘制内容（文本基线 + descender、矩形底边）都在画布逻辑高度内，footer 完整。 */
function expectNoClip(report: unknown): { texts: TextRecord[]; logicalHeight: number } {
  exportReportImage(report as never);
  const ctx = lastCanvas.ctx;
  const logicalHeight = lastCanvas.height / ctx.scaleFactor;
  const footer = ctx.texts[ctx.texts.length - 1];
  expect(footer.text).toContain("由深迹 DeepTrace 生成");
  for (const t of ctx.texts) {
    // 基线 + 4px descender 余量必须落在画布内
    expect(t.y + 4, `text clipped: "${t.text}" at y=${t.y} height=${logicalHeight}`).toBeLessThanOrEqual(logicalHeight);
  }
  for (const r of ctx.rects) {
    expect(r.y + r.h, `rect clipped at y=${r.y}+${r.h} height=${logicalHeight}`).toBeLessThanOrEqual(logicalHeight + 0.5);
  }
  return { texts: ctx.texts, logicalHeight };
}

describe("exportReportImage 画布高度", () => {
  beforeAll(async () => {
    const canvases: FakeCanvas[] = [];
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string): FakeCanvas => {
        const c = new FakeCanvas();
        if (tag === "canvas") lastCanvas = c;
        canvases.push(c);
        return c;
      },
      head: { appendChild: () => {} },
    };
    // client 模块顶层无 DOM 访问，动态 import 确保在 document stub 之后执行。
    ({ exportReportImage } = await import("../src/client/index.js"));
  });

  it("daily（1 天）footer 完整、无 LAST 7 DAYS", () => {
    const { texts } = expectNoClip(makeReport(1, "daily"));
    expect(texts.some((t) => t.text === "LAST 7 DAYS")).toBe(false);
  });

  it("weekly（7 天）footer 完整、无 LAST 7 DAYS", () => {
    const { texts } = expectNoClip(makeReport(7, "weekly"));
    expect(texts.some((t) => t.text === "LAST 7 DAYS")).toBe(false);
  });

  it("monthly（31 天）footer 完整、标注 LAST 7 DAYS", () => {
    const { texts } = expectNoClip(makeReport(31, "monthly"));
    expect(texts.some((t) => t.text === "LAST 7 DAYS")).toBe(true);
  });

  it("custom ≥ 30 天（40 天）footer 完整、标注 LAST 7 DAYS", () => {
    const { texts } = expectNoClip(makeReport(40, "custom"));
    expect(texts.some((t) => t.text === "LAST 7 DAYS")).toBe(true);
  });
});
