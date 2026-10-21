'use client';

// Navigation latérale par module (ADR-0030 § 2).
//
// Un seul composant pour la barre de bureau et le tiroir du téléphone : la
// liste, l'ordre et l'entrée active viennent de `nav-model.ts`. La signature
// visuelle est le RAIL DE TRAJECTOIRE : les trois modules sont des nœuds reliés
// par un trait vertical, BUILD → RUN → GROW — la synchronisation qui fait la
// valeur du produit, rappelée sur chaque écran. Le reste est sobre.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BrandLogo, BrandMark } from '@/components/brand-logo';
import { IconeNav } from '@/components/icones-navigation';

import {
  MISE_EN_ROUTE_BASE,
  progression,
  termine,
} from '../organisation/_components/onboarding-model';
import { useMiseEnRoute } from '../organisation/_components/use-mise-en-route';
import {
  entreeActive,
  entreesVisibles,
  groupesVisibles,
  type NavGroupId,
  type NavItem,
} from './nav-model';
import { OrgSwitcher } from './org-switcher';
import { useShell } from './shell-context';

const COULEUR_NOEUD: Record<NavGroupId, string> = {
  build: 'bg-[var(--nav-build)]',
  run: 'bg-[var(--nav-run)]',
  grow: 'bg-[var(--nav-grow)]',
  organisation: 'bg-[var(--nav-muted)]',
};

export function SidebarNav({
  replie = false,
  onNavigate,
}: {
  /** Rail d'icônes (bureau, replié). Les noms restent accessibles. */
  replie?: boolean;
  /** Appelé au clic sur une entrée (le tiroir mobile se ferme). */
  onNavigate?: () => void;
}): React.ReactElement {
  const pathname = usePathname();
  const { actions, modules, setModules } = useShell();
  const items = entreesVisibles(actions, modules);
  const groupes = groupesVisibles(items);
  const active = entreeActive(pathname, items);

  return (
    <div className="flex h-full flex-col">
      <div className={replie ? 'flex justify-center py-5' : 'px-5 pb-4 pt-5'}>
        <Link
          href="/projects"
          aria-label="Lalanda — plans financiers"
          onClick={onNavigate}
          className="inline-flex shrink-0 items-center transition hover:opacity-80"
        >
          {replie ? <BrandMark taille={30} /> : <BrandLogo hauteur={28} fond="encre" />}
        </Link>
      </div>

      <div className={replie ? 'flex justify-center px-2' : 'px-3'}>
        <OrgSwitcher replie={replie} />
      </div>

      <nav
        aria-label="Navigation principale"
        className="mt-5 flex-1 overflow-y-auto overscroll-contain px-3 pb-4"
      >
        <ul className="flex flex-col">
          {groupes.map(({ group, items: entrees }, index) => {
            const estModule = group.id !== 'organisation';
            const suivantEstModule =
              groupes[index + 1]?.group.id !== 'organisation' && !!groupes[index + 1];
            return (
              <li
                key={group.id}
                className={estModule ? 'relative' : 'mt-4 border-t border-[var(--nav-border)] pt-4'}
              >
                {/* Rail de trajectoire : relie ce module au suivant. Décoratif. */}
                {estModule && suivantEstModule && !replie ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-4 left-[calc(0.8125rem-0.5px)] top-6 w-px bg-[var(--nav-border)]"
                  />
                ) : null}
                <h2
                  className={
                    replie
                      ? 'sr-only'
                      : 'flex items-center gap-2.5 px-2 pb-1 pt-2 font-mono text-[0.68rem] uppercase tracking-[0.14em]'
                  }
                >
                  {estModule ? (
                    <span
                      aria-hidden="true"
                      className={`relative z-10 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--nav-bg)] ${COULEUR_NOEUD[group.id]}`}
                    />
                  ) : null}
                  <span className="font-semibold text-[var(--nav-fg)]">{group.label}</span>
                  {group.verb ? (
                    <span className="normal-case tracking-normal text-[var(--nav-muted)]">
                      {group.verb}
                    </span>
                  ) : null}
                </h2>
                {replie && estModule ? (
                  <span
                    aria-hidden="true"
                    className={`mx-auto mb-1 mt-3 block h-1.5 w-1.5 rounded-full ${COULEUR_NOEUD[group.id]}`}
                  />
                ) : null}
                <ul
                  className={
                    replie ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-0.5 pb-2'
                  }
                >
                  {entrees.map((item) => (
                    <li key={item.id}>
                      <Entree
                        item={item}
                        actif={active === item.id}
                        replie={replie}
                        retrait={estModule}
                        onNavigate={onNavigate}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>

        {modules !== null && !replie ? (
          <button
            type="button"
            onClick={() => setModules([])}
            className="mt-3 w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--nav-muted)] underline-offset-2 transition hover:text-[var(--nav-fg)] hover:underline"
          >
            Afficher tous les modules
          </button>
        ) : null}
      </nav>

      {replie ? null : <CarteMiseEnRoute onNavigate={onNavigate} />}
    </div>
  );
}

function Entree({
  item,
  actif,
  replie,
  retrait,
  onNavigate,
}: {
  item: NavItem;
  actif: boolean;
  replie: boolean;
  retrait: boolean;
  onNavigate: (() => void) | undefined;
}): React.ReactElement {
  const base =
    'group relative flex items-center rounded-[var(--radius-sm)] text-sm transition-colors';
  const etat = actif
    ? 'bg-[var(--nav-active-bg)] font-semibold text-white'
    : 'text-[var(--nav-muted)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-fg)]';
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={actif ? 'page' : undefined}
      // Replié, l'icône est seule à l'écran : le nom passe par `aria-label`, et
      // `title` le montre au survol. Jamais une icône muette.
      aria-label={replie ? item.label : undefined}
      title={replie ? item.label : undefined}
      className={`${base} ${etat} ${replie ? 'h-10 w-10 justify-center' : `gap-3 py-2 pr-2 ${retrait ? 'pl-8' : 'pl-2'}`}`}
    >
      {actif ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--nav-accent)]"
        />
      ) : null}
      <IconeNav id={item.icon} className="h-[1.05rem] w-[1.05rem] shrink-0" />
      {replie ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/**
 * Rappel de la mise en route, tant qu'une étape ouverte au rôle reste à faire.
 * Disparaît d'elle-même quand tout est fait — la page reste atteignable par
 * l'entrée « Mise en route ».
 */
function CarteMiseEnRoute({
  onNavigate,
}: {
  onNavigate: (() => void) | undefined;
}): React.ReactElement | null {
  const { faits, pret } = useMiseEnRoute();
  const pathname = usePathname();
  if (!pret || termine(faits) || pathname.startsWith('/organisation/mise-en-route')) return null;
  const { faites, total } = progression(faits);
  return (
    <div className="mx-3 mb-3 rounded-[var(--radius-md)] border border-[var(--nav-border)] p-3">
      <p className="text-xs font-semibold text-[var(--nav-fg)]">
        Mise en route · {faites}/{total}
      </p>
      <div
        aria-hidden="true"
        className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--nav-border)]"
      >
        <div
          className="h-full rounded-full bg-[var(--nav-accent)]"
          style={{ width: `${total ? Math.round((faites / total) * 100) : 0}%` }}
        />
      </div>
      <Link
        href={MISE_EN_ROUTE_BASE}
        onClick={onNavigate}
        className="mt-2 inline-block text-xs font-medium text-[var(--nav-accent)] underline-offset-2 hover:underline"
      >
        Reprendre la mise en route
        <span className="sr-only">
          {' '}
          ({faites} étapes faites sur {total})
        </span>
      </Link>
    </div>
  );
}
