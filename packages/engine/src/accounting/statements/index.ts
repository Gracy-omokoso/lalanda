// Comptabilité — projets d'états et réserves (ADR-0049 § 6.10, § 10 ; lot K3).

export {
  EXPORT_FORMAT_NOTE,
  findForbiddenWords,
  FORBIDDEN_WORDS,
  PROJECT_BANNER,
  SIMULATION_BANNER,
  STATEMENT_DISCLAIMER,
  STATEMENT_STATUS,
  TO_CONFIRM_NOTE,
  type StatementStatus,
} from './wording.js';
export {
  computeReserves,
  RESERVE_CODES,
  type Reserve,
  type ReserveCode,
  type Reserves,
  type ReservesInput,
} from './reserves.js';
export {
  computeStatement,
  STATEMENT_KINDS,
  type AccountRange,
  type StatementDraft,
  type StatementKind,
  type StatementOptions,
  type StatementRubric,
  type StatementRubricTemplate,
  type StatementSection,
  type StatementTemplateView,
} from './statement.js';
