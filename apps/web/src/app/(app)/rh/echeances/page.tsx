// `/rh/echeances` — fins d'essai, fins de contrat, documents et pièces qui expirent
// (ADR-0045 § 3.3, § 6.4 ; cible du brief R15). Lot H7.

import type { Metadata } from 'next';

import { Echeances } from '../_components/echeances';

export const metadata: Metadata = { title: 'Échéances — Ressources humaines · Lalanda' };

export default function EcheancesPage(): React.ReactElement {
  return <Echeances />;
}
