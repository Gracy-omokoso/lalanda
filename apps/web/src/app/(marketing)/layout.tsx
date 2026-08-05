// Layout des pages publiques (route group `(marketing)`).
// Header minimal — logo + "Se connecter" + "Créer un compte" — et footer sobre.
// Les routes de ce group (`/`, `/pricing`) sont exemptées du redirect middleware
// (voir src/middleware.ts) pour permettre à un visiteur non authentifié de
// découvrir le produit avant de s'inscrire.

import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--background)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]"
            >
              L
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-base font-semibold tracking-tight">Lalanda</span>
              <span className="hidden text-xs text-[var(--foreground-muted)] sm:block">
                Plan financier bancable en 30 min
              </span>
            </div>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/pricing"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-[var(--foreground-muted)] transition hover:text-[var(--foreground)] sm:inline-flex"
            >
              Tarifs
            </Link>
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
            >
              Se connecter
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 sm:px-4"
            >
              Créer un compte
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--border)] bg-[var(--surface-muted)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-[var(--foreground-muted)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-xs font-semibold text-[var(--accent-foreground)]"
            >
              L
            </span>
            <span>
              Lalanda — Planification financière bancable pour l&apos;Afrique francophone.
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="transition hover:text-[var(--foreground)]">
              Tarifs
            </Link>
            <Link href="/login" className="transition hover:text-[var(--foreground)]">
              Connexion
            </Link>
            <span>© {year}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
