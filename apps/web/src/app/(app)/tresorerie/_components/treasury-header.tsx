'use client';

// En-tête de l'espace Trésorerie. Les écrans refaits (ADR-0071) portent le leur,
// compact, avec leur action principale : l'en-tête d'espace n'y est pas répété.

import { PageHeader } from '@lalanda/ui';
import { usePathname } from 'next/navigation';

/** Écrans de la trésorerie qui ont leur propre en-tête (ADR-0071). */
export const ECRANS_A_EN_TETE_PROPRE: readonly string[] = [
  '/tresorerie/depenses',
  '/tresorerie/comptes',
];

export function TreasuryHeader(): React.ReactElement | null {
  const pathname = usePathname();
  if (ECRANS_A_EN_TETE_PROPRE.includes(pathname)) return null;
  return (
    <PageHeader
      module="run"
      moduleLabel="Exploiter"
      title="Trésorerie"
      description="Vos dépenses, vos comptes (caisse, banque, mobile money), ce qu’il vous restera dans 7, 30, 90 et 180 jours, et l’écart entre ce que vous dépensez et ce que prévoyait votre plan."
    />
  );
}
