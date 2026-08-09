'use client';

import Link from 'next/link';

import { useSession } from '@/lib/auth-client';
import { LIENS_AIDE } from '@/lib/aide/liens';
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
            <Link
              href="/members"
              className="hidden text-[var(--foreground-muted)] transition hover:text-[var(--foreground)] sm:inline"
            >
              Membres
            </Link>
            <OrgSwitcher />
          </>
        ) : null}
        {/* Le centre d'aide est la seule entrée permanente vers le glossaire et
            l'explication des ratios. Hors session aussi : /aide est public, et
            une page d'aide atteignable depuis n'importe où vaut mieux qu'un lien
            qui n'apparaît qu'une fois connecté. */}
        <Link
          href={LIENS_AIDE.centre}
          className="text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
        >
          Aide
        </Link>
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
