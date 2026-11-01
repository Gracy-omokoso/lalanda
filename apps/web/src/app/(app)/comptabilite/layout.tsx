import { PageHeader } from '@lalanda/ui';

import { ComptabiliteChrome } from './_components/comptabilite-access';

/**
 * Application Comptabilité (module RUN) — ADR-0049 § 13, lot K8.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3) : vue d'ensemble, écritures, grand livre,
 * balance, clients et fournisseurs, états, clôtures, exports et réglages sont dans la
 * colonne de gauche. Frontière d'accès `accounting.read` commune à tous les écrans ;
 * la coquille pose les bandeaux « Projet » (toujours) et « Simulation » (en simulation).
 */
export default function ComptabiliteLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Comptabilité"
        description="Vos ventes, dépenses et paiements deviennent des écritures, une balance et des projets d’états, à faire relire par votre expert-comptable. Lalanda ne dépose rien."
      />
      <ComptabiliteChrome>{children}</ComptabiliteChrome>
    </section>
  );
}
