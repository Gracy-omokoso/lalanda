// Résolution des règles de correspondance (ADR-0049 § 2.4 et § 6.0).
//
// Le moteur ne choisit JAMAIS un compte : il applique la règle validée reçue,
// ou désigne le compte d'attente fourni par la configuration, avec un motif.

import {
  ACCOUNT_TOKENS,
  type AccountRef,
  type AuxiliaryAccount,
  type EntrySide,
  type MappingRuleSet,
  type RuleResolution,
  type SuspenseReason,
} from '../types.js';
import { ALWAYS_SUSPENSE_KEYS, isOperationKey } from './operation-keys.js';

/** Numéro de compte : chiffres seulement (un compte propre prolonge un compte du pack, § 2.3). */
const ACCOUNT_NUMBER = /^\d{1,20}$/;

export function isAccountNumber(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_NUMBER.test(value);
}

/**
 * Règle validée pour `key`, ou compte d'attente avec motif. Une règle marquée
 * `requiresReview` n'est jamais appliquée : elle est encore « à confirmer ».
 */
export function resolveRule(ruleSet: MappingRuleSet | null, key: string): RuleResolution {
  if (ruleSet === null || ruleSet.status !== 'validated') {
    return { status: 'suspense', reason: 'NO_VALIDATED_RULE_SET' };
  }
  if ((ALWAYS_SUSPENSE_KEYS as readonly string[]).includes(key)) {
    return { status: 'suspense', reason: 'NATURE_UNKNOWN' };
  }
  const rule = ruleSet.rules.find((r) => r.key === key);
  if (rule === undefined) return { status: 'suspense', reason: 'NO_RULE' };
  if (rule.requiresReview) return { status: 'suspense', reason: 'RULE_REQUIRES_REVIEW' };
  return { status: 'rule', rule, ruleSetVersion: ruleSet.version };
}

/** Valeurs des jetons, connues de la pièce et du contexte ; `null` = inconnue. */
export interface TokenValues {
  party?: AuxiliaryAccount | null;
  treasuryAccount?: string | null;
}

export interface ResolvedAccount {
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  suspenseReason: SuspenseReason | null;
}

/** Compte d'une ligne de clé `key`, au côté `side`. */
export function resolveAccount(
  ruleSet: MappingRuleSet | null,
  key: string,
  side: EntrySide,
  tokens: TokenValues,
  suspenseAccount: string,
): ResolvedAccount {
  const suspense = (reason: SuspenseReason): ResolvedAccount => ({
    accountNumber: suspenseAccount,
    auxiliaryAccountNumber: null,
    suspenseReason: reason,
  });
  const resolution = resolveRule(ruleSet, key);
  if (resolution.status === 'suspense') return suspense(resolution.reason);
  const refs = resolution.rule[side];
  if (refs.length === 0) return suspense('RULE_SIDE_MISSING');
  if (refs.length > 1) return suspense('RULE_SIDE_AMBIGUOUS');
  return accountOfRef(refs[0] ?? '', tokens, suspense);
}

function accountOfRef(
  ref: AccountRef,
  tokens: TokenValues,
  suspense: (reason: SuspenseReason) => ResolvedAccount,
): ResolvedAccount {
  if (ref === '{customer}' || ref === '{supplier}') {
    const party = tokens.party ?? null;
    if (party === null) return suspense('PARTY_ACCOUNT_UNKNOWN');
    return {
      accountNumber: party.collectiveNumber,
      auxiliaryAccountNumber: party.auxiliaryNumber,
      suspenseReason: null,
    };
  }
  if (ref === '{treasuryAccount}') {
    const account = tokens.treasuryAccount ?? null;
    if (account === null) return suspense('NO_TREASURY_ACCOUNT');
    return { accountNumber: account, auxiliaryAccountNumber: null, suspenseReason: null };
  }
  if (!isAccountNumber(ref)) return suspense('RULE_ACCOUNT_INVALID');
  return { accountNumber: ref, auxiliaryAccountNumber: null, suspenseReason: null };
}

export type RuleSetIssueCode =
  | 'UNKNOWN_OPERATION_KEY'
  | 'DUPLICATE_OPERATION_KEY'
  | 'RULE_ACCOUNT_INVALID'
  | 'RULE_WITHOUT_ACCOUNT';

export interface RuleSetIssue {
  code: RuleSetIssueCode;
  key: string;
  message: string;
}

/** Contrôle de forme d'un jeu de règles avant validation (aucune règle comptable). */
export function checkRuleSet(ruleSet: MappingRuleSet): RuleSetIssue[] {
  const issues: RuleSetIssue[] = [];
  const seen = new Set<string>();
  for (const rule of ruleSet.rules) {
    if (!isOperationKey(rule.key)) {
      issues.push({
        code: 'UNKNOWN_OPERATION_KEY',
        key: rule.key,
        message: `Clé d’opération inconnue : ${rule.key}`,
      });
    }
    if (seen.has(rule.key)) {
      issues.push({
        code: 'DUPLICATE_OPERATION_KEY',
        key: rule.key,
        message: `Clé en double : ${rule.key}`,
      });
    }
    seen.add(rule.key);
    const refs = [...rule.debit, ...rule.credit];
    if (refs.length === 0) {
      issues.push({
        code: 'RULE_WITHOUT_ACCOUNT',
        key: rule.key,
        message: `Règle sans compte : ${rule.key}`,
      });
    }
    for (const ref of refs) {
      if (!isAccountNumber(ref) && !(ACCOUNT_TOKENS as readonly string[]).includes(ref)) {
        issues.push({
          code: 'RULE_ACCOUNT_INVALID',
          key: rule.key,
          message: `Compte illisible pour ${rule.key} : ${JSON.stringify(ref)}`,
        });
      }
    }
  }
  return issues;
}
