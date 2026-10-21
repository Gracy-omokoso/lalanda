'use client';

// En-tête et onglets de l'espace organisation (S21a, refondu par ADR-0030).
//
// La racine `/organisation` est le PILOTAGE (module GROW dans la navigation
// latérale) : son en-tête le dit. Les autres onglets sont des réglages de
// l'organisation. La mise en route a son propre en-tête et pas d'onglets : un
// parcours guidé ne propose pas de sortir par six portes à la fois.

import { PageHeader } from '@lalanda/ui';
import { usePathname } from 'next/navigation';

import { OrganizationTabs } from './organization-tabs';
import { segmentActif } from './organization-model';

export function OrganizationChrome({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const segment = segmentActif(usePathname());
  if (segment === 'mise-en-route') return <>{children}</>;
  const pilotage = segment === '';
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        module={pilotage ? 'grow' : undefined}
        moduleLabel={pilotage ? 'Croître' : undefined}
        title={pilotage ? 'Pilotage' : 'Organisation'}
        description={
          pilotage
            ? 'Ce qui demande votre attention : validations, ratios, écarts et saisies du réalisé. Ce que vous voyez dépend de votre rôle.'
            : 'Les paramètres de votre organisation, ses membres, son abonnement et le journal de ce qui s’y passe. Ce que vous voyez dépend de votre rôle.'
        }
      />
      <OrganizationTabs />
      {children}
    </section>
  );
}
