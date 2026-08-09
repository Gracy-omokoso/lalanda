// `/organisation/journal` — journal d'audit en lecture seule (S21a).
// Réservé à `audit.read` : Propriétaire, Administrateur, Directeur financier.

import type { Metadata } from 'next';

import { AuditPanel } from '../_components/audit-panel';

export const metadata: Metadata = { title: 'Journal — Organisation · Lalanda' };

export default function OrganizationAuditPage(): React.ReactElement {
  return <AuditPanel />;
}
