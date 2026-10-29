import type { Metadata } from 'next';

import { ListeProjets } from './_components/liste-projets';

export const metadata: Metadata = { title: 'Projets — Lalanda' };

export default function ProjetsPage(): React.ReactElement {
  return <ListeProjets />;
}
