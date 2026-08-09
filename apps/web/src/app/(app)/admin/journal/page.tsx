// `/admin/journal` — journal d'audit de la plateforme (S21b).
//
// Portée PLATEFORME uniquement : aucun événement d'une organisation cliente n'y
// figure. Un opérateur qui veut savoir ce qui se passe chez un client n'a pas
// d'écran pour cela, et c'est le but.

import type { Metadata } from 'next';

import { PlatformAuditPanel } from '../_components/platform-audit-panel';

export const metadata: Metadata = { title: 'Journal — Administration · Lalanda' };

export default function AdminAuditPage(): React.ReactElement {
  return <PlatformAuditPanel />;
}
