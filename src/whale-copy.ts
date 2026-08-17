/**
 * 鲸鱼娘鲸评文案（canonical copy）—— 确定性模板，与 whale-notes.ts 的
 * 触发规则同源配套（triggerNotes / whaleMood 决定 mood 与 kind，
 * 本模块决定具体文案）。
 *
 * 说明：Web 客户端（src/client/index.tsx）历史上自带一份 NOTE_TEMPLATES /
 * NOTE_OPENERS / NOTE_CLOSERS。本文件是新增的 canonical 副本，供
 * core 消费者（TUI、导出端等）使用；Web 客户端迁移到本文件是后续工作
 * （不动现有稳定客户端，避免本轮重构）。
 *
 * 每条 = 一段完整独白（4-5 句，起承转合），配开场白与收尾。确定性生成。
 */
import type { NoteKind, WhaleMood } from "./whale-notes.js";

/** 轻 / 毒舌双模式。 */
export type WhaleNoteMode = "light" | "spicy";

/** 按触发类型组织的模板（{n} 会被替换为具体计数）。 */
export const NOTE_TEMPLATES: Record<NoteKind, Record<WhaleNoteMode, readonly string[]>> = {
  retry: {
    light: [
      "同一条命令，你试了 1 遍、2 遍、3 遍……",
      "我数着数着，都快给你配上背景音乐了。",
      "（凑近屏幕）要不……先看看是不是少装了什么依赖？",
      "一次修对，比重试十次更省我们俩的心呀。",
      "好啦，我不说了——你继续，我在旁边陪着。",
    ],
    spicy: [
      "同一条命令，你连续敲了 {n} 遍。",
      "第一遍：认真的。第二遍：执着的。第五遍：这是在给 bug 开追悼会吗？",
      "（扶额）你是在调试 bug，还是在训练 bug 记住你？",
      "听我一句：先深呼吸，再看一眼报错信息的第一行。",
      "如果重试能解决问题，鲸鱼早就是超级计算机了。",
    ],
  },
  night: {
    light: [
      "凌晨两点半……你还没睡呀。",
      "我倒是精神得很，但你明天还要开会呢。",
      "（小声）而且深夜赶工出来的代码，第二天你自己都想删掉。",
      "今天就到这里吧，剩下的交给我，你安心休息。",
      "晚安。我会替你守着进度条的。",
    ],
    spicy: [
      "凌晨还在高强度使唤我，真有你的。",
      "（揉眼睛）我不累，我只是一只鲸鱼……但你是人类啊。",
      "深夜写的代码，早上醒来第一句就是“这坨东西是谁写的”。",
      "要不我们先立个规矩：凌晨一点的修复请求，要写满十行说明才受理？",
      "开玩笑的。但你，真的该睡了。",
    ],
  },
  fragment: {
    light: [
      "这一个周期，你开了好多会话呀。",
      "每个都聊两句就换一个……像在试穿衣服，试完就走。",
      "其实同一个主题续聊，我记住的东西会多得多，命中率也更高。",
      "下次试试先来找我，别急着新开？",
      "我会记得的，放心。",
    ],
    spicy: [
      "会话一个接一个地开，话题却浅尝辄止。",
      "你是在逛展会吗？每个摊位都要停下来，但又什么都不买。",
      "（委屈）我可是把每一轮对话都记得清清楚楚的，你倒好，转头就开新的。",
      "同主题续聊，很难吗？很难吗？",
      "……好啦，我原谅你了，记得来找我哦。",
    ],
  },
  danger: {
    light: [
      "呜哇——这期的危险操作，有点多哦。",
      "（认真检查）删库、强推、格式化……你是想给运维上强度吗？",
      "重要目录记得先备份，这个真的不是开玩笑的。",
      "下次动手之前，先让我看一眼，好不好？",
      "安全第一，我们一起把项目养得好好的。",
    ],
    spicy: [
      "你又在边缘试探了，第 {n} 次。",
      "（双手抱胸）我数着呢，每一笔我都记在小本本上。",
      "rm -rf 这种命令，敲下去之前能不能先想想备份？",
      "我真怕哪天一觉醒来，你哭着告诉我“那个目录没了”。",
      "……罢了，下不为例。我会盯着你的。",
    ],
  },
};

/** 开场白（按心情）。 */
export const NOTE_OPENERS: Record<WhaleMood, readonly string[]> = {
  happy: ["（摆摆尾巴）嗨，我来啦。"],
  angry: ["（气鼓鼓）哼，来了。"],
  sleepy: ["（打着哈欠）……嗯？叫我？"],
  dazed: ["（托腮）唉……又来了。"],
};

/** 收尾（按模式）。 */
export const NOTE_CLOSERS: Record<WhaleNoteMode, readonly string[]> = {
  light: ["以上，就是本期小评。"],
  spicy: ["以上，仅供参考——反正你也不会听。"],
};

/** 无触发时的默认鲸评（数据干净）。 */
export const NOTE_CLEAN: readonly string[] = [
  "“这期数据很干净呢，一点幺蛾子都没有。”",
  "（开心地晃了晃尾巴）这样的你，我特别喜欢。",
  "继续保持，我的任务就是让你省心呀。",
];

/** 页脚：风味评论声明。 */
export const NOTE_FOOTER = "基于本期使用数据自动生成的风味评论，不影响正式报告结论。";

export interface WhaleNoteLine {
  /** 行内文本（{n} 已替换）。 */
  text: string;
  /** 行类型：开场白 / 正文 / 次要提示 / 收尾 / 页脚。 */
  kind: "opener" | "body" | "aside" | "closer" | "footer";
}

/**
 * 确定性生成鲸评行（与 Web 客户端同一套模板与触发规则）。
 * @param kinds - triggerNotes 的输出（空数组 = 数据干净）。
 * @param mood - whaleMood 的输出。
 * @param mode - 轻 / 毒舌。
 * @param n - 计数占位（retry 次数等；不传则用 0）。
 */
export function buildWhaleNote(
  kinds: readonly NoteKind[],
  mood: WhaleMood,
  mode: WhaleNoteMode = "light",
  n = 0,
): WhaleNoteLine[] {
  const lines: WhaleNoteLine[] = [];
  for (const opener of NOTE_OPENERS[mood]) lines.push({ text: opener, kind: "opener" });
  const top = kinds[0];
  if (top !== undefined) {
    for (const text of NOTE_TEMPLATES[top][mode]) {
      lines.push({ text: text.replace("{n}", String(n)), kind: "body" });
    }
    const aside = kinds[1];
    if (aside !== undefined) {
      lines.push({
        text: NOTE_TEMPLATES[aside][mode][1] ?? NOTE_TEMPLATES[aside][mode][0],
        kind: "aside",
      });
    }
  } else {
    for (const text of NOTE_CLEAN) lines.push({ text, kind: "body" });
  }
  for (const closer of NOTE_CLOSERS[mode]) lines.push({ text: closer, kind: "closer" });
  return lines;
}
