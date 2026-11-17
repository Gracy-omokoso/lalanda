import type { Metadata } from 'next';

import { ComptesExternes } from '../_components/comptes-externes';

export const metadata: Metadata = { title: 'Projets — membres externes — Lalanda' };

/** ADR-0078 : comptes externes (contacts clients, consultants), taux d'achat, conversion d'invités. */
export default function ComptesExternesPage(): React.ReactElement {
  return <ComptesExternes />;
}
