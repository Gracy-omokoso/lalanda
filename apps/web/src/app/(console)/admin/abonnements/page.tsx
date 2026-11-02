// `/admin/abonnements` — module « Abonnements et paiements » de la console (ADR-0053 § 6.2,
// lot P3) : file des paiements manuels, octrois sans paiement, tableau des abonnements.

import type { Metadata } from 'next';

import { AbonnementsPanel } from '../_components/abonnements-panel';
import { EnTeteModule } from '../_components/en-tete-module';

export const metadata: Metadata = { title: 'Abonnements et paiements — Console Lalanda' };

export default function Page(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="abonnements" />
      <AbonnementsPanel />
    </section>
  );
}
