import { ProjectResults } from '../_components/project-results';

interface Props {
  params: Promise<{ id: string }>;
}

// Page racine d'un projet = vue RÉSULTATS (S23a). Fil d'Ariane et onglets
// projet vivent dans `layout.tsx` (S18d).
//
// ── Renversement assumé de l'arbitrage S18c ────────────────────
// S18c posait que l'assistant « est » le contenu de cette page, en deux
// colonnes avec les feuilles de résultats, pour montrer l'impact d'une
// hypothèse pendant la frappe. À l'usage, onze feuilles plus le bandeau de
// ratios plus les exports saturaient l'écran : les deux moitiés se gênaient.
// La saisie part sur `/projects/:id/saisie`, la lecture reste ici.
//
// La racine reste la vue de lecture — et non la saisie — pour deux raisons :
// les liens `?tab=` déjà partagés continuent d'ouvrir la bonne feuille, et
// l'entrée par défaut dans un projet est de le consulter, pas de le modifier.
export default async function ProjectDetailPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <ProjectResults projectId={id} />;
}
