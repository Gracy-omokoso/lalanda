import { redirect } from 'next/navigation';

import { ongletDEntree } from '../_components/onglets-projet';
import { hrefProjet } from '../_components/projets-model';

/**
 * `/projets/<id>` → onglet par défaut (Aperçu, ADR-0057), requête conservée.
 * Le lien d'une notification (`/projets/<id>?tache=<id>`, ADR-0039 § 2.11)
 * mène à la Liste, panneau de la tâche ouvert.
 */
export default async function ProjetIndex({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const { id } = await params;
  const requete = await searchParams;
  const recherche = new URLSearchParams();
  for (const [k, v] of Object.entries(requete)) {
    if (typeof v === 'string') recherche.set(k, v);
  }
  const q = recherche.toString();
  redirect(`${hrefProjet(id, ongletDEntree(requete))}${q ? `?${q}` : ''}`);
}
