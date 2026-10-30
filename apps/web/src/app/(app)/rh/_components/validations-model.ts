// Absences à valider et liste des demandes (ADR-0045 § 3.2, § 4.3) — logique pure, lot H6.
//
// `GET /hr/leave-approvals/pending` ne rend QUE les demandes que l'appelant peut
// traiter (manager désigné, détenteur de `leave.approve`, jamais les siennes sauf
// approbateur unique) : l'écran ne refiltre rien. La séparation des tâches est
// jugée par l'API (`leaveApprovalDecision`) ; ses refus sont traduits.

import type { OrgAction } from '@/lib/api';
import type { LeaveRequestStatus, LeaveRequestView } from '@/lib/api-hr';

import { LIBELLES_ETAPE, etapeEnAttente, peutLireRh } from './rh-model';

export type VueAbsences = 'a-valider' | 'toutes';

/** Vue demandée par l'adresse ; « toutes » exige `hr.read`, sinon « à valider ». */
export function vueAbsences(
  param: string | null,
  actions: readonly OrgAction[] | null,
): VueAbsences {
  return param === 'toutes' && peutLireRh(actions) ? 'toutes' : 'a-valider';
}

export const FILTRES_STATUT: { valeur: LeaveRequestStatus | ''; libelle: string }[] = [
  { valeur: 'pending', libelle: 'En attente' },
  { valeur: 'approved', libelle: 'Accordées' },
  { valeur: 'rejected', libelle: 'Refusées' },
  { valeur: 'cancelled', libelle: 'Annulées' },
  { valeur: '', libelle: 'Toutes' },
];

/** « Étape : manager », « Étape : ressources humaines (2 sur 2) ». */
export function libelleEtape(r: LeaveRequestView): string | null {
  const etape = etapeEnAttente(r);
  if (etape === null) return null;
  const rang = r.steps.indexOf(etape) + 1;
  const total = r.steps.length;
  const suffixe = total > 1 && rang > 0 ? ` (${rang} sur ${total})` : '';
  return `Étape : ${LIBELLES_ETAPE[etape].toLowerCase()}${suffixe}`;
}

/** Décisions déjà prises, en phrases (« Validée par Awa (manager) le 3 nov. »). */
export function historiqueDecisions(
  r: LeaveRequestView,
  formatInstant: (iso: string) => string,
): string[] {
  return r.approvals.map((a) => {
    const qui = a.userName ?? 'un validateur';
    const quoi = a.decision === 'approved' ? 'Validée' : 'Refusée';
    const marques = [
      LIBELLES_ETAPE[a.step].toLowerCase(),
      a.onBehalfOfManager ? 'en suppléance du manager' : null,
      a.soleApprover ? 'approbateur unique' : null,
    ].filter(Boolean);
    return `${quoi} par ${qui} (${marques.join(', ')}) le ${formatInstant(a.at)}${a.comment ? ` — « ${a.comment} »` : ''}`;
  });
}

/** Nom du demandeur tel que servi, sinon une phrase neutre. */
export function nomDemandeur(r: LeaveRequestView): string {
  return r.employeeName?.trim() || 'Un collaborateur';
}
