// Comptabilité — restitution (ADR-0049, lot K3) : grand livre, balances, lettrage.
// `money.ts` reste interne.

export * from './types.js';
export {
  computeAuxiliaryBalances,
  computeLedger,
  computeTrialBalance,
  type AuxiliaryBalanceGroup,
  type AuxiliaryBalanceRow,
  type AuxiliaryBalances,
  type Ledger,
  type LedgerAccount,
  type LedgerInput,
  type LedgerLineOut,
  type ReportingPeriodInput,
  type TrialBalance,
  type TrialBalanceClass,
  type TrialBalanceRow,
  type TrialBalanceTotals,
} from './ledger.js';
export {
  checkLettering,
  LETTERING_ERROR_CODES,
  resolveLettering,
  suggestLettering,
  type LetteringCheck,
  type LetteringCheckInput,
  type LetteringErrorCode,
  type LetteringEvent,
  type LetteringState,
  type LetteringSuggestion,
  type LetteringSuggestions,
  type ReportingDayTime,
} from './lettering.js';
export { lineRefOf } from './money.js';
