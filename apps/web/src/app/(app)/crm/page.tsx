// `/crm` — pipeline du CRM minimal (ADR-0035) : lecture `crm.read`,
// écriture `crm.manage`.

import type { Metadata } from 'next';

import { CrmBoard } from './_components/crm-board';

export const metadata: Metadata = { title: 'Pipeline — CRM · Lalanda' };

export default function CrmPage(): React.ReactElement {
  return <CrmBoard />;
}
