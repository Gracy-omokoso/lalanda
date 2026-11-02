// `/admin` — tableau de bord de la console Lalanda (S21b ; ADR-0053 — P1).
//
// Point de montage : la coquille (bandeau, navigation, porte d'entrée) vit dans
// `layout.tsx` ; les cartes des modules ouverts et les volumes de la plateforme
// dans `_components/`.

import type { Metadata } from 'next';

import { CartesModules } from './_components/cartes-modules';
import { EnTeteModule } from './_components/en-tete-module';
import { OverviewPanel } from './_components/overview-panel';

export const metadata: Metadata = { title: 'Tableau de bord — Console Lalanda' };

export default function AdminOverviewPage(): React.ReactElement {
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <EnTeteModule moduleId="tableau-de-bord" />
        <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">
          L’exploitation de la plateforme : organisations clientes, comptes, intégrations chiffrées
          et journal des gestes plateforme. Aucun acte métier d’un client — validation de plan,
          clôture de période, export — n’est possible depuis ici.
        </p>
      </div>
      <CartesModules />
      <OverviewPanel />
    </section>
  );
}
