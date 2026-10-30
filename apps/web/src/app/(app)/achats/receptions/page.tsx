// `/achats/receptions` — réceptions (ADR-0044 § 3.4, § 8) ; lecture `purchase.read`,
// enregistrement `purchase.manage`. `?nouvelle=1` ouvre le choix de la commande,
// `?commande=<id>` limite la liste à une commande.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReceptionsListe } from '../_components/receptions-liste';

export const metadata: Metadata = { title: 'Réceptions — Achats · Lalanda' };

export default function ReceptionsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <ReceptionsListe />
    </Suspense>
  );
}
