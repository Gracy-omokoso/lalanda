// `/rh/cartes` — modèles, réglages et génération par lot des cartes de service et
// de visite (ADR-0069).

import type { Metadata } from 'next';

import { CartesRh } from '../_components/cartes-rh';

export const metadata: Metadata = { title: 'Cartes de service et de visite — RH · Lalanda' };

export default function CartesPage(): React.ReactElement {
  return <CartesRh />;
}
