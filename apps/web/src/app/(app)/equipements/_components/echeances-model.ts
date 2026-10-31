// Échéances des équipements, rapports et réglages (ADR-0046 § 3.4, § 3.5, § 5.2 ;
// lot S9). Logique pure, testée. Les échéances, les nombres et les totaux par
// devise sont ceux du moteur, par l'API ; ici, seulement des libellés, des tons,
// des regroupements d'affichage et la lecture des saisies de réglages.

import type { AssetDeadlineView, AssetReportsView, AssetSettingsView } from '@/lib/api-assets';

import { formatMontant, lireEntierSaisi, type Ton } from './equipements-model';

export type TypeEcheance = AssetDeadlineView['kind'];

export const LIBELLES_ECHEANCE: Record<TypeEcheance, string> = {
  maintenance_overdue: 'Maintenance en retard',
  maintenance_due_soon: 'Maintenance à venir',
  coverage_expired: 'Garantie ou assurance expirée',
  coverage_due_soon: 'Garantie ou assurance qui expire',
  held_by_former_employee: 'Chez un collaborateur sorti',
};

export function tonEcheance(k: TypeEcheance): Ton {
  return k === 'maintenance_overdue' || k === 'coverage_expired' || k === 'held_by_former_employee'
    ? 'danger'
    : 'warning';
}

/** Ordre d'affichage des groupes : l'urgent d'abord. */
export const ORDRE_ECHEANCES: readonly TypeEcheance[] = [
  'maintenance_overdue',
  'coverage_expired',
  'held_by_former_employee',
  'maintenance_due_soon',
  'coverage_due_soon',
];

/** Délai lisible, servi par le moteur (`daysLeft`). */
export function phraseDelai(e: Pick<AssetDeadlineView, 'kind' | 'daysLeft'>): string {
  if (e.kind === 'held_by_former_employee') return 'depuis la sortie';
  const n = e.daysLeft;
  if (n === 0) return 'aujourd’hui';
  if (n < 0) return `il y a ${-n} jour${n === -1 ? '' : 's'}`;
  return `dans ${n} jour${n === 1 ? '' : 's'}`;
}

/** Regroupe les échéances par nature, dans l'ordre d'urgence ; groupes vides retirés. */
export function grouperEcheances(
  items: readonly AssetDeadlineView[],
): { kind: TypeEcheance; libelle: string; items: AssetDeadlineView[] }[] {
  return ORDRE_ECHEANCES.map((kind) => ({
    kind,
    libelle: LIBELLES_ECHEANCE[kind],
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);
}

// ── Rapports ────────────────────────────────────────────────────────────────

/** Totaux par devise, une ligne chacun ; jamais additionnés entre devises. */
export function lignesDevises(
  totaux: readonly { currency: string; total: string; count: number }[] | null,
): string[] {
  if (totaux === null) return [];
  return totaux.map(
    (t) => `${formatMontant(t.total, t.currency)} (${t.count} équipement${t.count > 1 ? 's' : ''})`,
  );
}

export function affectesLignes(r: AssetReportsView): [string, number][] {
  return [
    ['Collaborateurs', r.assigned.employee],
    ['Membres', r.assigned.member],
    ['Projets', r.assigned.project],
    ['Emplacements', r.assigned.location],
    ['Non affectés', r.assigned.none],
  ];
}

// ── Réglages ────────────────────────────────────────────────────────────────

export interface FormulaireReglages {
  reminderDays: string;
  maintenanceDueSoonDays: string;
  showDepreciationEstimate: boolean;
}

export function formulaireReglages(s: AssetSettingsView): FormulaireReglages {
  return {
    reminderDays: String(s.reminderDays),
    maintenanceDueSoonDays: String(s.maintenanceDueSoonDays),
    showDepreciationEstimate: s.showDepreciationEstimate,
  };
}

export function preparerReglages(
  f: FormulaireReglages,
  revision: number,
):
  | {
      ok: true;
      corps: {
        expectedRevision: number;
        reminderDays: number;
        maintenanceDueSoonDays: number;
        showDepreciationEstimate: boolean;
      };
    }
  | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const r = lireEntierSaisi(f.reminderDays, 0, 120);
  const m = lireEntierSaisi(f.maintenanceDueSoonDays, 0, 120);
  if (!r.ok) champs['reminderDays'] = r.erreur;
  if (!m.ok) champs['maintenanceDueSoonDays'] = m.erreur;
  if (!r.ok || !m.ok) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      expectedRevision: revision,
      reminderDays: r.valeur,
      maintenanceDueSoonDays: m.valeur,
      showDepreciationEstimate: f.showDepreciationEstimate,
    },
  };
}
