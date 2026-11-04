import type { Metadata } from 'next';

import { VueApercu } from '../../_components/vue-apercu';

export const metadata: Metadata = { title: 'Projet — aperçu — Lalanda' };

export default function ProjetApercuPage(): React.ReactElement {
  return <VueApercu />;
}
