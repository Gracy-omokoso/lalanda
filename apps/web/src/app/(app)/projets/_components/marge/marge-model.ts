// Modèle pur de la carte « Marge » d'un projet (ADR-0039 § 5 et § 8, lot L4a).
//
// AUCUN calcul de montant ici : la marge, ses composantes et ses constats
// viennent de l'API (moteur `computeProjectMargin`). Ce module ne fait que
// mettre en forme (signe, séparateurs) et traduire les constats en français.

import type { ProjectMarginView, WorkSuggestion } from '@lalanda/shared/work';

import { formatMontant } from '../../../ventes/_components/sales-model';

/** Libellé exigé par l'ADR (§ 5) : la marge est étiquetée TTC et expliquée. */
export const MARGE_TITRE = 'Marge encaissée du projet (TTC)';
export const MARGE_EXPLICATION =
  'Calculée par Lalanda à partir des encaissements, des dépenses et du temps saisis. Montants payés, TVA comprise ; une devise ne s’additionne jamais à une autre.';

/** Montant signé servi par l'API (`"-10000.00"`) → `−10 000,00 CDF`. */
export function montantSigne(valeur: string, devise: string): string {
  return valeur.startsWith('-')
    ? `−${formatMontant(valeur.slice(1), devise)}`
    : formatMontant(valeur, devise);
}

/** Durée en minutes → `1 h 30`, `45 min`. */
export function duree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export type TonConstat = 'info' | 'attention';

export interface ConstatAffiche {
  code: string;
  texte: string;
  ton: TonConstat;
}

/** Titre du constat du matériel (ADR-0046 § 6.4, décision ouverte n° 12). */
export const MATERIEL_TITRE = 'Matériel sorti du stock — informatif';

/**
 * ADR-0046 § 6.4 (marge 1.3.0) : matériel sorti du stock pour le projet, une phrase par
 * devise de coût. Valeur rendue par le moteur (coût moyen), jamais recalculée ni
 * soustraite. `materials` absent ou `null` (droits) : aucune phrase.
 */
export function constatsMateriel(view: ProjectMarginView): ConstatAffiche[] {
  return (view.materials ?? []).map((m) => {
    const bons = `${m.issueCount} ${m.issueCount > 1 ? 'bons de sortie' : 'bon de sortie'}`;
    const sansCout =
      m.unvaluedCount > 0
        ? ` ${m.unvaluedCount} mouvement(s) sans coût connu n’y sont pas valorisés.`
        : '';
    return {
      code: `MATERIALS_FROM_STOCK.${m.currency}`,
      ton: 'info',
      texte: `${MATERIEL_TITRE} : ${montantSigne(m.consumedValue, m.currency)} (${bons}, au coût moyen). Son achat entre déjà dans la marge par sa dépense : rien n’est soustrait.${sansCout}`,
    };
  });
}

/** Titre des frais du personnel en attente (ADR-0051 § 7.3). */
export const FRAIS_EN_ATTENTE_TITRE = 'Frais approuvés non remboursés — informatif';

/**
 * ADR-0051 — H14 (marge 1.4.0) : frais du personnel approuvés non encore remboursés,
 * imputés au projet, une phrase par devise. Montant rendu par le moteur, jamais recalculé
 * ni soustrait. `pendingExpenseClaims` absent ou `null` : aucune phrase.
 */
export function constatsFraisEnAttente(view: ProjectMarginView): ConstatAffiche[] {
  return (view.pendingExpenseClaims ?? []).map((p) => ({
    code: `PENDING_EXPENSE_CLAIMS.${p.currency}`,
    ton: 'info',
    texte: `${FRAIS_EN_ATTENTE_TITRE} : ${montantSigne(p.amount, p.currency)} (${p.lineCount} ${p.lineCount > 1 ? 'lignes' : 'ligne'}). Ils entreront dans la marge par leur dépense de remboursement : rien n’est soustrait d’ici là.`,
  }));
}

