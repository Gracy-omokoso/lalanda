// `/rh/objectifs` — objectifs individuels, éteints par défaut (§ 2.5). ADR-0051 § 10, lot H16.

import type { Metadata } from 'next';

import { Objectifs } from '../_components/objectifs';

export const metadata: Metadata = { title: 'Objectifs — Ressources humaines · Lalanda' };

export default function ObjectifsPage(): React.ReactElement {
  return <Objectifs />;
}
