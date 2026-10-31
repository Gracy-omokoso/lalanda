import { PageHeader } from '@lalanda/ui';

import { StocksChrome } from './_components/stocks-access';

/**
 * Application Stocks (module RUN) — ADR-0046 § 2 et § 5.1, lot S8.
 *
 * Pas de rangée d'onglets (ADR-0038 § 3) : vue d'ensemble, articles, niveaux,
 * mouvements, bons, « À traiter », inventaires, réapprovisionnement,
 * emplacements et réglages sont dans la colonne de gauche. Frontière d'accès
 * `stock.read` commune à tous les écrans.
 */
export default function StocksLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Stocks"
        description="Ce qu’il y a dans vos magasins, où, ce qui entre, ce qui sort et ce qu’il faut racheter. Quantités, coûts moyens et valeurs sont calculés par Lalanda ; les valeurs ne s’affichent qu’aux rôles qui voient les prix d’achat ou la trésorerie."
      />
      <StocksChrome>{children}</StocksChrome>
    </section>
  );
}
