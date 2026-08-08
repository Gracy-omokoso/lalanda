import { AccountTabs } from './_components/account-tabs';

/**
 * Chrome commun de l'espace compte (S20b) : titre + onglets Profil / Sécurité /
 * Préférences. Les pages filles ne rendent que leur contenu.
 *
 * Cet espace est le SEUL accessible sans organisation (ADR-0012/0013) : il ne
 * charge donc rien qui dépende d'une organisation active — ni membres, ni
 * projets, ni abonnement.
 */
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Mon compte</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Vos informations personnelles, la sécurité de votre accès et vos préférences
          d’affichage.
        </p>
      </header>
      <AccountTabs />
      {children}
    </section>
  );
}
