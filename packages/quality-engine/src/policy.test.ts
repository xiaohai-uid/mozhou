import { describe, expect, it } from 'vitest';
import { mergeQualityPolicies, qualityRuleSetDigest } from './policy.js';
import type { QualityPolicy, QualityRuleDefinition } from './types.js';

function rule(
  id: string,
  severity: QualityRuleDefinition['severity'],
  overrides: Partial<QualityRuleDefinition> = {},
): QualityRuleDefinition {
  return {
    id,
    version: '1.0.0',
    scope: 'platform',
    kind: 'deterministic',
    severity,
    description: 'rule ' + id,
    evidenceRequired: true,
    enabled: true,
    ...overrides,
  };
}

function policy(projectId: string, rules: QualityRuleDefinition[]): QualityPolicy {
  return { schemaVersion: 1, projectId, rules, maxAutomaticReworks: 2 };
}

describe('mergeQualityPolicies', () => {
  it('project rule overrides platform rule only by the same id', () => {
    const platform = policy('book-a', [rule('NARR-001', 'advisory'), rule('PARA-001', 'blocking')]);
    const project = policy('book-a', [rule('NARR-001', 'blocking')]);
    const merged = mergeQualityPolicies(platform, project);
    expect(merged.rules.find((r) => r.id === 'NARR-001')?.severity).toBe('blocking');
    expect(merged.rules.find((r) => r.id === 'PARA-001')?.severity).toBe('blocking');
    expect(merged.maxAutomaticReworks).toBe(2);
  });

  it('project-only rules are appended; platform rules absent from project are kept', () => {
    const platform = policy('book-a', [rule('PARA-001', 'blocking')]);
    const project = policy('book-a', [rule('BOOK-NARR', 'advisory')]);
    const merged = mergeQualityPolicies(platform, project);
    expect(merged.rules.map((r) => r.id).sort()).toEqual(['BOOK-NARR', 'PARA-001']);
    expect(merged.rules.find((r) => r.id === 'BOOK-NARR')?.scope).toBe('project');
  });

  it('merge result is deterministic regardless of input order', () => {
    const a = mergeQualityPolicies(
      policy('book-a', [rule('R2', 'advisory'), rule('R1', 'blocking')]),
      policy('book-a', []),
    );
    const b = mergeQualityPolicies(
      policy('book-a', [rule('R1', 'blocking'), rule('R2', 'advisory')]),
      policy('book-a', []),
    );
    expect(a.rules.map((r) => r.id)).toEqual(b.rules.map((r) => r.id));
  });
});

describe('qualityRuleSetDigest', () => {
  it('is stable across rule order', () => {
    const a = qualityRuleSetDigest(policy('book-a', [rule('R2', 'advisory'), rule('R1', 'blocking')]));
    const b = qualityRuleSetDigest(policy('book-a', [rule('R1', 'blocking'), rule('R2', 'advisory')]));
    expect(a).toBe(b);
  });

  it('excludes disabled rules and changes when a rule definition changes', () => {
    const withEnabled = qualityRuleSetDigest(policy('book-a', [rule('R1', 'blocking')]));
    const withDisabled = qualityRuleSetDigest(
      policy('book-a', [rule('R1', 'blocking', { enabled: false })]),
    );
    expect(withDisabled).not.toBe(withEnabled);

    const bumped = qualityRuleSetDigest(
      policy('book-a', [rule('R1', 'blocking', { version: '1.1.0' })]),
    );
    expect(bumped).not.toBe(withEnabled);
  });

  it('is a sha-256 hex digest', () => {
    const digest = qualityRuleSetDigest(policy('book-a', [rule('R1', 'blocking')]));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
