// Carte « Votre société » de l'accueil (ADR-0052 § 3, critère 18). ADR-0052 — O4.
//
// Logique pure sur la vue du serveur : avancement, trois capacités et lien direct vers
// l'étape suivante. La carte disparaît quand toutes les étapes sont faites ou reportées ;
// la mise en route reste ouverte depuis Organisation › Mise en route.

import type { OrganizationSetupView } from '@lalanda/shared/organization-setup';

import {
  etapeDe,
  etapeDeReprise,
  etapeVue,
  lienEtape,
  pastilles,
  progression,
  termine,
  type EtapeId,
  type Pastille,
} from '../../organisation/_components/onboarding-model';

export interface CarteSociete {
  faites: number;
  reglees: number;
  total: number;
  /** Pourcentage de la barre : étapes réglées (faites ou reportées) sur neuf. */
  pourcent: number;
  pastilles: Pastille[];
  suivante: {
    id: EtapeId;
    label: string;
    href: string;
    /** L'appelant peut-il la faire ? Sinon, qui le peut (l'invité lit la carte en lecture). */
    peutAgir: boolean;
    quiPeut: string;
  };
}

export function carteSociete(vue: OrganizationSetupView | null): CarteSociete | null {
  if (vue === null || termine(vue)) return null;
  const { faites, reglees, total } = progression(vue);
  const id = etapeDeReprise(vue);
  const etape = etapeDe(id);
  return {
    faites,
    reglees,
    total,
    pourcent: total ? Math.round((reglees / total) * 100) : 0,
    pastilles: pastilles(vue),
    suivante: {
      id,
      label: etape.label,
      href: lienEtape(id),
      peutAgir: etapeVue(vue, id).canAct,
      quiPeut: etape.quiPeut,
    },
  };
}
