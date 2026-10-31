// `/achats/commandes` — demandes d'achat et bons de commande (ADR-0044 § 3.2, § 8) ;
// lecture `purchase.read`, création `purchase.request`. `?nouvelle=1` ouvre la
// fenêtre de création (`&fournisseur=<id>` la préremplit ; ADR-0046 — S8 :
// `&articles=<id>:<quantité>,…` préremplit des lignes d’articles de stock).

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CommandesListe } from '../_components/commandes-liste';

export const metadata: Metadata = { title: 'Demandes et commandes — Achats · Lalanda' };

export default function CommandesPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <CommandesListe />
    </Suspense>
  );
}
