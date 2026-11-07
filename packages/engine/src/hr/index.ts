// Ressources humaines (ADR-0045 § 7) — point d'entrée du module. Versionné à
// part (`HR_VERSION`) ; n'écrit dans aucun réalisé, plan ni scénario, et ne pose
// aucune règle légale. `days.ts` reste interne.

export * from './types.js';
export {
  availabilityOf,
  checkLeaveDebit,
  leaveDays,
  leaveOverlaps,
  teamCalendar,
} from './leave.js';
export {
  ACCRUAL_DAYS_BOUNDS,
  CARRY_OVER_BOUNDS,
  accrualsDue,
  carryOverExpiryOf,
  carryOverOf,
  leaveBalance,
  leaveYearBounds,
  leaveYearOf,
} from './balance.js';
export {
  departmentCycle,
  hrViewerScope,
  leaveApprovalSteps,
  orgChart,
  reportingCycle,
} from './structure.js';
export {
  absenteeism,
  employeeStatusOf,
  headcount,
  hrDeadlines,
  movements,
  seniority,
  seniorityYears,
} from './reports.js';
export { weeklyTimesheet } from './timesheet.js';
// ADR-0051 — H9
export * from './expenses.js';
export * from './advances.js';
export * from './attendance.js';
export * from './planning.js';
export * from './performance.js';
// ADR-0068 — matricules et numéros de poste
export * from './numbering.js';
