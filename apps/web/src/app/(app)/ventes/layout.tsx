import { SalesChrome } from './_components/sales-access';

/**
 * Espace Ventes : factures, pro forma et avoirs (S25e — ADR-0023), puis
 * clients et catalogue, les données maîtres (S25c — ADR-0022).
 *
 * Comme `/organisation`, l'espace EXIGE une organisation active : toutes ses
 * routes d'API sont scopées par l'organisation du cookie. Les onglets sont
 * filtrés par `GET /me/permissions` (`sales.read`) ; un rôle qui ne l'a pas lit
 * un refus explicite.
 */
export default function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Ventes</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Vos factures, pro forma et avoirs, vos clients et votre catalogue d’articles, prêts pour
          la facture normalisée de la DGI. Ce que vous pouvez modifier dépend de votre rôle.
        </p>
      </header>
      <SalesChrome>{children}</SalesChrome>
    </section>
  );
}
