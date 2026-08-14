export declare const name = "whale-report-client";
export declare const inject: string[];
/** 客户端 cordis 上下文的最小结构化视图（type-only，不引入运行时依赖）。 */
interface ClientContext {
    effect(execute: () => () => void): unknown;
    inject(names: string[], callback: (ctx: Record<string, unknown>) => void): unknown;
}
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map