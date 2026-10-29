import type { Metadata } from 'next';

import { ReglagesProjet } from '../../_components/reglages-projet';

export const metadata: Metadata = { title: 'Projet — réglages — Lalanda' };

export default function ProjetReglagesPage(): React.ReactElement {
  return <ReglagesProjet />;
}
