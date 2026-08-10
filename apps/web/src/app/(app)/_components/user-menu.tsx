'use client';

// Menu du compte (S20b, refondu par ADR-0016 E1/E3).
//
// C'est le point d'entrée UNIQUE vers tout ce qui n'est pas un projet :
// Tableau de bord · Mon compte · Organisation · Abonnement · Administration ·
// Déconnexion. Avant, trois de ces destinations vivaient dans la barre avec
// `hidden sm:inline` — donc INATTEIGNABLES sous 640 px, sans autre chemin. Le
// menu, lui, existe à toutes les largeurs.
//
// Le déclencheur est l'AVATAR (photo à venir, initiales aujourd'hui) et non plus
// l'adresse email. Le contenu et l'ordre des entrées vivent dans
// `user-menu-model.ts`, testé sans DOM.
//
// CLAVIER (docs/04 § Accessibilité — « navigation clavier complète »).
// Rien de ce tableau ne doit régresser, l'ajout d'entrées et de séparateurs ne
// change aucune de ces règles :
//   Entrée / Espace  ouvrent (comportement natif du <button>)
//   ↓ / ↑            sur le déclencheur : ouvrent ET placent le focus sur le
//                    premier / dernier élément
//   ↓ / ↑            dans le menu : circulent
//   Début / Fin      vont aux extrémités
//   Tab              sort du menu ET le ferme (un menu ouvert derrière le focus
//                    est une zone morte à l'écran)
//   Échap            ferme ET REND LE FOCUS au déclencheur
// Sans le retour de focus sur Échap, la tabulation repartirait du début du
// document : on perdrait sa place à chaque ouverture accidentelle.
//
// La collecte des éléments navigables interroge le DOM (`[role="menuitem"]`),
// elle reste donc juste quand « Administration » disparaît — À CONDITION que
// seules les vraies entrées portent ce rôle. L'en-tête d'identité et les
// séparateurs n'en portent pas et ne sont pas focusables : sinon la circulation
// clavier aurait des trous où il n'y a rien à activer.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { oublierProfil, useProfil } from './profile-context';
import { entreeActive, entreesMenu, libelleDeclencheur, separateurAvant } from './user-menu-model';

