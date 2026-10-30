// Demande d'absence en fenêtre modale (ADR-0045 § 2.7, `POST /hr/leave-requests`)
// — logique pure, lot H6.
//
// Le web ne décompte AUCUN jour : le nombre de jours (jours travaillés, fériés,
// demi-journées) est calculé par le moteur à l'envoi, puis affiché tel que rendu.
// Les vérifications ci-dessous sont de forme (champs requis, ordre des dates) ;
// chevauchement, solde et jours travaillés sont jugés par l'API.

import { HR_LIMITS } from '@lalanda/shared/hr';

import type { CreateLeaveRequestInput, LeaveHalf, LeaveTypeView } from '@/lib/api-hr';

export interface FormDemande {
  typeId: string;
  debut: string;
  fin: string;
  /** Une seule journée : journée entière, matin ou après-midi. */
  demiUnique: LeaveHalf;
  /** Plusieurs jours : le premier jour entier (`full`) ou l'après-midi seulement (`pm`). */
  demiDebut: 'full' | 'pm';
  /** Plusieurs jours : le dernier jour entier (`full`) ou le matin seulement (`am`). */
  demiFin: 'full' | 'am';
  motif: string;
}

export function formDemandeInitial(aujourdhui: string): FormDemande {
  return {
    typeId: '',
    debut: aujourdhui,
    fin: aujourdhui,
    demiUnique: 'full',
    demiDebut: 'full',
    demiFin: 'full',
    motif: '',
  };
}

/**
 * Types proposés : actifs, et ceux réservés aux RH (« Absence non justifiée »)
 * seulement pour qui gère les dossiers (`hr.manage`).
 */
export function typesProposes(types: readonly LeaveTypeView[], gererRh: boolean): LeaveTypeView[] {
  return types.filter((t) => t.active && (gererRh || t.hrOnly !== true));
}

/** Une demande en jours entiers ne propose pas de demi-journée. */
export function demiJourneesPermises(type: LeaveTypeView | undefined): boolean {
  return type?.unit === 'half_day';
}

export const unJour = (f: Pick<FormDemande, 'debut' | 'fin'>): boolean =>
  f.fin === '' || f.fin === f.debut;

export type ErreursDemande = Partial<Record<'typeId' | 'debut' | 'fin' | 'motif', string>>;

export type ResultatDemande =
  | { ok: true; corps: CreateLeaveRequestInput }
  | { ok: false; erreurs: ErreursDemande };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

export function validerDemande(
  f: FormDemande,
  types: readonly LeaveTypeView[],
  employeeId?: string,
): ResultatDemande {
  const erreurs: ErreursDemande = {};
  const type = types.find((t) => t.id === f.typeId);
  if (!type) erreurs.typeId = 'Choisissez un type d’absence.';
  if (!JOUR.test(f.debut)) erreurs.debut = 'Indiquez la date de début.';
  if (f.fin !== '' && !JOUR.test(f.fin)) erreurs.fin = 'Date de fin invalide.';
  else if (f.fin !== '' && JOUR.test(f.debut) && f.fin < f.debut) {
    erreurs.fin = 'La fin ne peut pas précéder le début.';
  }
  const motif = f.motif.trim();
  if (motif.length > HR_LIMITS.leaveReason) {
    erreurs.motif = `${HR_LIMITS.leaveReason} caractères au plus.`;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };

  const demi = demiJourneesPermises(type);
  const fin = f.fin === '' ? f.debut : f.fin;
  const corps: CreateLeaveRequestInput = unJour(f)
    ? {
        typeId: f.typeId,
        start: { date: f.debut, half: demi ? f.demiUnique : 'full' },
        end: { date: f.debut, half: demi ? f.demiUnique : 'full' },
      }
    : {
        typeId: f.typeId,
        start: { date: f.debut, half: demi ? f.demiDebut : 'full' },
        end: { date: fin, half: demi ? f.demiFin : 'full' },
      };
  if (motif !== '') corps.reason = motif;
  if (employeeId) corps.employeeId = employeeId;
  return { ok: true, corps };
}

/** Phrase d'aide sous le type choisi (confidentialité, pièce, solde). */
export function aideType(type: LeaveTypeView | undefined): string | undefined {
  if (!type) return undefined;
  const phrases: string[] = [];
  if (type.confidential) {
    phrases.push(
      'Type confidentiel : votre manager et vos collègues ne verront que « Absent », et la demande est validée par les ressources humaines.',
    );
  }
  if (type.requiresDocument) {
    phrases.push('Un justificatif vous sera demandé par les ressources humaines.');
  }
  if (type.deductsFromBalance) phrases.push('Ces jours seront décomptés de votre solde.');
  return phrases.length > 0 ? phrases.join(' ') : undefined;
}
