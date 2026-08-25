/**
 * 单飞（single-flight）：相同 key 的并发调用共享同一个 in-flight Promise。
 *
 * P0.3：第一个 /summary 正在生成时，第二个相同 period 的 /summary
 * 必须复用同一套生成，而不是再启动一轮 99-session 重放。
 * 请求断开不取消宿主侧生成（生成结果落库后对后续请求仍有效），
 * 但绝不重复开相同工作。
 */
export declare function createSingleFlight<K, V>(): (key: K, factory: () => Promise<V>) => Promise<V>;
//# sourceMappingURL=single-flight.d.ts.map