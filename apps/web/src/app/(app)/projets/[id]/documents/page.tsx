// `/projets/[id]/documents` — onglet « Documents » d'un projet (ADR-0046 § 6.4,
// § 6.8 ; lot S9) : documents de la bibliothèque et pièces des tâches liés au
// projet (présentation O5), équipements affectés au projet (`assets.read`).
// L'onglet s'affiche avec `docs.read` ; chaque panneau vérifie sa propre lecture.

import type { Metadata } from 'next';

import { EntityAssetsPanel } from '@/components/entity-assets-panel';
import { EntityDocumentsPanel } from '@/components/entity-documents-panel';

export const metadata: Metadata = { title: 'Projet — Documents — Lalanda' };

export default async function ProjetDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <EntityDocumentsPanel entityType="work_project" entityId={id} libelle="ce projet" />
      <EntityAssetsPanel
        filtre={{ workProjectId: id }}
        titre="Équipements affectés"
        vide="Aucun équipement affecté à ce projet."
      />
    </div>
  );
}
