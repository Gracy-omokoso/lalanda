// `/documents/echeances` — documents qui expirent (ADR-0046 § 6.6, R18).

import type { Metadata } from 'next';

import { EcheancesDocuments } from '../_components/echeances';

export const metadata: Metadata = { title: 'Échéances — Documents · Lalanda' };

export default function EcheancesPage(): React.ReactElement {
  return <EcheancesDocuments />;
}
