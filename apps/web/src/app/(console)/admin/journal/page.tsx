// `/admin/journal` — journal d'audit de la plateforme (S21b).
//
// Portée PLATEFORME uniquement : aucun événement d'une organisation cliente n'y
// figure. Un opérateur qui veut savoir ce qui se passe chez un client n'a pas
// d'écran pour cela, et c'est le but.

import type { Metadata } from 'next';

import { EnTeteModule } from '../_components/en-tete-module';
import { PlatformAuditPanel } from '../_components/platform-audit-panel';

export const metadata: Metadata = { title: 'Journal — Console Lalanda' };

export default function AdminAuditPage(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="journal" />
      <PlatformAuditPanel />
    </section>
  );
}
