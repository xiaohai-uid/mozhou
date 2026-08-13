export interface WritingCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const MAX_TEXT = 20000;

function wordCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

function findRepetition(text: string): string | null {
  const paragraphs = text.split(/\n+/).filter((paragraph) => paragraph.trim().length > 0);
  for (let index = 1; index < paragraphs.length; index += 1) {
    const previous = paragraphs[index - 1].trim();
    const current = paragraphs[index].trim();
    let commonPrefix = 0;
    while (
      commonPrefix < previous.length &&
      commonPrefix < current.length &&
      previous[commonPrefix] === current[commonPrefix]
    ) {
      commonPrefix += 1;
    }
    if (commonPrefix >= 8) return `「${current.slice(0, commonPrefix + 2)}…」`;
  }
  return null;
}

export interface WritingCheckOptions {
  mustCover?: string[];
  knownEntities?: string[];
}

export function runWritingChecks(
  rawText: string,
  options: WritingCheckOptions = {},
): WritingCheckResult[] {
  const text = rawText.trim();
  if (!text) throw new Error("正文不能为空");
  if (text.length > MAX_TEXT) throw new Error("正文过长（上限 20000 字）");
  const mustCover = options.mustCover ?? [];
  const knownEntities = options.knownEntities ?? [];
  const checks: WritingCheckResult[] = [];
  const count = wordCount(text);
  checks.push({ name: "字数窗口", ok: count >= 2400 && count <= 3900, detail: `${count} 字（窗口 2400-3900）` });

  const placeholder = /(TODO|占位|待补充|XXX|\.\.\.)/.exec(text);
  checks.push({ name: "占位符", ok: !placeholder, detail: placeholder ? `发现占位符「${placeholder[1]}」` : "无占位符" });

  const leaked = [...text.matchAll(/S-(\d{3})/g)].map((match) => match[0]);
  checks.push({ name: "泄密扫描", ok: leaked.length === 0, detail: leaked.length > 0 ? `正文出现禁区代号 ${[...new Set(leaked)].join("/")}` : "未曝光 S-001/003/005" });

  const suspected = [
    ...new Set(
      [...text.matchAll(/([\u4e00-\u9fa5]{2,4})(?:说|问|道|站在|走向|看见|回到|望向|攥着)/g)].map((match) => match[1]),
    ),
  ];
  const unregistered = suspected.filter((entity) => !knownEntities.includes(entity));
  checks.push({
    name: "实体登记",
    ok: unregistered.length === 0,
    detail: unregistered.length > 0
      ? `正文出现未登记实体：${unregistered.slice(0, 3).join(" / ")}`
      : suspected.length > 0
        ? `已登记实体 ${suspected.slice(0, 3).join(" / ")} 等`
        : knownEntities.length > 0
          ? `无新实体（库中 ${knownEntities.length} 条已知）`
          : "未配置实体库（绑定作品后自动核对）",
  });

  const repetition = findRepetition(text);
  checks.push({ name: "复读检测", ok: repetition === null, detail: repetition ? `相邻段落重复片段${repetition}` : "无复读" });

  const missing = mustCover.filter((word) => !text.includes(word));
  checks.push({
    name: "合同断言",
    ok: missing.length === 0,
    detail: missing.length > 0
      ? `未覆盖必含词 ${missing.join(" / ")}`
      : mustCover.length > 0
        ? `必含词全覆盖（${mustCover.join(" / ")}）`
        : "未设置必含词",
  });
  return checks;
}

export function writingCheckWordCount(text: string): number {
  return wordCount(text);
}
