// `/admin/modeles` — module « Modèles sectoriels » de la console (ADR-0053 § 6), pas encore livré.

import type { Metadata } from 'next';

import { BientotDisponible } from '../_components/bientot-disponible';

export const metadata: Metadata = { title: 'Modèles sectoriels — Console Lalanda' };

export default function Page(): React.ReactElement {
  return <BientotDisponible moduleId="modeles" />;
}
