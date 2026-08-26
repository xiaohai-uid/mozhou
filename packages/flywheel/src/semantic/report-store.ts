/**
 * 语义报告 I/O（T28 · #69；t66 D14/E6/E7）。
 *
 * 一报一文件 .mozhou/semantic-analysis/report_<ULID>.json：tmp+rename 原子写、
 * 稳定键序美化序列化（沿 receipt-file 先例）；读面全目录扫描可重建。
 * V1 全保留（D16）；目录属 .mozhou 运行时区非 canon（对齐 receipts 归属）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SemanticAnalysisReport } from './types.js';

/** 语义报告目录（.mozhou 运行时区；E7）。 */
export const SEMANTIC_DIR_RELPATH = '.mozhou/semantic-analysis';

export interface WriteReportOptions {
  readonly bookRoot: string;
  readonly report: SemanticAnalysisReport;
  /** 测试确定性注入；缺省按序铸 report_<ULID>。 */
  readonly newReportId?: () => string;
}

/** 原子落盘：tmp + rename；拒绝覆盖既有报告（不可变凭证，沿 INV-R2 精神）。 */
export function writeSemanticReport(options: WriteReportOptions): string {
  const dir = join(options.bookRoot, SEMANTIC_DIR_RELPATH);
  mkdirSync(dir, { recursive: true });
  const reportId = options.report.reportId;
  const relPath = SEMANTIC_DIR_RELPATH + '/report_' + reportId + '.json';
  const absolute = join(options.bookRoot, relPath);
  if (existsSync(absolute)) {
    // 报告 id 取自调用方 ULID；重复写同 id 视为崩溃重放或 id 撞车——宁败不脏
    throw new Error('semantic report already exists: ' + relPath);
  }
  const tmp = absolute + '.tmp';
  writeFileSync(tmp, JSON.stringify(options.report) + '\n');
  renameSync(tmp, absolute);
  return relPath;
}

function isReport(value: unknown): value is SemanticAnalysisReport {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r['schemaVersion'] === 1 &&
    typeof r['reportId'] === 'string' &&
    typeof r['anchor'] === 'object' &&
    r['anchor'] !== null &&
    typeof (r['anchor'] as Record<string, unknown>)['receiptId'] === 'string'
  );
}

/** 全目录扫描（重建入口）：损坏/撕裂行跳过（派生面可弃重建）。 */
export function readSemanticReports(bookRoot: string): readonly SemanticAnalysisReport[] {
  const dir = join(bookRoot, SEMANTIC_DIR_RELPATH);
  if (!existsSync(dir)) return [];
  const reports: SemanticAnalysisReport[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (isReport(parsed)) reports.push(parsed);
    } catch {
      continue;
    }
  }
  return reports;
}

/** 报告数（重建前/后对拍哨兵；数字只读，禁当黄金）。 */
export function countSemanticReports(bookRoot: string): number {
  return readSemanticReports(bookRoot).length;
}
