"use client";

// PROTOTYPE — 工单 05 项目页信息架构验证（3 变体，?variant=A|B|C 切换）
// 只读 mock 数据，无持久化；问题：「章节 + 人物库 + 世界观」在一页里怎么组织？
// 变体 A 三栏工作台 / B 分段导航 / C 大纲+抽屉 —— 结构差异，非换皮

export interface Chapter {
  id: number;
  title: string;
  order: number;
  words: number;
  summary: string;
}

export interface Entry {
  id: number;
  name: string;
  type: string; // 人物/世界观
  content: string;
}

export const NOVEL = {
  title: "雾港疑云",
  genre: "悬疑 · 都市",
  synopsis:
    "雾港市连续三起失踪案指向同一艘废弃货轮。刑警队长沈砚与法医林晚联手追查，发现每起案件都留下同一句船讯暗语。",
  chapters: [
    { id: 1, title: "第一章 雾锁码头", order: 1, words: 3120, summary: "失踪者最后出现在码头的监控里，雾气中只剩一把伞。" },
    { id: 2, title: "第二章 废弃货轮", order: 2, words: 2840, summary: "货轮甲板发现暗语涂鸦，与十年前的旧案完全一致。" },
    { id: 3, title: "第三章 灯塔守夜人", order: 3, words: 3560, summary: "灯塔管理员失踪当晚，有人听见老式发报机的声音。" },
  ] as Chapter[],
  characters: [
    { id: 1, name: "沈砚", type: "人物", content: "刑警队长，36 岁，习惯性失眠。对雾港的潮汐时刻表倒背如流。" },
    { id: 2, name: "林晚", type: "人物", content: "法医，29 岁，左撇子。祖父是退休的引航员，懂船讯暗语。" },
    { id: 3, name: "陈广海", type: "人物", content: "货运码头老板，表面豪爽，账本里有一半走的是暗账。" },
    { id: 4, name: "老周", type: "人物", content: "灯塔管理员，聋哑人，失踪前刚被通知提前退休。" },
  ] as Entry[],
  worldview: [
    { id: 1, name: "雾港市", type: "世界观", content: "临海工业城市，年均大雾 120 天。旧港区废弃货轮云集。" },
    { id: 2, name: "船讯暗语", type: "世界观", content: "引航员之间的摩斯变体，以潮汐为密钥，外行无法解读。" },
    { id: 3, name: "十年旧案", type: "世界观", content: "十年前「雾港三号」货轮走私案，唯一幸存者至今失忆。" },
    { id: 4, name: "潮汐时刻表", type: "世界观", content: "关键线索：所有失踪时间点都对应退潮最深处。" },
    { id: 5, name: "废弃码头俱乐部", type: "世界观", content: "旧港区地下酒吧，失踪者共同出入场所。" },
  ] as Entry[],
};

/** 共享小部件 */
export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
      {children}
    </span>
  );
}

export function GhostButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-violet-500 hover:text-violet-300"
    >
      {children}
    </button>
  );
}