/**
 * Constats codés de l'API → phrases françaises, dans l'ordre servi, puis le matériel et
 * (ADR-0051 — H14) les frais du personnel en attente de remboursement.
 */
export function constats(view: ProjectMarginView): ConstatAffiche[] {
  return [...constatsServis(view), ...constatsMateriel(view), ...constatsFraisEnAttente(view)];
}

function constatsServis(view: ProjectMarginView): ConstatAffiche[] {
  return view.findings.map((f): ConstatAffiche => {
    switch (f.code) {
      case 'MULTI_CURRENCY':
        return {
          code: f.code,
          ton: 'info',
          texte: `Le projet compte ${f.count ?? 2} devises : chacune a sa marge, elles ne s’additionnent pas.`,
        };
      case 'TIME_WITHOUT_RATE':
        return {
          code: f.code,
          ton: 'attention',
          texte: `${duree(f.minutes ?? 0)} de temps saisi sans coût horaire : ce temps n’est pas compté dans la marge (renseignez les taux des membres).`,
        };
      case 'NO_INVOICE_LINKED':
        return {
          code: f.code,
          ton: 'info',
          texte: 'Aucune facture n’est liée au projet : rien n’est encore encaissé.',
        };
      case 'DRAFT_INVOICES_IGNORED':
        return {
          code: f.code,
          ton: 'info',
          texte: `${f.count ?? 1} facture(s) liée(s) non émise(s) (brouillon ou pro forma) : elles n’apportent rien tant qu’elles ne sont pas émises.`,
        };
      case 'AMOUNTS_INCLUDE_TAX':
        return {
          code: f.code,
          ton: 'info',
          texte: 'Encaissements et dépenses sont des montants payés, TVA comprise (TTC).',
        };
      // ADR-0045 — H5 (§ 6.3, marge 1.2.0) : signalé, jamais retranché.
      case 'PERSONNEL_EXPENSES_AND_TIME_COST':
        return {
          code: f.code,
          ton: 'attention',
          texte: `${f.currency ? `En ${f.currency}, ` : ''}des salaires (dépenses « Salaires et charges sociales ») sont rattachés au projet ET du temps y est valorisé : la même personne est peut-être comptée deux fois. Rien n’a été retranché ; retirez l’un des deux si c’est le cas.`,
        };
      default:
        return { code: String(f.code), ton: 'info', texte: String(f.code) };
    }
  });
}

export interface LigneMarge {
  libelle: string;
  valeur: string;
  /** Composante retranchée (affichée avec un signe moins). */
  retranchee: boolean;
}

/** Lignes d'une devise, dans l'ordre de la formule de l'ADR. */
export function lignesDevise(c: ProjectMarginView['currencies'][number]): LigneMarge[] {
  const moins = (v: string) =>
    v === '0.00' ? montantSigne(v, c.currency) : `−${formatMontant(v, c.currency)}`;
  return [
    { libelle: 'Encaissé', valeur: formatMontant(c.received, c.currency), retranchee: false },
    { libelle: 'Avoirs remboursés', valeur: moins(c.refunded), retranchee: true },
    { libelle: 'Dépenses rattachées', valeur: moins(c.expenses), retranchee: true },
    {
      libelle: `Coût du temps (${duree(c.timeMinutes)})`,
      valeur: moins(c.timeCost),
      retranchee: true,
    },
  ];
}

/** La suggestion « Préparer la facture » d'une écriture de tâche, ou `null`. */
export function suggestionFacture(
  suggestions: readonly WorkSuggestion[] | undefined,
): WorkSuggestion | null {
  return suggestions?.find((s) => s.code === 'PREPARE_INVOICE') ?? null;
}

/** Message d'erreur lisible pour la carte et les propositions. */
export function messageErreur(err: unknown, repli: string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return 'Vous n’avez pas les droits nécessaires pour cette action.';
  if (status === 404) return 'Élément introuvable dans cette organisation.';
  return err instanceof Error && err.message ? err.message : repli;
}
