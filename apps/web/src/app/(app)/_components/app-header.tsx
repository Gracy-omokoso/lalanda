'use client';

// En-tête compact (ADR-0038 § 2, ADR-0056) :
//
//   [≡] [fil d'Ariane : RUN / Ventes / Factures]   [Accueil BUILD RUN GROW] · aide · thème · cloche · avatar
//
// Sur fond de surface, 56 px, comme la maquette validée le 3 nov. 2026. Dans un
// module sur grand écran, la marque et le sélecteur d'organisation vivent en tête
// de la colonne de gauche ; hors module (accueil, compte, réglages), ils restent
// ici. Sous 1024 px : bouton du tiroir, onglets réduits à leur icône (nom
// accessible et info-bulle conservés) ; la barre tient dans 360 px.

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

import { ACCUEIL_HREF, estAccueil, filAriane, moduleCourant, NAV_MODULES } from './nav-model';
import { NotificationsBell } from './notifications-bell';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';
import { accesConsole } from './user-menu-model';

/** Couleur du module sur la surface (jetons `--module-*`, ≥ 3:1). */
const COULEUR_MODULE = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
} as const;

export function AppHeader({
  onOuvrirNavigation,
  avecColonne = false,
}: {
  /** Ouvre le tiroir de navigation (sous 1024 px). Absent : pas de bouton. */
  onOuvrirNavigation?: () => void;
  /** Colonne de gauche visible sur grand écran : la marque y est déjà. */
  avecColonne?: boolean;
} = {}): React.ReactElement {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();
  const courant = moduleCourant(pathname);
  const accueil = estAccueil(pathname);
  const fil = filAriane(pathname);

  // Fait qui conditionne l'entrée « Console Lalanda » DU MENU (ADR-0016 §1,
  // ADR-0053 — P1). Il vient du serveur (`GET /me/platform-access`, action
  // `platform.console.read`) ; un échec ne montre PAS l'entrée — ne rien proposer
  // plutôt qu'une page qui répondrait 403.
  const [operateur, setOperateur] = useState(false);
  useEffect(() => {
    if (!session?.user) return;
    let annule = false;
    void api
      .getPlatformAccess()
      .then((acces) => {
        if (!annule) setOperateur(accesConsole(acces));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [session?.user]);

  const onglet = (actif: boolean): string =>
    `inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[13px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
      actif
        ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
        : 'text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]'
    }`;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--foreground)] sm:gap-2 sm:px-4 lg:px-8">
      {onOuvrirNavigation ? (
        <button
          type="button"
          onClick={onOuvrirNavigation}
          aria-label="Ouvrir la navigation"
          aria-haspopup="dialog"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--foreground)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] lg:hidden"
        >
          <IconeNav id="menu" className="h-5 w-5" />
        </button>
      ) : null}

      {/* Hors module, grand écran : marque et sélecteur d'organisation.
          `aria-label` explicite : le nom du lien ne dépend pas de la largeur. */}
      {avecColonne ? null : (
        <>
          <Link
            href={ACCUEIL_HREF}
            aria-label="Lalanda — accueil"
            className="mr-2 hidden shrink-0 items-center transition-opacity hover:opacity-80 lg:inline-flex"
          >
            <BrandLogo hauteur={26} />
          </Link>
          <div className="mr-3 hidden w-56 shrink-0 lg:block">
            <OrgSwitcher variante="surface" />
          </div>
        </>
      )}

      {fil.length > 0 ? (
        <nav aria-label="Fil d’Ariane" className="hidden min-w-0 sm:block">
          <ol className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--foreground-muted)]">
            {courant ? (
              <li aria-hidden="true" className="flex">
                <ModuleIcon module={courant} className={`h-4 w-4 ${COULEUR_MODULE[courant]}`} />
              </li>
            ) : null}
            {fil.map((maillon, i) => {
              const dernier = i === fil.length - 1;
              return (
                <li key={`${maillon.label}-${i}`} className="flex min-w-0 items-center gap-2">
                  {i > 0 ? <span aria-hidden="true">/</span> : null}
                  {dernier ? (
                    <span
                      aria-current="page"
                      className="truncate font-medium text-[var(--foreground)]"
                    >
                      {maillon.label}
                    </span>
                  ) : maillon.href ? (
                    <Link
                      href={maillon.href}
                      className="truncate transition-colors duration-[var(--motion-fast)] hover:text-[var(--foreground)]"
                    >
                      {maillon.label}
                    </Link>
                  ) : (
                    <span className="truncate">{maillon.label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex-1" />

      <nav aria-label="Modules" className="min-w-0">
        <ul className="flex items-center gap-0.5">
          <li>
            <Link
              href={ACCUEIL_HREF}
              aria-current={accueil ? 'page' : undefined}
              aria-label="Accueil"
              title="Accueil"
              className={onglet(accueil)}
            >
              <IconeNav id="accueil" className="h-4 w-4" />
              <span className="hidden xl:inline">Accueil</span>
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
                  <ModuleIcon module={m.id} className={`h-4 w-4 ${COULEUR_MODULE[m.id]}`} />
                  <span className="hidden text-[12px] font-semibold tracking-[0.6px] md:inline">
                    {m.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-[var(--border)] sm:block" />

      {/* RÈGLE (ADR-0016 §6) : aucun élément de cette barre n'est masqué s'il
          n'a pas d'autre chemin d'accès. Le thème, masqué sous 640 px, reste
          réglable dans Mon compte › Préférences. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href={LIENS_AIDE.centre}
          aria-label="Aide"
          title="Aide"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
          </svg>
        </Link>
        <span className="hidden sm:inline-flex">
          <ThemeToggle persist discret />
        </span>
        {session?.user ? <NotificationsBell /> : null}
        {isPending ? (
          <span
            aria-hidden="true"
            className="ml-1 h-8 w-8 rounded-full bg-[var(--surface-muted)]"
          />
        ) : session?.user ? (
          <UserMenu email={session.user.email} accesConsole={operateur} />
        ) : null}
      </div>
    </header>
  );
}
