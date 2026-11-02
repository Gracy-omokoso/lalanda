'use client';

// Coquille de la console Lalanda (ADR-0053 — P1, § 2.1).
//
//   Barre du haut : marque · « Console Lalanda »      Retour à l'espace organisation · thème · compte
//   Bandeau permanent : « Console Lalanda — vous agissez pour la plateforme » + rôles détenus
//   ≥ 1024 px : colonne des modules ouverts par les actions + contenu pleine largeur
//   < 1024 px : modules en bande défilante au-dessus du contenu
//
// Ni sélecteur d'organisation, ni barre BUILD · RUN · GROW, ni cloche, ni
// `TermsGate` d'organisation : la coquille n'appelle que `/me/platform-access` et
// `/account/preferences` (`CONSOLE_SHELL_CALLS`, testé). Elle ne décide d'aucun
// accès : elle range ce que sert l'API, qui refuse de toute façon.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { AppVersion } from '@/components/app-version';
import { BrandLogo } from '@/components/brand-logo';
import { LegalLinks } from '@/components/legal-links';
import { ThemeToggle } from '@/components/theme-toggle';
import { useSession } from '@/lib/auth-client';

import { AccesPlateformeProvider, useChargementAcces } from './admin-access';
// ADR-0053 — P8
import { EnrolementDeuxFacteurs, VerificationDeuxFacteurs } from './deux-facteurs';
import { etatDeuxFacteurs } from './deux-facteurs-model';
import { Bandeau, Vide } from './admin-chrome';
import {
  CONSOLE_BASE,
  ESPACE_ORGANISATION_HREF,
  actionsDe,
  etatPage,
  hrefModule,
  libelleRoles,
  moduleDuChemin,
  modulesVisibles,
  type ModuleConsole,
} from './console-model';

export function ConsoleShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  // ADR-0053 — P8 : relecture de l'accès après enrôlement ou vérification.
  const [relecture, setRelecture] = useState(0);
  const chargement = useChargementAcces(relecture);

  let rolesTexte: string | null = null;
  let modules: ModuleConsole[] = [];
  let contenu: React.ReactNode;

  if (chargement.etat === 'chargement') {
    contenu = (
      <p className="text-sm text-[var(--foreground-muted)]">Vérification de votre accès…</p>
    );
  } else if (chargement.etat === 'erreur') {
    contenu = <Bandeau ton="echec">{chargement.message}</Bandeau>;
  } else {
    const { acces } = chargement;
    const actions = actionsDe(acces);
    const etat = etatPage(pathname, actions);
    rolesTexte = libelleRoles(acces.roles);
    modules = modulesVisibles(actions);
    // ADR-0053 — P8 : double authentification exigée avant toute page de console. Un
    // opérateur non enrôlé est envoyé vers l'enrôlement, jamais vers un refus sans issue.
    const deuxFacteurs = etatDeuxFacteurs(acces);
    if (etat !== 'refus-console' && deuxFacteurs === 'enrolement') {
      modules = [];
      contenu = <EnrolementDeuxFacteurs onTermine={() => setRelecture((n) => n + 1)} />;
    } else if (etat !== 'refus-console' && deuxFacteurs === 'verification') {
      modules = [];
      contenu = <VerificationDeuxFacteurs onTermine={() => setRelecture((n) => n + 1)} />;
    } else if (etat === 'refus-console') {
      // Refus, et non panne : la page n'est pas montée, aucun appel `/admin/**`
      // ne part (ADR-0053, critère 22).
      contenu = <RefusConsole operateur={acces.isPlatformOperator} roles={rolesTexte} />;
    } else if (etat === 'refus-module') {
      contenu = <RefusModule cible={moduleDuChemin(pathname)} />;
    } else {
      contenu = <AccesPlateformeProvider acces={acces}>{children}</AccesPlateformeProvider>;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)]">
      <BarreConsole />
      <div
        role="note"
        aria-label="Espace de la console"
        className="border-b border-[var(--warning)]/30 bg-[var(--warning-bg)] px-4 py-2 text-sm text-[var(--warning)] lg:px-6"
      >
        <span className="font-semibold">Console Lalanda — vous agissez pour la plateforme.</span>{' '}
        {rolesTexte ? (
          <span className="text-[var(--foreground)]">Vos rôles : {rolesTexte}.</span>
        ) : null}
      </div>

      <div className="flex w-full flex-1 flex-col lg:flex-row">
        {modules.length > 0 ? <NavigationConsole modules={modules} pathname={pathname} /> : null}
        <main id="contenu" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          {contenu}
        </main>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 text-xs text-[var(--foreground-muted)] lg:px-6">
        <LegalLinks />
        <AppVersion />
      </footer>
    </div>
  );
}

