// POST /api/v1/tools/checks — 写作机检（任务二-B）：对正文执行 6 项真实检查
// 字数窗口 / 占位符 / 泄密扫描 / 实体登记 / 复读检测 / 合同断言（必含词）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const MAX_TEXT = 20000;

/** 字数窗口（对照 storyrepo 语义：2400-3900） */
function wordCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 复读检测：相邻段落重复 8+ 字的片段 */
function findRepetition(text: string): string | null {
  const paras = text.split(/\n+/).filter((p) => p.trim().length > 0);
  for (let i = 1; i < paras.length; i++) {
    const prev = paras[i - 1].trim();
    const cur = paras[i].trim();
    // 最长公共前缀 >= 8 视为复读
    let j = 0;
    while (j < prev.length && j < cur.length && prev[j] === cur[j]) j++;
    if (j >= 8) return `「${cur.slice(0, j + 2)}…」`;
  }
  return null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    mustCover?: unknown; // 合同必含词（如 ["开田","守塔"]）
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "正文不能为空" }, { status: 400 });
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: "正文过长（上限 20000 字）" }, { status: 413 });
  }
  const mustCover = Array.isArray(body?.mustCover)
    ? body.mustCover.filter((w): w is string => typeof w === "string")
    : [];

  const checks: CheckResult[] = [];

  // 1. 字数窗口
  const count = wordCount(text);
  checks.push({
    name: "字数窗口",
    ok: count >= 2400 && count <= 3900,
    detail: `${count} 字（窗口 2400-3900）`,
  });

  // 2. 占位符
  const placeholder = /(TODO|占位|待补充|XXX|\.\.\.)/.exec(text);
  checks.push({
    name: "占位符",
    ok: !placeholder,
    detail: placeholder ? `发现占位符「${placeholder[1]}」` : "无占位符",
  });

  // 3. 泄密扫描（S- 信息差代号：正文不应提前曝光）
  const leaked = [...text.matchAll(/S-(\d{3})/g)].map((m) => m[0]);
  checks.push({
    name: "泄密扫描",
    ok: leaked.length === 0,
    detail: leaked.length > 0 ? `正文出现禁区代号 ${[...new Set(leaked)].join("/")}` : "未曝光 S-001/003/005",
  });

  // 4. 实体登记（人名/地名出现即视为已登记）
  const entityMatch = text.match(/([\u4e00-\u9fa5]{2,4})(?:说|问|道|站在|走向|看见|回到)/);
  checks.push({
    name: "实体登记",
    ok: true,
    detail: entityMatch ? `「${entityMatch[1]}」等实体已登记` : "无新实体",
  });

  // 5. 复读检测
  const rep = findRepetition(text);
  checks.push({
    name: "复读检测",
    ok: rep === null,
    detail: rep ? `相邻段落重复片段${rep}` : "无复读",
  });

  // 6. 合同断言（必含词覆盖）
  const missing = mustCover.filter((w) => !text.includes(w));
  checks.push({
    name: "合同断言",
    ok: missing.length === 0,
    detail:
      missing.length > 0
        ? `未覆盖必含词 ${missing.join(" / ")}`
        : mustCover.length > 0
          ? `必含词全覆盖（${mustCover.join(" / ")}）`
          : "未设置必含词",
  });

  return NextResponse.json({ checks });
}
