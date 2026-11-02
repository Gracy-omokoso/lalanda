// `/admin/fonctionnalites` — module « Fonctionnalités par offre » de la console
// (ADR-0053 § 6.3 — lot P4) : grille en lecture seule et dérogations par organisation.

import type { Metadata } from 'next';

import { EnTeteModule } from '../_components/en-tete-module';
import { FeaturesPanel } from '../_components/features-panel';

export const metadata: Metadata = { title: 'Fonctionnalités par offre — Console Lalanda' };

export default function Page(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="fonctionnalites" />
      <FeaturesPanel />
    </section>
  );
}
