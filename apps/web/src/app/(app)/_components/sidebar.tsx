'use client';

// Colonne de gauche — niveau 3 de la navigation (ADR-0038 § 2).
//
// Elle ne liste QUE les applications du module courant ; une application qui
// a des sous-options se déroule (bouton `aria-expanded`), ouverte d'office
// quand on est dedans. Un seul composant pour la colonne du bureau et le
// tiroir du téléphone. Hors module (accueil, compte, réglages), le tiroir liste
// les trois modules à la place. Tout ce qui décide vient de `nav-model.ts`.

import { ModuleIcon, type ModuleId } from '@lalanda/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BrandLogo } from '@/components/brand-logo';
import { IconeNav } from '@/components/icones-navigation';

import {
  ACCUEIL_HREF,
  appActive,
  appsVisibles,
  moduleParId,
  NAV_MODULES,
  sousOptionActive,
  type NavApp,
} from './nav-model';
import { OrgSwitcher } from './org-switcher';
import { useShell } from './shell-context';

const COULEUR_NAV: Record<ModuleId, string> = {
  build: 'text-[var(--nav-build)]',
  run: 'text-[var(--nav-run)]',
  grow: 'text-[var(--nav-grow)]',
};

export function SidebarNav({
  module,
  replie = false,
  tiroir = false,
  onNavigate,
}: {
  /** Module courant ; `null` hors module (le tiroir liste alors les modules). */
  module: ModuleId | null;
  /** Rail d'icônes (bureau, replié). Les noms restent accessibles. */
  replie?: boolean;
  /** Rendu dans le tiroir du téléphone : marque et sélecteur d'organisation en tête. */
  tiroir?: boolean;
  /** Appelé au clic sur une entrée (le tiroir mobile se ferme). */
  onNavigate?: () => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      {tiroir ? (
        <>
          <div className="px-5 pb-4 pt-5">
            <Link
              href={ACCUEIL_HREF}
              aria-label="Lalanda — accueil"
              onClick={onNavigate}
              className="inline-flex shrink-0 items-center transition hover:opacity-80"
            >
              <BrandLogo hauteur={28} fond="encre" />
            </Link>
          </div>
          <div className="px-3">
            <OrgSwitcher />
          </div>
        </>
      ) : null}
      {module === null ? (
        <ListeModules onNavigate={onNavigate} />
      ) : (
        <ListeApplications module={module} replie={replie} onNavigate={onNavigate} />
      )}
    </div>
  );
}

