// `/achats/factures` — factures fournisseurs (ADR-0044 § 3.5, § 8) ; lecture
// `purchase.read`, saisie `purchase.manage`. `?nouvelle=1` ouvre la saisie libre
// (`&fournisseur=<id>` la préremplit), `?commande=<id>` la saisie depuis une
// commande, `?filtre=ecart|en-retard|…` choisit le filtre.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FacturesListe } from '../_components/factures-liste';

export const metadata: Metadata = { title: 'Factures fournisseurs — Achats · Lalanda' };

export default function FacturesPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <FacturesListe />
    </Suspense>
  );
}