function BarreConsole(): React.ReactElement {
  const { data: session } = useSession();
  const router = useRouter();
  const [sortie, setSortie] = useState(false);

  async function seDeconnecter(): Promise<void> {
    setSortie(true);
    try {
      const { signOut } = await import('@/lib/auth-client');
      await signOut();
      router.push('/login');
      router.refresh();
    } finally {
      setSortie(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-4 lg:px-6">
      <Link
        href={CONSOLE_BASE}
        aria-label="Console Lalanda — tableau de bord"
        className="flex shrink-0 items-center gap-3 transition hover:opacity-80"
      >
        <span className="hidden sm:inline-flex">
          <BrandLogo hauteur={24} />
        </span>
        <span className="font-mono rounded-full border border-[var(--warning)]/40 bg-[var(--warning-bg)] px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--warning)]">
          Console
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <Link
          href={ESPACE_ORGANISATION_HREF}
          className="inline-flex h-10 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-2)]"
        >
          <span aria-hidden="true" className="mr-1.5">
            ←
          </span>
          <span className="hidden sm:inline">Retour à l’espace organisation</span>
          <span className="sm:hidden">Espace organisation</span>
        </Link>
        <span className="hidden sm:inline-flex">
          <ThemeToggle persist />
        </span>
        {session?.user ? (
          <>
            <span className="hidden max-w-[14rem] truncate text-xs text-[var(--foreground-muted)] md:inline">
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={() => void seDeconnecter()}
              disabled={sortie}
              className="inline-flex h-10 items-center rounded-[var(--radius-md)] px-3 text-sm text-[var(--foreground-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:opacity-60"
            >
              {sortie ? 'Déconnexion…' : 'Déconnexion'}
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}

function NavigationConsole({
  modules,
  pathname,
}: {
  modules: readonly ModuleConsole[];
  pathname: string;
}): React.ReactElement {
  const courant = moduleDuChemin(pathname);
  return (
    <nav
      aria-label="Modules de la console"
      className="border-b border-[var(--border)] lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r"
    >
      <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:sticky lg:top-14 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4">
        {modules.map((m) => {
          const actif = courant?.id === m.id;
          return (
            <li key={m.id} className="shrink-0">
              <Link
                href={hrefModule(m)}
                aria-current={actif ? 'page' : undefined}
                className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm transition ${
                  actif
                    ? 'bg-[var(--surface-2)] font-semibold text-[var(--foreground)]'
                    : 'text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]'
                }`}
              >
                <span>{m.label}</span>
                {m.etat === 'bientot' ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
                    Bientôt
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RefusConsole({
  operateur,
  roles,
}: {
  operateur: boolean;
  roles: string;
}): React.ReactElement {
  return (
    <Vide>
      <p className="text-sm font-medium text-[var(--foreground)]">
        La console Lalanda est réservée aux opérateurs de la plateforme
      </p>
      <p className="mx-auto mt-2 max-w-xl">
        {operateur
          ? `Vos rôles plateforme (${roles}) n’ouvrent pas la console.`
          : 'Vous ne détenez aucun rôle plateforme. Un super-administrateur peut vous en attribuer un.'}
      </p>
      <p className="mt-4">
        <Link
          href={ESPACE_ORGANISATION_HREF}
          className="underline underline-offset-4 hover:no-underline"
        >
          Retourner à l’espace organisation
        </Link>
      </p>
    </Vide>
  );
}

function RefusModule({ cible }: { cible: ModuleConsole | null }): React.ReactElement {
  return (
    <Vide>
      <p className="text-sm font-medium text-[var(--foreground)]">
        {cible ? `${cible.label} : module non ouvert à vos rôles` : 'Module non ouvert'}
      </p>
      <p className="mx-auto mt-2 max-w-xl">
        Vos rôles plateforme ne donnent pas accès à ce module. Les modules qui vous sont ouverts
        figurent dans la navigation.
      </p>
      <p className="mt-4">
        <Link href={CONSOLE_BASE} className="underline underline-offset-4 hover:no-underline">
          Retourner au tableau de bord de la console
        </Link>
      </p>
    </Vide>
  );
}
