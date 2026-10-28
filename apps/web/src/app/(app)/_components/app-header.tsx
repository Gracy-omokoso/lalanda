'use client';

// Barre du haut — niveau 1 de la navigation (ADR-0038 § 2) :
//
//   [marque] [organisation ▾]  [Accueil] [BUILD] [RUN] [GROW]      Aide · thème · avatar
//
// Sous 1024 px : bouton du tiroir, onglets réduits à leur icône (nom accessible
// et info-bulle conservés), Aide, avatar ; la marque et le sélecteur
// d'organisation passent dans le tiroir. La barre tient dans 360 px.

import { ModuleIcon } from '@lalanda/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BrandLogo } from '@/components/brand-logo';
import { IconeNav } from '@/components/icones-navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { api } from '@/lib/api';
import { LIENS_AIDE } from '@/lib/aide/liens';
import { useSession } from '@/lib/auth-client';

import { ACCUEIL_HREF, estAccueil, moduleCourant, NAV_MODULES } from './nav-model';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

/** Couleur du module sur le fond pétrole de la barre (jetons `--nav-*`, ≥ 3:1). */
const COULEUR_NAV = {
  build: 'text-[var(--nav-build)]',
  run: 'text-[var(--nav-run)]',
  grow: 'text-[var(--nav-grow)]',
} as const;

export function AppHeader({
  onOuvrirNavigation,
}: {
  /** Ouvre le tiroir de navigation (sous 1024 px). Absent : pas de bouton. */
  onOuvrirNavigation?: () => void;
} = {}): React.ReactElement {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();
  const courant = moduleCourant(pathname);
  const accueil = estAccueil(pathname);

  // Drapeau qui conditionne l'entrée « Administration » DU MENU (ADR-0016 §1).
  // Il vient du serveur (`GET /me/platform-access`) ; un échec ne montre PAS
  // l'entrée — ne rien proposer plutôt qu'une page qui répondrait 403.
  const [operateur, setOperateur] = useState(false);
  useEffect(() => {
    if (!session?.user) return;
    let annule = false;
    void api
      .getPlatformAccess()
      .then((acces) => {
        if (!annule) setOperateur(acces.canReadAdmin);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [session?.user]);

  const onglet = (actif: boolean): string =>
    `relative inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-2.5 text-sm transition-colors sm:px-3 ${
      actif
        ? 'bg-[var(--nav-active-bg)] font-semibold text-white'
        : 'text-[var(--nav-muted)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]'
    }`;

  return (
    <header className="nav-panel sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-2 text-[var(--nav-fg)] sm:gap-2 sm:px-4 lg:px-5">
      {onOuvrirNavigation ? (
        <button
          type="button"
          onClick={onOuvrirNavigation}
          aria-label="Ouvrir la navigation"
          aria-haspopup="dialog"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--nav-fg)] transition hover:bg-[var(--nav-active-bg)] lg:hidden"
        >
          <IconeNav id="menu" className="h-5 w-5" />
        </button>
      ) : null}

      {/* Grand écran : marque et sélecteur d'organisation. `aria-label`
          explicite : le nom du lien ne dépend pas de la largeur (ADR-0016). */}
      <Link
        href={ACCUEIL_HREF}
        aria-label="Lalanda — accueil"
        className="mr-2 hidden shrink-0 items-center transition hover:opacity-80 lg:inline-flex"
      >
        <BrandLogo hauteur={26} fond="encre" />
      </Link>
      <div className="mr-3 hidden w-56 shrink-0 lg:block">
        <OrgSwitcher />
      </div>

      <nav aria-label="Modules" className="min-w-0">
        <ul className="flex items-center gap-0.5 sm:gap-1">
          <li>
            <Link
              href={ACCUEIL_HREF}
              aria-current={accueil ? 'page' : undefined}
              aria-label="Accueil"
              title="Accueil"
              className={onglet(accueil)}
            >
              <IconeNav id="accueil" className="h-[1.1rem] w-[1.1rem]" />
              <span className="hidden md:inline">Accueil</span>
            </Link>
          </li>
          {NAV_MODULES.map((m) => {
            const actif = courant === m.id;
            return (
              <li key={m.id}>
                <Link
                  href={m.href}
                  // Sur le bureau du module comme dans l'une de ses applications,
                  // l'onglet dit « vous êtes ici » ; `page` seulement sur le bureau.
                  aria-current={actif ? (pathname === m.href ? 'page' : 'true') : undefined}
                  aria-label={`${m.label} — ${m.verb}`}
                  title={`${m.label} — ${m.verb}`}
                  className={onglet(actif)}
                >
                  <ModuleIcon module={m.id} className={`h-[1.1rem] w-[1.1rem] ${COULEUR_NAV[m.id]}`} />
                  <span className="hidden font-mono text-[0.8rem] tracking-[0.1em] sm:inline">
                    {m.label}
                  </span>
                  {actif ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 -bottom-[9px] h-[3px] rounded-full bg-[var(--nav-accent)]"
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex-1" />

      {/* RÈGLE (ADR-0016 §6) : aucun élément de cette barre n'est masqué s'il
          n'a pas d'autre chemin d'accès. Le thème, masqué sous 640 px, reste
          réglable dans Mon compte › Préférences. */}
      <div className="flex shrink-0 items-center gap-1.5 text-sm sm:gap-3">
        <Link
          href={LIENS_AIDE.centre}
          aria-label="Aide"
          title="Aide"
          className="text-[var(--nav-muted)] transition hover:text-[var(--nav-fg)]"
        >
          <span
            aria-hidden="true"
            className="font-display inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--nav-border)] text-xs font-bold xl:hidden"
          >
            ?
          </span>
          <span className="hidden xl:inline">Aide</span>
        </Link>
        <span className="hidden sm:inline-flex">
          <ThemeToggle persist />
        </span>
        {isPending ? (
          <span aria-hidden="true" className="h-8 w-8 rounded-full bg-[var(--nav-active-bg)]" />
        ) : session?.user ? (
          <UserMenu email={session.user.email} canReadAdmin={operateur} />
        ) : null}
      </div>
    </header>
  );
}
