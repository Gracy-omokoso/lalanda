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
// ADR-0053 — P4
import { api, type MyFeaturesView } from '@/lib/api';

import {
  ACCUEIL_HREF,
  appActive,
  appsVisibles,
  explicationOffre,
  groupesApplications,
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
  onNavigate,
}: {
  /** Module courant ; `null` hors module (le tiroir liste alors les modules). */
  module: ModuleId | null;
  /** Rail d'icônes (bureau, replié). Les noms restent accessibles. */
  replie?: boolean;
  /** Rendu dans le tiroir du téléphone (le bouton de fermeture est posé par le tiroir). */
  tiroir?: boolean;
  /** Appelé au clic sur une entrée (le tiroir mobile se ferme). */
  onNavigate?: () => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      {/* Marque et organisation en tête de colonne, comme la maquette validée
          (ADR-0056) : sur le bureau comme dans le tiroir du téléphone. */}
      <div
        className={`flex h-14 shrink-0 items-center border-b border-[var(--nav-border)] ${replie ? 'justify-center px-2' : 'px-[18px]'}`}
      >
        <Link
          href={ACCUEIL_HREF}
          aria-label="Lalanda — accueil"
          onClick={onNavigate}
          className="inline-flex shrink-0 items-center transition-opacity duration-[var(--motion-fast)] hover:opacity-80"
        >
          <BrandLogo hauteur={replie ? 15 : 26} fond="nav" />
        </Link>
      </div>
      <div className={replie ? 'flex justify-center p-3' : 'p-3'}>
        <OrgSwitcher replie={replie} />
      </div>
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
    <nav aria-label="Modules" className="mt-1 flex-1 overflow-y-auto px-3 pb-4">
      <ul className="flex flex-col gap-1">
        {NAV_MODULES.map((m) => (
          <li key={m.id}>
            <Link
              href={m.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 text-[var(--nav-muted)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
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
  const fonctionnalites = useMesFonctionnalites(actions);
  const active = appActive(pathname, apps);
  const sousActive = sousOptionActive(pathname, apps);
  const groupes = groupesApplications(apps);

  return (
    <nav
      aria-label={`Applications ${m.label}`}
      className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-1"
    >
      <Link
        href={m.href}
        onClick={onNavigate}
        aria-current={pathname === m.href ? 'page' : undefined}
        aria-label={replie ? `${m.label} — ${m.verb}` : undefined}
        title={replie ? `${m.label} — ${m.verb}` : undefined}
        className={`mb-2 flex items-center rounded-[var(--radius-md)] text-[11px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-[var(--nav-active-bg)] ${replie ? 'mx-auto h-8 w-8 justify-center' : 'h-8 gap-2 px-2.5'}`}
      >
        <ModuleIcon module={module} className={`h-4 w-4 ${COULEUR_NAV[module]}`} />
        {replie ? null : (
          <>
            <span className="font-semibold tracking-[0.6px] text-[var(--nav-fg)]">{m.label}</span>
            <span className="text-[var(--nav-muted)]">{m.verb}</span>
          </>
        )}
      </Link>
      {apps.length === 0 ? (
        replie ? null : (
          <p className="px-2.5 text-xs leading-5 text-[var(--nav-muted)]">
            Aucune application de ce module n’est ouverte à votre rôle.
          </p>
        )
      ) : (
        <div className={replie ? 'flex flex-col items-center gap-3' : 'flex flex-col gap-3.5'}>
          {groupes.map((g, gi) => (
            <div key={g.rubrique ?? `groupe-${gi}`} className="flex flex-col gap-px">
              {g.rubrique && !replie ? (
                <p className="flex items-center gap-2 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.6px] text-[var(--nav-muted)]">
                  <span
                    aria-hidden="true"
                    className="h-[7px] w-[7px] rounded-full"
                    style={{ background: `var(--nav-${module})` }}
                  />
                  {g.rubrique}
                </p>
              ) : null}
              <ul
                aria-label={g.rubrique ?? undefined}
                className={replie ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-px'}
              >
                {g.apps.map((app) => (
                  <li key={app.id}>
                    <Application
                      app={app}
                      actif={active === app.id}
                      sousActive={sousActive}
                      replie={replie}
                      onNavigate={onNavigate}
                      explication={explicationOffre(app.id, fonctionnalites)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

/**
 * ADR-0053 — P4 : `GET /me/features` de l'organisation active, relu quand ses droits
 * changent. `null` tant qu'il n'est pas connu ou en cas d'échec : rien n'est affirmé.
 */
function useMesFonctionnalites(actions: readonly unknown[] | null): MyFeaturesView | null {
  const [vue, setVue] = useState<MyFeaturesView | null>(null);
  useEffect(() => {
    if (actions === null) return;
    let annule = false;
    api
      .getMyFeatures()
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch(() => {
        if (!annule) setVue(null);
      });
    return () => {
      annule = true;
    };
  }, [actions]);
  return vue;
}

function Application({
  app,
  actif,
  sousActive,
  replie,
  onNavigate,
  explication = null,
}: {
  app: NavApp;
  actif: boolean;
  sousActive: string | null;
  replie: boolean;
  onNavigate: (() => void) | undefined;
  /** ADR-0053 — P4 : « Disponible avec l'offre … », affiché plutôt que caché. */
  explication?: string | null;
}): React.ReactElement {
  const aSousOptions = app.sousOptions.length > 0 && !replie;
  const [ouvert, setOuvert] = useState(actif);
  // Entrer dans l'application la déroule ; en sortir ne la referme pas de force.
  useEffect(() => {
    if (actif) setOuvert(true);
  }, [actif]);

  const courante = actif && sousActive === null;
  // Maquette validée (ADR-0056) : 32 px, 13 px ; active = fond, gras et filet
  // d'accent à gauche ; inactive en encre de barre adoucie (lisible, pas grise).
  const base =
    'group relative flex min-w-0 flex-1 items-center rounded-[var(--radius-md)] text-[13px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]';
  const etat = actif
    ? 'bg-[var(--nav-active-bg)] font-semibold text-[var(--nav-active-fg)] shadow-[inset_2px_0_0_var(--nav-accent)]'
    : 'text-[color-mix(in_srgb,var(--nav-fg)_86%,var(--nav-bg))] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]';
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
          title={replie ? (explication ? `${app.label} — ${explication}` : app.label) : undefined}
          className={`${base} ${etat} ${replie ? 'h-9 w-9 flex-none justify-center' : explication ? 'min-h-8 gap-2.5 px-2.5 py-1' : 'h-8 gap-2.5 px-2.5'}`}
        >
          <IconeNav id={app.icon} className="h-4 w-4 shrink-0" />
          {replie ? null : explication ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{app.label}</span>
              <span className="truncate text-[0.68rem] font-normal text-[var(--nav-muted)]">
                {explication}
              </span>
            </span>
          ) : (
            <span className="truncate">{app.label}</span>
          )}
        </Link>
        {aSousOptions ? (
          <button
            type="button"
            onClick={() => setOuvert((v) => !v)}
            aria-expanded={ouvert}
            aria-controls={idListe}
            aria-label={`${ouvert ? 'Replier' : 'Déplier'} ${app.label}`}
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--nav-muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]"
          >
            <IconeNav
              id="chevron"
              className={`h-3.5 w-3.5 transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] motion-reduce:transition-none ${ouvert ? 'rotate-180' : ''}`}
            />
          </button>
        ) : null}
      </div>
      {aSousOptions && ouvert ? (
        <ul
          id={idListe}
          className="mb-1 ml-[1.15rem] mt-px border-l border-[var(--nav-border)] pl-2.5"
        >
          {app.sousOptions.map((s) => {
            const allumee = sousActive === s.id;
            return (
              <li key={s.id}>
                <Link
                  href={s.href}
                  onClick={onNavigate}
                  aria-current={allumee ? 'page' : undefined}
                  className={`flex h-7 items-center truncate rounded-[var(--radius-md)] px-2 text-[12.5px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${allumee ? 'font-semibold text-[var(--nav-active-fg)]' : 'text-[var(--nav-muted)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]'}`}
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
