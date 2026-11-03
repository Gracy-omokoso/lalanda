import { SalesChrome } from './_components/sales-access';
import { SalesHeader } from './_components/sales-header';

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
 *
 * ADR-0056 : l'écran Factures porte son propre en-tête compact (`SalesHeader`).
 */
export default function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <SalesHeader />
      <SalesChrome>{children}</SalesChrome>
    </section>
  );
}
