// `/ventes/crm/[opportunityId]` — fiche d'une opportunité (ADR-0035).

import type { Metadata } from 'next';

import { OpportunityDetail } from '../_components/opportunity-detail';

export const metadata: Metadata = { title: 'Opportunité — CRM · Lalanda' };

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}): Promise<React.ReactElement> {
  const { opportunityId } = await params;
  return <OpportunityDetail opportunityId={opportunityId} />;
}
