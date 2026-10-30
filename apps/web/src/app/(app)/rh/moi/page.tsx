// `/rh/moi` — Mon espace (ADR-0045 § 8) : ma fiche, mes soldes, demander une
// absence, mes demandes ; `GET /hr/me` (`analytics.read`, portée « soi »).

import type { Metadata } from 'next';

import { MonEspace } from '../_components/mon-espace';

export const metadata: Metadata = { title: 'Mon espace — Ressources humaines · Lalanda' };

export default function MonEspacePage(): React.ReactElement {
  return <MonEspace />;
}
