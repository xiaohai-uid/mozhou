export const CATALOG_VERSION = '2026-09-15.1';
/** Pro 解锁的全部高级软件能力（服务端裁决唯一来源）；Max 在 Pro 之上增加官方调用额度。 */
export const PRO_ENTITLEMENT_KEYS = [
    'style-distill',
    'novel-breakdown',
    'storyboard',
    'skills-library',
    'material-search',
    'web-search',
    'rankings',
    'deep-review',
    'task-center',
];
/** 永不因付费到期/退款锁死的基础能力（SPEC：阅读、手动编辑、导出、备份永远可用）。 */
export const BASIC_ALWAYS_AVAILABLE = ['create-book', 'read', 'write', 'export-own', 'backup-restore'];
const BUDGET = {
    modelBudgetFenPerMonth: 1500,
    p95CallFen: null,
    maxRetries: 3,
    maxInputTokensPerCall: 32_000,
    maxOutputTokensPerCall: 8_000,
    pricePerMTokenFen: null,
};
export const billingCatalog = Object.freeze({
    version: CATALOG_VERSION,
    currency: 'CNY',
    basicAlwaysAvailable: Object.freeze([...BASIC_ALWAYS_AVAILABLE]),
    pro: Object.freeze({
        planId: 'pro_monthly',
        name: '墨舟 Pro 月费',
        amountFen: 1900,
        currency: 'CNY',
        entitlementKeys: Object.freeze([...PRO_ENTITLEMENT_KEYS]),
    }),
    max: Object.freeze({
        planId: 'max_monthly',
        name: '墨舟 Max 月费',
        amountFen: 3900,
        currency: 'CNY',
        entitlementKeys: Object.freeze([...PRO_ENTITLEMENT_KEYS, 'managed-model-quota']),
    }),
    managed: Object.freeze({
        sellable: false,
        includedCallsPerMonth: null,
        worstCasePerCallFen: null,
        budget: Object.freeze({ ...BUDGET }),
    }),
});
