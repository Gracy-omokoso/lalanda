'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { signOut, useSession } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';
import { OrgSwitcher } from './org-switcher';

export function AppHeader(): React.ReactElement {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.push('/login');
    router.refresh();
  }

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
        <ThemeToggle />
        {isPending ? (
          <span className="opacity-50">…</span>
        ) : session?.user ? (
          <>
            <span className="hidden text-[var(--foreground-muted)] sm:inline">
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm transition hover:bg-[var(--surface-muted)]"
            >
              Déconnexion
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
