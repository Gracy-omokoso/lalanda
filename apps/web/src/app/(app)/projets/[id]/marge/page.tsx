// `/projets/[id]/marge` — onglet « Marge » d'un projet du RUN (ADR-0039 § 8, lot L4a).
//
// La carte ne dépend que de l'identifiant du projet ; l'en-tête et les onglets
// viennent du layout de `/projets/[id]` (lot L3a). Pour afficher l'onglet,
// déclarer `{ segment: 'marge', label: 'Marge', action: 'treasury.read', livre: true }`
// dans `projets/_components/onglets-projet.ts` (la route exige aussi `work.read`
// et `sales.read` ; un refus s'affiche dans la carte).

import type { Metadata } from 'next';

import { CarteMarge } from '../../_components/marge/carte-marge';
import { FraisRefacturables } from '../_components/frais-refacturables';

export const metadata: Metadata = { title: 'Projet — Marge — Lalanda' };

export default async function ProjetMargePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  // ADR-0051 — H16 : frais refacturables, branchés sur la route du lot H14.
  return (
    <div className="flex flex-col gap-5">
      <CarteMarge projectId={id} />
      <FraisRefacturables projectId={id} />
    </div>
  );
}
