// `/admin/abonnements` — module « Abonnements et paiements » de la console (ADR-0053 § 6), pas encore livré.

import type { Metadata } from 'next';

import { BientotDisponible } from '../_components/bientot-disponible';

export const metadata: Metadata = { title: 'Abonnements et paiements — Console Lalanda' };

export default function Page(): React.ReactElement {
  return <BientotDisponible moduleId="abonnements" />;
}
