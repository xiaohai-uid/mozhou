/**
 * 本地离线合规审查规则引擎
 * 针对网文创作常见问题（真实官方机构名冲突、未闭合引号、违规引流）进行静态确定性检查。
 */
export const REAL_OFFICIAL_NAMES = ['公安部', '国务院', '中纪委', '省委', '市委', '信访局'] as const

export function runLocalComplianceCheck(text: string): string[] {
  const issues: string[] = []
  if (!text.trim()) {
    return ['请输入需要审查的文本段落']
  }

  for (const name of REAL_OFFICIAL_NAMES) {
    if (text.includes(name)) {
      issues.push(`发现真实官方机构名「${name}」：网文灵异/现代题材建议使用架空名称（如龙国治安局、特事处等）`)
    }
  }

  if (/(?:qq|微信|vx|vx号|扣扣|群号)[\s:：]*[0-9a-zA-Z]{5,}/i.test(text)) {
    issues.push('发现疑似联系方式/社交账号引流违规表达，建议移除或改为小说内部虚拟代号')
  }

  const leftQuotes = (text.match(/“/g) || []).length
  const rightQuotes = (text.match(/”/g) || []).length
  if (leftQuotes !== rightQuotes) {
    issues.push(`双引号未闭合：左引号 ${leftQuotes} 处，右引号 ${rightQuotes} 处`)
  }

  if (issues.length === 0) {
    issues.push('本地基础规则审查完成：未发现真实机构冲突、未闭合引号或明显违规引流表达。')
  }

  return issues
}
