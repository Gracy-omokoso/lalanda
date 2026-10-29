import type { Metadata } from 'next';

import { VueListe } from '../../_components/vue-liste';

export const metadata: Metadata = { title: 'Projet — liste — Lalanda' };

export default function ProjetListePage(): React.ReactElement {
  return <VueListe />;
}
