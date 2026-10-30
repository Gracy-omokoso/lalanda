import type { Metadata } from 'next';

import { FeuilleTemps } from '../../_components/feuille-temps';

export const metadata: Metadata = { title: 'Mes tâches — feuille de temps — Lalanda' };

export default function FeuilleTempsPage(): React.ReactElement {
  return <FeuilleTemps />;
}
