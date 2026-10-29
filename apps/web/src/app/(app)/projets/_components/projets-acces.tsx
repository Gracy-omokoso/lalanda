'use client';

// Frontière d'accès de l'espace Projets (ADR-0039 § 7) : un rôle sans
// `work.read` (Chef de projet, Conseiller externe) lit un refus explicite plutôt
// qu'une page vide ou une pluie de 403. Confort seulement : l'API refuse de
// toute façon (`PermissionsGuard`).

import { EmptyState } from '@lalanda/ui';

import { useShell } from '../../_components/shell-context';

import { peutLire } from './projets-model';

export function ProjetsAcces({ children }: { children: React.ReactNode }): React.ReactElement {
  const { actions, chargees } = useShell();
  if (chargees && actions !== null && !peutLire(actions)) {
    return (
      <EmptyState
        title="Les projets ne sont pas ouverts à votre rôle"
        description="Votre rôle dans cette organisation ne permet pas de consulter les projets et les tâches. Un Propriétaire ou un Administrateur peut revoir votre rôle."
      />
    );
  }
  return <>{children}</>;
}