export function UserMenu({
  email,
  canReadAdmin,
}: {
  email: string;
  /**
   * `GET /me/platform-access`, déjà chargé par le header. Le menu n'émet aucun
   * appel supplémentaire au titre de la visibilité, et ne déduit AUCUN droit
   * d'un rôle qu'il aurait recopié (ADR-0012 §8) : masquer est un confort, le
   * contrôle est `PermissionsGuard` côté API.
   */
  canReadAdmin: boolean;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const { profil } = useProfil();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = entreesMenu({ canReadAdmin });
  const actif = entreeActive(pathname, items);

  const close = useCallback((focusTrigger: boolean): void => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  /** Éléments focusables du menu, dans l'ordre visuel. */
  function elements(): HTMLElement[] {
    const root = menuRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  function openAt(position: 'first' | 'last'): void {
    setOpen(true);
    // Après le rendu : les éléments n'existent pas encore au moment du clic.
    requestAnimationFrame(() => {
      const list = elements();
      (position === 'first' ? list[0] : list[list.length - 1])?.focus();
    });
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const list = elements();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // On laisse la tabulation faire son travail, mais le menu se referme :
      // un menu ouvert derrière le focus est une zone morte à l'écran.
      setOpen(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      const { signOut } = await import('@/lib/auth-client');
      await signOut();
      // Le profil de la personne qui part ne doit pas rester en cache pour
      // celle qui se connecte ensuite.
      oublierProfil();
      setOpen(false);
      router.push('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const nom = profil?.name?.trim() ?? '';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        // Le nom accessible porte l'IDENTITÉ : l'avatar est `aria-hidden`, donc
        // c'est la seule chose qu'un lecteur d'écran entend de ce bouton.
        aria-label={libelleDeclencheur({ nom, email })}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 pr-2 transition hover:bg-[var(--surface-muted)]"
      >
        <Avatar
          initiales={profil?.initials ?? null}
          photoUrl={profil?.avatarUrl ?? null}
          taille="sm"
        />
        <span aria-hidden="true" className="text-xs opacity-50">
          ▾
        </span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          // Largeur bornée par la fenêtre : à 375 px le panneau tient dans
          // l'écran sans provoquer de défilement horizontal. Hauteur bornée
          // aussi, avec défilement INTERNE à la liste — l'en-tête d'identité
          // reste visible pendant qu'on fait défiler les entrées.
          className="absolute right-0 z-20 mt-2 flex w-[min(19rem,calc(100vw-2rem))] max-h-[min(30rem,calc(100vh-6rem))] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          {/* En-tête d'identité — INERTE : aucun `role="menuitem"`, aucun
              élément focusable. Il informe, il ne s'active pas. */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 py-3">
            <Avatar
              initiales={profil?.initials ?? null}
              photoUrl={profil?.avatarUrl ?? null}
              taille="md"
            />
            <div className="flex min-w-0 flex-col leading-tight">
              {nom ? <span className="truncate text-sm font-medium">{nom}</span> : null}
              <span className="truncate text-xs text-[var(--foreground-muted)]">{email}</span>
            </div>
          </div>

          <div role="menu" aria-label="Mon compte" className="flex-1 overflow-y-auto py-1">
            {/* Les enfants directs de `role="menu"` sont EXCLUSIVEMENT des
                `menuitem` et des `separator` — pas de div d'emballage : un
                conteneur sans rôle au milieu d'un menu casse l'arbre
                d'accessibilité. D'où le Fragment. */}
            {items.map((item, i) => (
              <Fragment key={item.id}>
                {separateurAvant(items, i) ? (
                  // `role="separator"` : annoncé comme une frontière, jamais
                  // atteint par la circulation clavier.
                  <div role="separator" className="my-1 border-t border-[var(--border)]" />
                ) : null}

                {item.kind === 'link' ? (
                  <Link
                    href={item.href}
                    role="menuitem"
                    // Même règle que les onglets : l'entrée courante est
                    // annoncée, l'information ne repose pas sur la seule couleur.
                    aria-current={actif === item.id ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={[
                      'flex flex-col gap-0.5 px-3 py-2 text-sm transition hover:bg-[var(--surface-muted)]',
                      actif === item.id
                        ? 'border-l-2 border-[var(--accent)] bg-[var(--surface-muted)] pl-[0.625rem]'
                        : '',
                    ].join(' ')}
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">{item.hint}</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={signingOut}
                    onClick={() => void handleSignOut()}
                    className="w-full px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    {signingOut ? 'Déconnexion…' : item.label}
                  </button>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pastille d'identité — deux tailles, deux emplacements, et deux seulement
 * (ADR-0016 §7) : le déclencheur dans la barre et l'en-tête du panneau ouvert.
 * Le grand format reste sur `/compte`.
 *
 * DIMENSIONS FIXES, quel que soit le contenu. C'est ce qui garantit que la barre
 * ne bouge pas entre le premier rendu (pastille neutre) et l'arrivée des
 * initiales — et, le jour venu, l'arrivée de la photo.
 *
 * PENDANT LE CHARGEMENT, LA PASTILLE RESTE NEUTRE : aucune lettre. Afficher des
 * initiales provisoires calculées depuis l'adresse puis les remplacer par celles
 * du profil serait exactement le défaut qu'on corrige — en pire, parce que
 * visible à chaque chargement de page.
 *
 * LES INITIALES SONT SOUS L'IMAGE, toujours rendues. L'image se pose par-dessus
 * en `object-cover`. Trois raisons, et chacune se produit :
 *   - l'URL porte un jeton à durée limitée; elle peut expirer PENDANT que la
 *     page est ouverte, et `onError` est alors le seul filet;
 *   - le magasin d'objets peut tomber, ce que le profil ne sait pas au moment
 *     où il sert l'URL;
 *   - entre le rendu et l'arrivée des octets, il y a un délai — sans les
 *     initiales dessous, ce serait un trou.
 * L'absence de photo n'est PAS un état d'erreur : ni bordure pointillée, ni
 * point d'interrogation. Les initiales sont l'état normal du produit.
 *
 * `<img>` natif et non `next/image` : l'URL est signée, éphémère et sur une
 * autre origine — l'optimiseur de Next la re-téléchargerait côté serveur pour
 * la mettre en cache, ce qui est exactement ce qu'un jeton à durée limitée
 * interdit.
 */
function Avatar({
  initiales,
  photoUrl,
  taille,
}: {
  initiales: string | null;
  photoUrl: string | null;
  taille: 'sm' | 'md';
}): React.ReactElement {
  const [photoCassee, setPhotoCassee] = useState(false);
  const dimensions =
    taille === 'sm' ? 'h-7 w-7 text-[0.6rem] border' : 'h-10 w-10 text-xs border-2';

  // Une nouvelle URL mérite une nouvelle chance : sans cette remise à zéro, une
  // photo remplacée après un échec resterait masquée jusqu'au rechargement.
  useEffect(() => {
    setPhotoCassee(false);
  }, [photoUrl]);

  return (
    <span
      // L'identité est déjà dans le nom accessible du bouton (déclencheur) et
      // dans le texte voisin (panneau) : la répéter serait du bruit.
      aria-hidden="true"
      className={`font-display relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-[var(--accent)] bg-[var(--surface)] font-black text-[var(--accent)] ${dimensions}`}
    >
      {initiales ?? ''}
      {photoUrl !== null && !photoCassee ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          onError={() => setPhotoCassee(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
