'use client';

// Coquille de l'application (ADR-0030 § 2, § 5, § 6).
//
//   ≥ 1024 px : barre latérale fixe (repliable en rail) + zone de contenu.
//   < 1024 px : barre du haut compacte, tiroir de navigation, et — si le rôle
//               lit les ventes — barre d'actions basse centrée sur RUN.
//
// La coquille ne décide d'aucun accès : elle lit les faits de `ShellProvider`
// (permissions et offre servies par l'API) et range.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppVersion } from '@/components/app-version';
import { IconeNav } from '@/components/icones-navigation';
import { LegalLinks } from '@/components/legal-links';

import { AppHeader } from './app-header';
import { actionsRapides, entreeActive, NAV_ITEMS } from './nav-model';
import { PendingInvitationsBanner } from './pending-invitations-banner';
import { ShellProvider, useShell } from './shell-context';
import { SidebarNav } from './sidebar';

const CLE_REPLI = 'lalanda.navigation.repliee';

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ShellProvider>
      <Coquille>{children}</Coquille>
    </ShellProvider>
  );
}

function Coquille({ children }: { children: React.ReactNode }): React.ReactElement {
  const [replie, setReplie] = useState(false);
  const [tiroir, setTiroir] = useState(false);
  const { actions } = useShell();
  // Réserve la place de la barre basse seulement quand elle existe.
  const avecBarre = actionsRapides(actions).length > 0;
  const boutonTiroir = useRef<HTMLElement | null>(null);

  // Repli mémorisé par appareil — un confort, lu de façon protégée.
  useEffect(() => {
    try {
      setReplie(window.localStorage.getItem(CLE_REPLI) === '1');
    } catch {
      /* stockage bloqué : barre dépliée */
    }
  }, []);

  function basculerRepli(): void {
    setReplie((v) => {
      try {
        if (v) window.localStorage.removeItem(CLE_REPLI);
        else window.localStorage.setItem(CLE_REPLI, '1');
      } catch {
        /* sans conséquence */
      }
      return !v;
    });
  }

  const ouvrirTiroir = useCallback(() => {
    boutonTiroir.current = document.activeElement as HTMLElement | null;
    setTiroir(true);
  }, []);

  const fermerTiroir = useCallback(() => {
    setTiroir(false);
    // Rend le focus au bouton qui a ouvert le tiroir (docs/04 § Clavier).
    boutonTiroir.current?.focus();
  }, []);

  return (
    <div
      className={`min-h-screen lg:grid ${replie ? 'lg:grid-cols-[var(--sidebar-rail)_minmax(0,1fr)]' : 'lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]'}`}
    >
      <a
        href="#contenu"
        className="sr-only z-50 rounded-[var(--radius-md)] bg-[var(--surface)] px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Aller au contenu
      </a>

      <aside className="nav-panel sticky top-0 hidden h-screen flex-col border-r border-[var(--nav-border)] bg-[var(--nav-bg)] text-[var(--nav-fg)] lg:flex">
        <div className="min-h-0 flex-1">
          <SidebarNav replie={replie} />
        </div>
        <div
          className={`border-t border-[var(--nav-border)] p-2 ${replie ? 'flex justify-center' : ''}`}
        >
          <button
            type="button"
            onClick={basculerRepli}
            aria-expanded={!replie}
            aria-label={replie ? 'Déplier la navigation' : 'Replier la navigation'}
            title={replie ? 'Déplier la navigation' : 'Replier la navigation'}
            className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--nav-muted)] transition hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
          >
            <IconeNav id="replier" className="h-4 w-4" />
            {replie ? null : <span>Replier</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <AppHeader onOuvrirNavigation={ouvrirTiroir} />
        <main
          id="contenu"
          tabIndex={-1}
          className={`mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 ${avecBarre ? 'pb-28' : 'pb-10'} outline-none sm:px-6 lg:px-8 lg:pb-10 lg:pt-8`}
        >
          <PendingInvitationsBanner />
          <div className="flex-1">{children}</div>
        </main>

        {/* Pied de page légal (S22c) et version du logiciel, visible de tout
            écran (ADR-0026 § 6.2). Les pages légales ne sont PAS « marketing » :
            un membre connecté qui clique ici lit le document. */}
        <footer
          className={`mx-auto flex ${avecBarre ? 'mb-24' : ''} w-full max-w-6xl flex-col gap-3 border-t border-[var(--border)] px-4 py-5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:mb-0 lg:px-8`}
        >
          <LegalLinks />
          <AppVersion className="text-xs text-[var(--foreground-muted)]" />
        </footer>
      </div>

      {tiroir ? <Tiroir onFermer={fermerTiroir} /> : null}
      <BarreBasse onMenu={ouvrirTiroir} />
    </div>
  );
}

