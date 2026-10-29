import { redirect } from 'next/navigation';

import { ONGLET_DEFAUT } from '../_components/onglets-projet';
import { hrefProjet } from '../_components/projets-model';

/**
 * `/projets/<id>` → onglet par défaut, requête conservée : le lien d'une
 * notification (`/projets/<id>?tache=<id>`, ADR-0039 § 2.11) ouvre la tâche.
 */
export default async function ProjetIndex({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const { id } = await params;
  const recherche = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === 'string') recherche.set(k, v);
  }
  const q = recherche.toString();
  redirect(`${hrefProjet(id, ONGLET_DEFAUT)}${q ? `?${q}` : ''}`);
}
