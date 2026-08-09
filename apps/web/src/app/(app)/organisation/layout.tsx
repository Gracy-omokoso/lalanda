import { OrganizationTabs } from './_components/organization-tabs';

/**
 * Chrome commun de l'espace organisation (S21a) : titre + onglets. Les pages
 * filles ne rendent que leur contenu.
 *
 * Contrairement à `/compte`, cet espace EXIGE une organisation active : toutes
 * ses routes API sont scopées par `organizationId`. Un utilisateur sans
 * organisation reçoit `403 NO_ORGANIZATION`, que les pages traitent comme un
 * état — « créez une organisation ou acceptez une invitation » — et non comme
 * une panne.
 */
export default function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Organisation</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Le pilotage de votre organisation, ses paramètres, son abonnement et le journal de ce qui
          s’y passe. Ce que vous voyez dépend de votre rôle.
        </p>
      </header>
      <OrganizationTabs />
      {children}
    </section>
  );
}