/**
 * Tiroir de navigation (< 1024 px) : dialogue modal, focus piégé, `Échap`
 * ferme et rend le focus, défilement de la page bloqué (ADR-0030 § 5).
 */
function Tiroir({ onFermer }: { onFermer: () => void }): React.ReactElement {
  const panneau = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const cheminInitial = useRef(pathname);

  // Une navigation ferme le tiroir (le lien cliqué a déjà mené ailleurs).
  useEffect(() => {
    if (pathname !== cheminInitial.current) onFermer();
  }, [pathname, onFermer]);

  useEffect(() => {
    const precedent = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = (): HTMLElement[] =>
      Array.from(
        panneau.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFermer();
        return;
      }
      if (e.key !== 'Tab') return;
      const liste = focusables();
      if (liste.length === 0) return;
      const premier = liste[0]!;
      const dernier = liste[liste.length - 1]!;
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = precedent;
      document.removeEventListener('keydown', onKey);
    };
  }, [onFermer]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onFermer} />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="nav-panel absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-[var(--nav-bg)] text-[var(--nav-fg)] shadow-[var(--shadow-pop)] motion-safe:animate-[tiroir_180ms_ease-out]"
      >
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer la navigation"
          className="absolute right-2 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--nav-muted)] transition hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
        >
          <IconeNav id="fermer" className="h-5 w-5" />
        </button>
        <SidebarNav onNavigate={onFermer} />
      </div>
    </div>
  );
}

/**
 * Barre d'actions basse du téléphone (ADR-0030 § 6) : vendre et facturer au
 * pouce. Rendue seulement si le rôle lit les ventes (`actionsRapides`).
 */
function BarreBasse({ onMenu }: { onMenu: () => void }): React.ReactElement | null {
  const { actions } = useShell();
  const pathname = usePathname();
  const liste = actionsRapides(actions);
  if (liste.length === 0) return null;
  const active = entreeActive(pathname, NAV_ITEMS);

  return (
    <nav
      aria-label="Actions rapides"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.18)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {liste.map((a) => {
          const courant = !a.principale && active === a.id;
          return (
            <li key={a.id} className="flex flex-1 justify-center">
              {a.principale ? (
                <Link
                  href={a.href}
                  className="-mt-4 flex flex-col items-center gap-1 px-1 pb-2 text-[0.7rem] font-semibold text-[var(--accent)]"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-pop)]">
                    <IconeNav id="plus" className="h-6 w-6" />
                  </span>
                  {a.label}
                </Link>
              ) : (
                <Link
                  href={a.href}
                  aria-current={courant ? 'page' : undefined}
                  className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-medium ${courant ? 'text-[var(--accent)]' : 'text-[var(--foreground-muted)]'}`}
                >
                  <IconeNav id={a.id as Exclude<typeof a.id, 'facturer'>} className="h-5 w-5" />
                  {a.label}
                </Link>
              )}
            </li>
          );
        })}
        <li className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={onMenu}
            aria-haspopup="dialog"
            className="flex min-h-14 w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-medium text-[var(--foreground-muted)]"
          >
            <IconeNav id="menu" className="h-5 w-5" />
            Menu
          </button>
        </li>
      </ul>
    </nav>
  );
}
