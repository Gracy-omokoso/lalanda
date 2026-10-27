// `/projects/:id/business-plan` — business plan narratif du projet (ADR-0037).

import type { Metadata } from 'next';

import { BusinessPlanEditor } from '../_components/business-plan-editor';

export const metadata: Metadata = { title: 'Business plan — Lalanda' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectBusinessPlanPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  return <BusinessPlanEditor projectId={id} />;
}
