// `/admin/finances` — module « Finances du site » de la console (ADR-0053 § 6.8, lot P7) :
// encaissements constatés et revenu récurrent déclaré, par devise, calculés par le moteur.

import type { Metadata } from 'next';

import { EnTeteModule } from '../_components/en-tete-module';
import { FinancesPanel } from '../_components/finances-panel';

export const metadata: Metadata = { title: 'Finances du site — Console Lalanda' };

export default function Page(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="finances" />
      <FinancesPanel />
    </section>
  );
}
