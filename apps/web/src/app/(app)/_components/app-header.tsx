'use client';

import Link from 'next/link';

import { useSession } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

export function AppHeader(): React.ReactElement {
  const { data: session, isPending } = useSession();

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
      <Link href="/projects" className="group flex items-center gap-3">
        <span
          aria-hidden="true"
          className="font-display inline-flex h-8 w-8 items-center justify-center rounded-md border-2 border-[var(--accent)] text-sm font-black text-[var(--accent)]"
        >
          L
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-bold tracking-tight group-hover:text-[var(--accent)]">
            Lalanda
          </span>
          <span className="font-mono text-[0.6rem] tracking-[0.14em] text-[var(--foreground-muted)]">
            PLAN FINANCIER BANCABLE
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-3 text-sm">
        {session?.user ? (
          <>
            {/* Les deux entrées sont offertes à TOUT membre : l'espace
                organisation sert un tableau de bord même à un Lecteur, et la
                page Membres explique elle-même ce que le rôle permet (S20a).
                Masquer un lien selon le rôle recopierait la matrice dans le
                header (ADR-0012 §8) — et se tromperait au premier changement. */}
            <Link
              href="/organisation"
              className="hidden text-[var(--foreground-muted)] transition hover:text-[var(--foreground)] sm:inline"
            >
              Organisation
            </Link>
            <Link
              href="/members"
              className="hidden text-[var(--foreground-muted)] transition hover:text-[var(--foreground)] sm:inline"
            >
              Membres
            </Link>
            {/* S22b — le tunnel de souscription est une route autonome, donc il
                lui faut une entrée. Offerte à tout membre pour la même raison
                que les deux précédentes : la page dit elle-même que la gestion
                de l'abonnement revient au Propriétaire, et un rôle qui subit
                une limite de plan a besoin de comprendre pourquoi. */}
            <Link
              href="/souscription"
              className="hidden text-[var(--foreground-muted)] transition hover:text-[var(--foreground)] sm:inline"
            >
              Abonnement
            </Link>
            <OrgSwitcher />
          </>
        ) : null}
        {/* `persist` : dans l'espace applicatif, le thème choisi ici est aussi
            enregistré sur le compte, pour rester cohérent avec /compte/preferences. */}
        <ThemeToggle persist />
        {isPending ? (
          <span className="opacity-50">…</span>
        ) : session?.user ? (
          // L'adresse email devient le point d'entrée de l'espace compte (S20b) :
          // Profil / Sécurité / Préférences / Déconnexion. La déconnexion n'est
          // plus un bouton isolé — elle vit avec le reste des réglages du compte.
          <UserMenu email={session.user.email} />
        ) : null}
      </div>
    </header>
  );
}
