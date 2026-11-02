// `/admin/fonctionnalites` — module « Fonctionnalités par offre » de la console (ADR-0053 § 6), pas encore livré.

import type { Metadata } from 'next';

import { BientotDisponible } from '../_components/bientot-disponible';

export const metadata: Metadata = { title: 'Fonctionnalités par offre — Console Lalanda' };

export default function Page(): React.ReactElement {
  return <BientotDisponible moduleId="fonctionnalites" />;
}
