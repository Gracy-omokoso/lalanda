// `/admin/integrations` — secrets chiffrés des cinq fournisseurs (S21b — ADR-0013).
//
// Réservée à `platform_super_admin` côté API : c'est le seul rôle plateforme qui
// touche aux intégrations, et le seul écran de l'application où une valeur de
// secret est saisie. Elle n'en affiche aucune — le contrat est en écriture
// seule, et aucun endpoint ne pourrait en rendre une même si cette page le
// demandait.

import type { Metadata } from 'next';

import { EnTeteModule } from '../_components/en-tete-module';
import { IntegrationsPanel } from '../_components/integrations-panel';

export const metadata: Metadata = { title: 'Intégrations — Console Lalanda' };

export default function AdminIntegrationsPage(): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId="integrations" />
      <IntegrationsPanel />
    </section>
  );
}
