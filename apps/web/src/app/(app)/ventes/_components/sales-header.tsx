'use client';

// En-tête de l'espace Ventes. L'écran Factures porte le sien, compact, avec ses
// actions (maquette validée, ADR-0056) : l'en-tête d'espace n'y est pas répété.
// Les autres écrans de l'espace gardent l'en-tête d'origine jusqu'à leur migration.

import { PageHeader } from '@lalanda/ui';
import { usePathname } from 'next/navigation';

/** Écrans de l'espace qui ont leur propre en-tête (ADR-0056, ADR-0067). */
export const ECRANS_A_EN_TETE_PROPRE: readonly string[] = [
  '/ventes/factures',
  '/ventes/devis',
  '/ventes/encaissements',
];

export function SalesHeader(): React.ReactElement | null {
  const pathname = usePathname();
  if (ECRANS_A_EN_TETE_PROPRE.includes(pathname)) return null;
  return (
    <PageHeader
      module="run"
      moduleLabel="Exploiter"
      title="Ventes"
      description="Vos factures, pro forma et avoirs, vos clients et votre catalogue d’articles, prêts pour la facture normalisée de la DGI. Ce que vous pouvez modifier dépend de votre rôle."
    />
  );
}
