'use client';

// En-tête de l'application Achats. Les écrans refaits (ADR-0071) portent le leur,
// compact, avec leur action principale : l'en-tête d'espace n'y est pas répété.
// Les autres écrans gardent l'en-tête d'origine jusqu'à leur migration.

import { PageHeader } from '@lalanda/ui';
import { usePathname } from 'next/navigation';

/** Écrans des achats qui ont leur propre en-tête (ADR-0071). */
export const ECRANS_A_EN_TETE_PROPRE: readonly string[] = [
  '/achats/factures',
  '/achats/a-payer',
  '/achats/commandes',
];

export function AchatsHeader(): React.ReactElement | null {
  const pathname = usePathname();
  if (ECRANS_A_EN_TETE_PROPRE.includes(pathname)) return null;
  return (
    <PageHeader
      module="run"
      moduleLabel="Exploiter"
      title="Achats"
      description="Vos fournisseurs, vos demandes d’achat et leurs approbations, vos bons de commande, réceptions, factures fournisseurs et paiements. Les montants sont ceux calculés par Lalanda ; ce que vous pouvez faire dépend de vos droits."
    />
  );
}
