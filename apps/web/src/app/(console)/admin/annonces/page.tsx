// `/admin/annonces` — module « Annonces » de la console (ADR-0053 § 6.6, lot P6) :
// préparer, faire approuver par une seconde personne, envoyer dans l'application.

import type { Metadata } from 'next';

import { AnnoncesPanel } from '../_components/annonces-panel';
import { EnTeteModule } from '../_components/en-tete-module';

export const metadata: Metadata = { title: 'Annonces — Console Lalanda' };

export default function Page(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="annonces" />
      <AnnoncesPanel />
    </section>
  );
}
