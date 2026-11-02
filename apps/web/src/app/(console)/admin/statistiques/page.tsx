// `/admin/statistiques` — module « Statistiques » de la console (ADR-0053 § 6.7, lot P7) :
// agrégats de la plateforme, aucune case de moins de cinq organisations en clair.

import type { Metadata } from 'next';

import { EnTeteModule } from '../_components/en-tete-module';
import { StatistiquesPanel } from '../_components/statistiques-panel';

export const metadata: Metadata = { title: 'Statistiques — Console Lalanda' };

export default function Page(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="statistiques" />
      <StatistiquesPanel />
    </section>
  );
}
