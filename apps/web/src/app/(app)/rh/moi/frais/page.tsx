// `/rh/moi/frais` — Mes frais (ADR-0051 § 10, lot H16) : mes notes de frais, mes
// avances, nouvelle note avec la photo du ticket. `expenses.claim`.

import type { Metadata } from 'next';

import { MesFrais } from '../../_components/mes-frais';

export const metadata: Metadata = { title: 'Mes frais — Ressources humaines · Lalanda' };

export default function MesFraisPage(): React.ReactElement {
  return <MesFrais />;
}
