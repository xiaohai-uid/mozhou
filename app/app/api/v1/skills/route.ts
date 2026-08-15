// /api/v1/skills — 技能：我的技能 CRUD + 广场源（任务二-A）
// 技能 = 声明式（名称/说明/系统提示词），chat 可加载注入 system 提示
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { skills } from "@/lib/schema";
import { STORY_CAPABILITIES } from "@/lib/story/capabilities";
import {
  isExecutorConnected,
  loadBuiltinSkillDefinitions,
  missingExecutorReason,
} from "@/lib/runtime/skill-registry";

export interface SkillRow {
  id: number;
  name: string;
  description: string;
  systemPrompt: string;
  author: string;
}

/** 广场内置技能（社区共享，安装 = 复制到我的技能） */
const PLAZA_SKILLS = [
  { name: "去 AI 味", description: "反例库机检，动态合并红线", systemPrompt: "检查并清除文本中的 AI 腔：禁用'值得注意的是/总而言之/不仅…而且'等套话，句子要有信息增量。", author: "墨舟官方" },
  { name: "人物小传", description: "角色弧光与动机推导", systemPrompt: "为每个主要角色维护小传：外貌/动机/弧光/禁忌，写作时保持行为一致。", author: "社区" },
  { name: "信息差设计", description: "读者已知/角色已知对照表", systemPrompt: "写作时维护信息差：读者已知、角色 A 已知、角色 B 已知三张表，用信息差制造悬念。", author: "社区" },
];

/** GET /api/v1/skills?scope=mine|plaza — 我的技能 / 广场 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "mine";
  if (scope === "plaza") {
    // V1.3 工单 01（契约 Delta 3）：内置五角色定义 + 接入状态（connected 才可标记「已接入正式写作」）
    const builtinDefinitions = await loadBuiltinSkillDefinitions();
    return NextResponse.json({
      skills: PLAZA_SKILLS,
      ohStorySkills: STORY_CAPABILITIES,
      builtinSkills: builtinDefinitions.map((d) => ({
        key: d.key,
        name: d.name,
        role: d.role,
        trigger: d.trigger,
        connected: isExecutorConnected(d.executor),
        status: isExecutorConnected(d.executor) ? "已接入" : "待接入",
        reason: isExecutorConnected(d.executor) ? null : missingExecutorReason(d.key),
      })),
    });
  }
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.userId, user.id))
    .orderBy(desc(skills.createdAt));
  return NextResponse.json({
    skills: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      systemPrompt: r.systemPrompt,
      author: r.author,
      // V1.3（契约 Delta 3）：自定义技能未声明完整契约前如实标记未接入（ADR-0002 决策 7）
      connected: false,
      contract: null,
    })),
  });
}

/** POST /api/v1/skills — 创建技能（或从广场安装） */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    systemPrompt?: unknown;
    author?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const systemPrompt = typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!name || !description || !systemPrompt) {
    return NextResponse.json(
      { error: "技能名称/说明/系统提示词均不能为空" },
      { status: 400 },
    );
  }
  const [row] = await db
    .insert(skills)
    .values({
      userId: user.id,
      name,
      description,
      systemPrompt,
      author: typeof body?.author === "string" ? body.author : "自定义",
    })
    .returning({ id: skills.id, name: skills.name });
  return NextResponse.json({ skill: row }, { status: 201 });
}

/** DELETE /api/v1/skills?id= — 删除技能 */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "缺少技能 id" }, { status: 400 });
  const rows = await db
    .delete(skills)
    .where(and(eq(skills.id, id), eq(skills.userId, user.id)))
    .returning({ id: skills.id });
  if (rows.length === 0) {
    return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
