/**
 * P0.3 — single-flight 单飞：相同 key 的并发 summary 生成共享同一 in-flight Promise。
 */
import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "../src/single-flight.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("createSingleFlight", () => {
  it("相同 key：工厂只执行一次，两个调用共享同一个结果", async () => {
    const flight = createSingleFlight<string, string>();
    const factory = vi.fn(async () => {
      await sleep(20);
      return "done";
    });
    const [a, b] = await Promise.all([flight("k1", factory), flight("k1", factory)]);
    expect(a).toBe("done");
    expect(b).toBe("done");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("相同 key 并发：第二个调用等第一个完成后立即拿到结果", async () => {
    const flight = createSingleFlight<string, string>();
    const factory = vi.fn(async () => {
      await sleep(30);
      return "ok";
    });
    // 先测单飞一轮的基线耗时（避免机器负载导致的墙钟断言抖动）
    const soloStart = Date.now();
    await flight("baseline", factory);
    const solo = Date.now() - soloStart;
    const started = Date.now();
    const [a, b] = await Promise.all([flight("k", factory), flight("k", factory)]);
    const elapsed = Date.now() - started;
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    // 并发两轮 ≈ 一轮耗时（单飞），而不是两轮串行
    expect(elapsed).toBeLessThan(solo * 1.9 + 30);
    expect(factory).toHaveBeenCalledTimes(2); // baseline + k（k 的两次调用共享一次）
  });

  it("不同 key：各自独立执行", async () => {
    const flight = createSingleFlight<string, string>();
    const factory = vi.fn(async () => "v");
    const [a, b] = await Promise.all([flight("k1", factory), flight("k2", factory)]);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("完成后清空：后续同 key 调用重新执行（新周期重新生成）", async () => {
    const flight = createSingleFlight<string, number>();
    const factory = vi.fn(async () => 1);
    await flight("k", factory);
    await flight("k", factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("失败后清空：reject 的生成不污染后续请求", async () => {
    const flight = createSingleFlight<string, number>();
    const factory = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(42);
    await expect(flight("k", factory)).rejects.toThrow("boom");
    await expect(flight("k", factory)).resolves.toBe(42);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
