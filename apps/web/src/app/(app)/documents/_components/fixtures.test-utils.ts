// Données de test de la bibliothèque (ADR-0046, lot S9).

import type { DocumentFolderView } from '@/lib/api-documents';

export function dossier(patch: Partial<DocumentFolderView> & { id: string }): DocumentFolderView {
  return {
    name: patch.id,
    parentId: null,
    depth: 1,
    access: { read: 'all', write: 'managers', inherit: true },
    status: 'active',
    canWrite: false,
    revision: 1,
    createdAt: '',
    updatedAt: '',
    ...patch,
  };
}
