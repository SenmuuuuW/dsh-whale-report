import type { SalvageResult } from "./salvage.js";
/** 异步 salvage（worker 内解压；主线程不阻塞）。 */
export declare function salvageInWorker(path: string): Promise<SalvageResult>;
/** 测试/退出用：终止 worker。 */
export declare function disposeSalvageWorker(): void;
//# sourceMappingURL=salvage-pool.d.ts.map