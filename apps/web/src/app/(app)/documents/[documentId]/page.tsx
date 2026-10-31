// `/documents/[documentId]` — fiche d'un document : versions, liens, échéance.

import type { Metadata } from 'next';

import { DocumentFiche } from '../_components/document-fiche';

export const metadata: Metadata = { title: 'Document — Lalanda' };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}): Promise<React.ReactElement> {
  const { documentId } = await params;
  return <DocumentFiche documentId={documentId} />;
}