/** Hors module : les trois bureaux, pour le tiroir du téléphone. */
function ListeModules({
  onNavigate,
}: {
  onNavigate: (() => void) | undefined;
}): React.ReactElement {
  return (
    <nav aria-label="Modules" className="mt-5 flex-1 overflow-y-auto px-3 pb-4">
      <ul className="flex flex-col gap-1">
        {NAV_MODULES.map((m) => (
          <li key={m.id}>
            <Link
              href={m.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 text-[var(--nav-muted)] transition-colors hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
            >
              <ModuleIcon module={m.id} className={`h-5 w-5 ${COULEUR_NAV[m.id]}`} />
              <span className="flex flex-col">
                <span className="font-mono text-sm font-semibold tracking-[0.1em] text-[var(--nav-fg)]">
                  {m.label}
                </span>
                <span className="text-xs">{m.verb}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ListeApplications({
  module,
  replie,
  onNavigate,
}: {
  module: ModuleId;
  replie: boolean;
  onNavigate: (() => void) | undefined;
}): React.ReactElement {
  const pathname = usePathname();
  const { actions } = useShell();
  const m = moduleParId(module);
  const apps = appsVisibles(actions, module);
  const active = appActive(pathname, apps);
  const sousActive = sousOptionActive(pathname, apps);

  return (
    <nav
      aria-label={`Applications ${m.label}`}
      className="mt-4 flex-1 overflow-y-auto overscroll-contain px-3 pb-4"
    >
      <Link
        href={m.href}
        onClick={onNavigate}
        aria-current={pathname === m.href ? 'page' : undefined}
        aria-label={replie ? `${m.label} — ${m.verb}` : undefined}
        title={replie ? `${m.label} — ${m.verb}` : undefined}
        className={`mb-2 flex items-center rounded-[var(--radius-sm)] font-mono text-[0.72rem] uppercase tracking-[0.14em] transition-colors hover:bg-[var(--nav-active-bg)] ${replie ? 'mx-auto h-10 w-10 justify-center' : 'gap-2.5 px-2 py-2'}`}
      >
        <ModuleIcon module={module} className={`h-4 w-4 ${COULEUR_NAV[module]}`} />
        {replie ? null : (
          <>
            <span className="font-semibold text-[var(--nav-fg)]">{m.label}</span>
            <span className="normal-case tracking-normal text-[var(--nav-muted)]">{m.verb}</span>
          </>
        )}
      </Link>
      {apps.length === 0 ? (
        replie ? null : (
          <p className="px-2 text-xs leading-5 text-[var(--nav-muted)]">
            Aucune application de ce module n’est ouverte à votre rôle.
          </p>
        )
      ) : (
        <ul className={replie ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-0.5'}>
          {apps.map((app) => (
            <li key={app.id}>
              <Application
                app={app}
                actif={active === app.id}
                sousActive={sousActive}
                replie={replie}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function Application({
  app,
  actif,
  sousActive,
  replie,
  onNavigate,
}: {
  app: NavApp;
  actif: boolean;
  sousActive: string | null;
  replie: boolean;
  onNavigate: (() => void) | undefined;
}): React.ReactElement {
  const aSousOptions = app.sousOptions.length > 0 && !replie;
  const [ouvert, setOuvert] = useState(actif);
  // Entrer dans l'application la déroule ; en sortir ne la referme pas de force.
  useEffect(() => {
    if (actif) setOuvert(true);
  }, [actif]);

  const courante = actif && sousActive === null;
  const base =
    'group relative flex min-w-0 flex-1 items-center rounded-[var(--radius-sm)] text-sm transition-colors';
  const etat = actif
    ? 'bg-[var(--nav-active-bg)] font-semibold text-white'
    : 'text-[var(--nav-muted)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]';
  const idListe = `sous-options-${app.id}`;

  return (
    <>
      <div className="flex items-center gap-0.5">
        <Link
          href={app.href}
          onClick={onNavigate}
          aria-current={courante ? 'page' : undefined}
          // Replié, l'icône est seule à l'écran : le nom passe par `aria-label`,
          // et `title` le montre au survol. Jamais une icône muette.
          aria-label={replie ? app.label : undefined}
          title={replie ? app.label : undefined}
          className={`${base} ${etat} ${replie ? 'h-10 w-10 flex-none justify-center' : 'gap-3 py-2 pl-2 pr-2'}`}
        >
          {actif ? (
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-[var(--nav-accent)]"
            />
          ) : null}
          <IconeNav id={app.icon} className="h-[1.05rem] w-[1.05rem] shrink-0" />
          {replie ? null : <span className="truncate">{app.label}</span>}
        </Link>
        {aSousOptions ? (
          <button
            type="button"
            onClick={() => setOuvert((v) => !v)}
            aria-expanded={ouvert}
            aria-controls={idListe}
            aria-label={`${ouvert ? 'Replier' : 'Déplier'} ${app.label}`}
            className="inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--nav-muted)] transition hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
          >
            <IconeNav
              id="chevron"
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${ouvert ? 'rotate-180' : ''}`}
            />
          </button>
        ) : null}
      </div>
      {aSousOptions && ouvert ? (
        <ul
          id={idListe}
          className="mb-1 ml-[1.15rem] mt-0.5 border-l border-[var(--nav-border)] pl-3"
        >
          {app.sousOptions.map((s) => {
            const allumee = sousActive === s.id;
            return (
              <li key={s.id}>
                <Link
                  href={s.href}
                  onClick={onNavigate}
                  aria-current={allumee ? 'page' : undefined}
                  className={`block truncate rounded-[var(--radius-sm)] px-2 py-1.5 text-[0.8rem] transition-colors ${allumee ? 'font-semibold text-white' : 'text-[var(--nav-muted)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]'}`}
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
