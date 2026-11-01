// Éléments « Mes tâches » des contrats (ADR-0050 § 6, § 7).
//
// Le moteur produit des éléments et leur AUDIENCE (`approvers`, `owner`,
// `invoicers`) ; l'appelant résout les destinataires sur les droits EFFECTIFS
// (ADR-0041, `holdersOf`), jamais par rôle. Aucun élément ne dit qu'une clause
// est valable : seules des dates, calculées à partir des clauses saisies.

import { addDays, byString, checkDay, checkInt, compareDays, dayNumber } from './common.js';
import { contractTerms } from './terms.js';
import {
  CONTRACTS_VERSION,
  SIGNED_COPY_MISSING_DAYS,
  type AlertContractInput,
  type ContractAlert,
  type ContractAlertSettings,
  type ContractAlertsResult,
  type ContractDay,
} from './types.js';

const within = (today: ContractDay, from: ContractDay, to: ContractDay | null): boolean =>
  compareDays(today, from) >= 0 && (to === null || compareDays(today, to) <= 0);

function alert(
  partial: Omit<ContractAlert, 'amendmentId' | 'excludeUserId' | 'count' | 'reasons'> &
    Partial<Pick<ContractAlert, 'amendmentId' | 'excludeUserId' | 'count' | 'reasons'>>,
): ContractAlert {
  return {
    amendmentId: null,
    excludeUserId: null,
    count: 1,
    reasons: [],
    ...partial,
  };
}

/** Éléments du § 6 pour un ensemble de contrats d'une organisation, au jour `today`. */
export function contractAlerts(
  contracts: readonly AlertContractInput[],
  settings: ContractAlertSettings,
  today: ContractDay,
): ContractAlertsResult {
  checkDay(today, 'Date du jour');
  const noticeAlertDays = checkInt(settings.noticeAlertDays, 0, 365, 'Alerte de préavis');
  const termEndAlertDays = checkInt(settings.termEndAlertDays, 0, 365, 'Alerte de fin de terme');
  const alerts: ContractAlert[] = [];
  let draftCount = 0;
  let oldestDraft: ContractDay | null = null;

  for (const c of contracts) {
    const owner = c.ownerUserId;

    if (c.status === 'submitted') {
      alerts.push(
        alert({
          id: `sct:contract_to_approve:${c.id}`,
          kind: 'contract_to_approve',
          contractId: c.id,
          audience: 'approvers',
          ownerUserId: owner,
          excludeUserId: c.submittedBy,
          dueDate: c.submittedOn === null ? null : checkDay(c.submittedOn, 'Soumission'),
          visibleFrom: null,
        }),
      );
    }

    for (const a of c.amendments) {
      if (a.status === 'submitted') {
        alerts.push(
          alert({
            id: `sct:amendment_to_approve:${c.id}:${a.id}`,
            kind: 'amendment_to_approve',
            contractId: c.id,
            amendmentId: a.id,
            audience: 'approvers',
            ownerUserId: owner,
            excludeUserId: a.submittedBy,
            dueDate: a.submittedOn === null ? null : checkDay(a.submittedOn, 'Soumission'),
            visibleFrom: null,
          }),
        );
      }
      if (a.status === 'approved' && !a.hasSignedCopy && a.approvedOn !== null) {
        const from = addDays(checkDay(a.approvedOn, 'Approbation'), SIGNED_COPY_MISSING_DAYS);
        if (compareDays(today, from) >= 0) {
          alerts.push(
            alert({
              id: `sct:signed_copy_missing:${c.id}:${a.id}`,
              kind: 'signed_copy_missing',
              contractId: c.id,
              amendmentId: a.id,
              audience: 'owner',
              ownerUserId: owner,
              dueDate: null,
              visibleFrom: from,
            }),
          );
        }
      }
    }

    for (const d of c.draftOccurrenceDates) {
      checkDay(d, 'Brouillon d’échéance');
      draftCount += 1;
      if (oldestDraft === null || compareDays(d, oldestDraft) < 0) oldestDraft = d;
    }

    for (const b of c.blockedOccurrences) {
      alerts.push(
        alert({
          id: `sct:occurrence_blocked:${c.id}:${b.key}`,
          kind: 'occurrence_blocked',
          contractId: c.id,
          audience: 'owner',
          ownerUserId: owner,
          dueDate: checkDay(b.date, 'Échéance bloquée'),
          visibleFrom: null,
          reasons: [...b.reasons].sort(byString),
        }),
      );
    }

    // Dates de terme : contrats signés et non résiliés seulement.
    if (c.status !== 'signed' || c.termination !== null) continue;
    const t = contractTerms(
      {
        startDate: c.startDate,
        status: c.status,
        lines: [],
        billing: { kind: 'none' },
        initialTermMonths: c.initialTermMonths,
        renewal: c.renewal,
        noticeDays: c.noticeDays,
        clauses: null,
      },
      [],
      c.renewals,
      null,
      today,
      { termEndAlertDays },
    );
    const end = t.lastTermEnd;
    if (end === null) continue;
    const current = t.currentTerm;

    // Date limite de préavis du dernier terme connu (pas encore passée).
    if (current.to === end && t.noticeDeadline !== null && !t.termElapsed) {
      const deadline = t.noticeDeadline;
      const from = addDays(deadline, -noticeAlertDays);
      if (within(today, from, deadline)) {
        alerts.push(
          alert({
            id: `sct:notice_deadline:${c.id}:${current.index}`,
            kind: 'notice_deadline',
            contractId: c.id,
            audience: 'owner',
            ownerUserId: owner,
            dueDate: deadline,
            visibleFrom: from,
          }),
        );
      }
    }

    const termFrom = addDays(end, -termEndAlertDays);
    if (c.renewal.mode === 'tacit') {
      // Reconduction à constater : de la fenêtre de fin de terme jusqu'au constat.
      if (t.proposedNextTerm !== null && dayNumber(today) >= dayNumber(termFrom)) {
        alerts.push(
          alert({
            id: `sct:renewal_to_record:${c.id}:${t.proposedNextTerm.index}`,
            kind: 'renewal_to_record',
            contractId: c.id,
            audience: 'approvers',
            ownerUserId: owner,
            dueDate: end,
            visibleFrom: termFrom,
          }),
        );
      }
    } else if (within(today, termFrom, end)) {
      alerts.push(
        alert({
          id: `sct:term_end:${c.id}:${t.renewalsRecorded}`,
          kind: 'term_end',
          contractId: c.id,
          audience: 'owner',
          ownerUserId: owner,
          dueDate: end,
          visibleFrom: termFrom,
        }),
      );
    }
  }

  if (draftCount > 0) {
    alerts.push(
      alert({
        id: 'sct:subscription_drafts_to_issue',
        kind: 'subscription_drafts_to_issue',
        contractId: null,
        audience: 'invoicers',
        ownerUserId: null,
        dueDate: oldestDraft,
        visibleFrom: null,
        count: draftCount,
      }),
    );
  }

  alerts.sort((a, b) => byString(a.id, b.id));
  return { version: CONTRACTS_VERSION, today, alerts };
}
