// Layout des pages publiques (route group `(marketing)`).
// Direction « dossier bancaire » : header et footer sur panneau encre,
// libellés registre en mono. Les routes de ce group (`/`, `/pricing`) sont
// exemptées du redirect middleware (voir src/middleware.ts).

import Link from 'next/link';

import { BrandLogo } from '@/components/brand-logo';
import { LegalLinks } from '@/components/legal-links';
import { ThemeToggle } from '@/components/theme-toggle';
import { PUBLISHER_NAME } from '@/lib/legal';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-ink border-b border-[var(--ink-border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          {/* `fond="encre"` et non la bascule de thème : ce bandeau est un
              panneau `.bg-ink`, et `--ink` vaut `#005263` dans les DEUX thèmes.
              Y brancher la bascule poserait le lockup à mot-symbole encre sur
              de l'encre en thème clair — illisible. */}
          <Link
            href="/"
            aria-label="Lalanda — accueil"
            className="flex shrink-0 items-center gap-3 transition hover:opacity-80"
          >
            <BrandLogo hauteur={30} fond="encre" />
            <span className="font-mono hidden border-l border-[var(--ink-border)] pl-3 text-[0.65rem] tracking-wide text-[var(--on-ink-muted)] sm:block">
              PLAN FINANCIER BANCABLE
            </span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/pricing"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-[var(--on-ink-muted)] transition hover:text-[var(--on-ink)] sm:inline-flex"
            >
              Tarifs
            </Link>
            <Link
              href="/aide"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-[var(--on-ink-muted)] transition hover:text-[var(--on-ink)] sm:inline-flex"
            >
              Aide
            </Link>
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-[var(--on-ink-muted)] transition hover:text-[var(--on-ink)]"
            >
              Se connecter
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-[var(--stamp)] px-3 py-2 text-sm font-semibold text-[var(--stamp-foreground)] transition hover:brightness-110 sm:px-4"
            >
              Créer un compte
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-ink border-t border-[var(--ink-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 text-sm text-[var(--on-ink-muted)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Pied de page également sur encre, donc `fond="encre"`. Le
                lockup ayant remplacé le carré, la phrase ne réamorce plus par
                « Lalanda » : le mot est déjà là, en pixels, juste à gauche. */}
            <div className="flex items-center gap-3">
              <BrandLogo hauteur={26} fond="encre" />
              <span>Plans financiers bancables pour l&apos;Afrique francophone.</span>
            </div>
            <div className="flex items-center gap-5">
              <Link href="/pricing" className="transition hover:text-[var(--on-ink)]">
                Tarifs
              </Link>
              <Link href="/aide" className="transition hover:text-[var(--on-ink)]">
                Aide
              </Link>
              <Link href="/aide/glossaire" className="transition hover:text-[var(--on-ink)]">
                Glossaire
              </Link>
              <Link href="/login" className="transition hover:text-[var(--on-ink)]">
                Connexion
              </Link>
              <span className="font-mono text-xs">SYSCOHADA · © {year}</span>
            </div>
          </div>

          {/* Les cinq documents légaux, dérivés du registre : une page publiée
              mais absente du pied de page est introuvable, donc difficilement
              opposable — et rien dans le build ne le signalerait (S22c). */}
          <div className="flex flex-col gap-3 border-t border-[var(--ink-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <LegalLinks tone="ink" />
            <span className="text-xs">Édité par {PUBLISHER_NAME}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
