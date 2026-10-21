'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { LIENS_AIDE } from '@/lib/aide/liens';
import { BrandMark } from '@/components/brand-logo';
import { IconeNav } from '@/components/icones-navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from './user-menu';

export function AppHeader({
  onOuvrirNavigation,
}: {
  /** Ouvre le tiroir de navigation (sous 1024 px). Absent : pas de bouton. */
  onOuvrirNavigation?: () => void;
} = {}): React.ReactElement {
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
    // ADR-0030 § 2 : barre du haut de la zone de contenu. Le sélecteur
    // d'organisation et la marque complète sont passés en tête de la barre
    // latérale ; sous 1024 px, ils vivent dans le tiroir ouvert par le bouton
    // « Menu ». La barre tient ainsi dans 360 px sans déborder (audit A2) —
    // l'avatar, porte du menu du compte, n'est plus jamais coupé.
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur sm:px-6 lg:px-8">
      {onOuvrirNavigation ? (
        <button
          type="button"
          onClick={onOuvrirNavigation}
          aria-label="Ouvrir la navigation"
          aria-haspopup="dialog"
          className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] lg:hidden"
        >
          <IconeNav id="menu" className="h-5 w-5" />
        </button>
      ) : null}
      {/* `aria-label` explicite, et image décorative : le nom du lien ne doit
          pas dépendre de la largeur (ADR-0016, « Identité visuelle »). Sur
          grand écran la marque est dans la barre latérale : ici, l'aigle seul,
          et seulement sous 1024 px. */}
      <Link
        href="/projects"
        aria-label="Lalanda — plans financiers"
        className="flex shrink-0 items-center transition hover:opacity-80 lg:hidden"
      >
        <BrandMark taille={28} />
      </Link>

      <div className="flex-1" />

      {/* RÈGLE (ADR-0016 §6) : aucun lien de cette barre ne porte `hidden sm:*`
          s'il n'a pas d'autre chemin d'accès. */}
      <div className="flex items-center gap-2 text-sm sm:gap-3">
        {/* Le centre d'aide est la seule entrée permanente vers le glossaire et
            l'explication des ratios. Sous 640 px il se réduit à une icône, mais
            JAMAIS à une icône muette : `aria-label` porte le nom. */}
        <Link
          href={LIENS_AIDE.centre}
          aria-label="Aide"
          title="Aide"
          className="text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
        >
          <span
            aria-hidden="true"
            className="font-display inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] text-xs font-bold sm:hidden"
          >
            ?
          </span>
          <span className="hidden sm:inline">Aide</span>
        </Link>
        {/* `persist` : dans l'espace applicatif, le thème choisi ici est aussi
            enregistré sur le compte, pour rester cohérent avec /compte/preferences. */}
        <ThemeToggle persist />
        {isPending ? (
          // Pastille neutre, dimensions fixes : la barre ne bouge pas au chargement.
          <span aria-hidden="true" className="h-8 w-8 rounded-full bg-[var(--surface-muted)]" />
        ) : session?.user ? (
          // L'AVATAR ouvre le menu du compte, inchangé (ADR-0016 §1).
          <UserMenu email={session.user.email} canReadAdmin={operateur} />
        ) : null}
      </div>
    </header>
  );
}
