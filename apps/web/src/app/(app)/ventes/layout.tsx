import { PageHeader } from '@lalanda/ui';

import { SalesChrome } from './_components/sales-access';

/**
 * Espace Ventes (module RUN) : factures, pro forma et avoirs (S25e — ADR-0023),
 * puis clients et catalogue, les données maîtres (S25c — ADR-0022).
 *
 * Comme `/organisation`, l'espace EXIGE une organisation active : toutes ses
 * routes d'API sont scopées par l'organisation du cookie. Les onglets sont
 * filtrés par `GET /me/permissions` (`sales.read`) ; un rôle qui ne l'a pas lit
 * un refus explicite.
 *
 * ADR-0030 : sur téléphone, la description de l'espace n'est pas affichée (elle
 * reste lue par les lecteurs d'écran) — le premier client ou la première facture
 * se voit sans défiler.
 */
export default function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Ventes"
        description="Vos factures, pro forma et avoirs, vos clients et votre catalogue d’articles, prêts pour la facture normalisée de la DGI. Ce que vous pouvez modifier dépend de votre rôle."
      />
      <SalesChrome>{children}</SalesChrome>
    </section>
  );
}
