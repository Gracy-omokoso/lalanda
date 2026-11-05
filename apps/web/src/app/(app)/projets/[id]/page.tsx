'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { ongletDEntree } from '../_components/onglets-projet';
import { useProjet } from '../_components/project-context';
import { hrefProjet } from '../_components/projets-model';

/**
 * `/projets/<id>` → onglet d'entrée, requête conservée. ADR-0061 § 3 : la vue par
 * défaut des réglages de l'organisation (Aperçu, Liste ou Tableau ; Aperçu à défaut,
 * ADR-0057). Le lien d'une notification (`/projets/<id>?tache=<id>`, ADR-0039 § 2.11)
 * mène à la Liste, panneau de la tâche ouvert. Les réglages viennent du contexte du
 * projet (déjà chargés par la mise en page) ; s'ils sont illisibles, l'Aperçu.
 */
export default function ProjetIndex(): null {
  const { id } = useParams<{ id: string }>();
  const recherche = useSearchParams();
  const router = useRouter();
  const { settings, erreur, chargement } = useProjet();

  useEffect(() => {
    if (settings === null && chargement && !erreur) return;
    const requete = Object.fromEntries(recherche.entries());
    const q = recherche.toString();
    router.replace(
      `${hrefProjet(id, ongletDEntree(requete, settings?.defaultView ?? null))}${q ? `?${q}` : ''}`,
    );
  }, [id, recherche, router, settings, erreur, chargement]);

  return null;
}
