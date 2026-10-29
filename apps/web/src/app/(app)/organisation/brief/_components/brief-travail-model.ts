// Logique pure du bloc « Projets et tâches » du brief du matin (ADR-0039 § 6.5).
//
// Les valeurs viennent du moteur `morning-brief` (faits `mes_taches.*`,
// `taches.en_retard`, `projets_a_risque`) ; ce module choisit l'ordre, le lien
// de chaque ligne et décide si le bloc s'affiche : sans `work.read`, le
// serveur rend ces faits `hidden` et le bloc disparaît plutôt que d'aligner
// quatre « masqué ». Un fait inconnu n'est jamais affiché comme zéro.

import type { BriefFactView, MorningBriefData } from '@/lib/morning-brief-api';

import { valeurFait } from '../../_components/morning-brief-model';

const FAITS: readonly { id: string; lien: string }[] = [
  { id: 'mes_taches.en_retard', lien: '/projets/mes-taches' },
  { id: 'mes_taches.aujourdhui', lien: '/projets/mes-taches' },
  { id: 'taches.en_retard', lien: '/projets' },
  { id: 'projets_a_risque', lien: '/projets' },
];

export interface LigneTravail {
  id: string;
  libelle: string;
  valeur: string;
  /** Compteur connu et positif, hors « du jour » : mis en relief. */
  attention: boolean;
  lien: string;
  regle: string;
}

export function blocTravail(brief: MorningBriefData): LigneTravail[] | null {
  const presents = FAITS.flatMap((d) => {
    const f = brief.facts.find((x) => x.id === d.id);
    return f ? [{ d, f }] : [];
  });
  if (presents.length === 0 || presents.every(({ f }) => f.status === 'hidden')) return null;
  return presents.map(({ d, f }) => ({
    id: f.id,
    libelle: f.label,
    valeur: valeurFait(f),
    attention: f.id !== 'mes_taches.aujourdhui' && positif(f),
    lien: d.lien,
    regle: f.source.rule,
  }));
}

function positif(f: BriefFactView): boolean {
  return f.status === 'known' && f.value !== null && /^[1-9]\d*$/.test(f.value);
}
