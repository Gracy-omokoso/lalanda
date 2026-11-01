// Règles de correspondance (ADR-0049 § 2.4) — lot K2.
export {
  ALWAYS_SUSPENSE_KEYS,
  ACCOUNTING_NON_REVENUE_TAX_GROUPS,
  OPERATION_KEY_FAMILIES,
  SALES_DOCUMENT_PREFIXES,
  isOperationKey,
  type SalesDocumentPrefix,
} from './operation-keys.js';
export {
  checkRuleSet,
  isAccountNumber,
  resolveAccount,
  resolveRule,
  type ResolvedAccount,
  type RuleSetIssue,
  type RuleSetIssueCode,
  type TokenValues,
} from './resolve.js';
