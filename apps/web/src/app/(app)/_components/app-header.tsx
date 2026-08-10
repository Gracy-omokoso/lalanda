'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { LIENS_AIDE } from '@/lib/aide/liens';
import { ThemeToggle } from '@/components/theme-toggle';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

export function AppHeader(): React.ReactElement {
  const { data: session, isPending } = useSession();

  // Drapeau qui conditionne l'entrée « Administration » DU MENU (ADR-0016 §1) —
  // il n'y a plus de lien « Administration » dans la barre.
  //
  // C'est le SEUL chemin de découverte de cet espace : sans cette entrée, il
  // faudrait connaître l'URL. Le drapeau vient du serveur
  // (`GET /me/platform-access`, ouvert à tous et scopé par la session) — le
  // header ne déduit rien d'un rôle qu'il aurait recopié. Masquer reste un
  // confort d'interface : `/admin` est gardé par `PermissionsGuard` côté API, et
  // l'espace lui-même affiche un refus explicite à qui force l'URL.
  const [operateur, setOperateur] = useState(false);
  useEffect(() => {
    if (!session?.user) return;
    let annule = false;
    void api
      .getPlatformAccess()
      .then((acces) => {
        if (!annule) setOperateur(acces.canReadAdmin);
      })
      // Un échec ne montre PAS le lien. Le défaut est de ne rien proposer plutôt
      // que de proposer une page qui répondrait 403.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [session?.user]);

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
      <Link href="/projects" className="group flex items-center gap-3">
        <span
          aria-hidden="true"
          className="font-display inline-flex h-8 w-8 items-center justify-center rounded-md border-2 border-[var(--accent)] text-sm font-black text-[var(--accent)]"
        >
          L
        </span>
        {/* Le bloc texte se replie sous 640 px, le carré « L » reste : c'est le
            seul élément de la barre qui peut disparaître sans rien rendre
            inatteignable, puisque le carré porte le même lien. */}
        <div className="hidden flex-col leading-tight sm:flex">
          <span className="font-display text-base font-bold tracking-tight group-hover:text-[var(--accent)]">
            Lalanda
          </span>
          <span className="font-mono text-[0.6rem] tracking-[0.14em] text-[var(--foreground-muted)]">
            PLAN FINANCIER BANCABLE
          </span>
        </div>
      </Link>

      {/* RÈGLE (ADR-0016 §6) : aucun lien de cette barre ne porte `hidden sm:*`
          s'il n'a pas d'autre chemin d'accès. « Membres », « Abonnement » et
          « Administration » le faisaient — ils étaient donc introuvables sur
          téléphone. Ils vivent désormais dans le menu du compte, disponible à
          toutes les largeurs. */}
      <div className="flex items-center gap-2 text-sm sm:gap-3">
        {session?.user ? <OrgSwitcher /> : null}
        {/* Le centre d'aide est la seule entrée permanente vers le glossaire et
            l'explication des ratios. Hors session aussi : /aide est public, et
            une page d'aide atteignable depuis n'importe où vaut mieux qu'un lien
            qui n'apparaît qu'une fois connecté — le menu du compte n'existe pas
            pour un visiteur anonyme, y déplacer Aide reviendrait à la supprimer
            pour lui.

            Sous 640 px il se réduit à une icône, mais JAMAIS à une icône muette :
            `aria-label` porte le nom, le point d'interrogation est décoratif. */}
        <Link
          href={LIENS_AIDE.centre}
          aria-label="Aide"
          title="Aide"
          className="text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
        >
          <span
            aria-hidden="true"
            className="font-display inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] text-xs font-bold sm:hidden"
          >
            ?
          </span>
          <span className="hidden sm:inline">Aide</span>
        </Link>
        {/* `persist` : dans l'espace applicatif, le thème choisi ici est aussi
            enregistré sur le compte, pour rester cohérent avec /compte/preferences. */}
        <ThemeToggle persist />
        {isPending ? (
          <span className="opacity-50">…</span>
        ) : session?.user ? (
          // L'AVATAR est le point d'entrée de tout ce qui n'est pas un projet
          // (ADR-0016 §1) : Tableau de bord · Mon compte · Organisation ·
          // Abonnement · Administration · Déconnexion.
          <UserMenu email={session.user.email} canReadAdmin={operateur} />
        ) : null}
      </div>
    </header>
  );
}
