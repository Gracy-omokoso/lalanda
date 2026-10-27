// Brief du matin (ADR-0033) — point d'entrée du module.
export * from './types.js';
export {
  MORNING_BRIEF_RULES,
  MORNING_BRIEF_THRESHOLDS,
  MORNING_BRIEF_TOP,
  NON_REVENUE_TAX_GROUPS,
  buildMorningBrief,
  buildMorningBriefFacts,
  evaluateMorningBriefRules,
  formatFr,
  formatSigned,
  kinshasaDay,
} from './compute.js';
