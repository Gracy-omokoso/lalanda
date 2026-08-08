'use client';

// Menu utilisateur du header (S20b) : Profil · Sécurité · Préférences · Déconnexion.
//
// Le déclencheur est l'ADRESSE EMAIL de l'utilisateur, qui était déjà affichée
// mais inerte. Elle devient le point d'entrée de l'espace compte : c'est là que
// l'utilisateur cherche ses propres réglages, et cela évite d'ajouter un
// sixième élément dans une barre déjà chargée.
//
// CLAVIER (docs/04 § Accessibilité — « navigation clavier complète ») :
//   Entrée / Espace  ouvre le menu (comportement natif du <button>)
//   ↓ / ↑            ouvre le menu et se place sur le premier / dernier élément
//   Échap            ferme et REND LE FOCUS au déclencheur
//   Tab              sort du menu et le ferme
// Sans le retour de focus sur Échap, la tabulation repartirait du début du
// document : on perdrait sa place à chaque ouverture accidentelle.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface MenuEntry {
  href: string;
  label: string;
  /** Court rappel de ce que la section contient, pour ne pas deviner. */
  hint: string;
}

/** Même ordre que les onglets de `/compte` — l'utilisateur retrouve sa carte. */
const ENTRIES: MenuEntry[] = [
  { href: '/compte', label: 'Profil', hint: 'Nom, langue, fuseau, adresse email' },
  { href: '/compte/securite', label: 'Sécurité', hint: 'Mot de passe, sessions actives' },
  { href: '/compte/preferences', label: 'Préférences', hint: 'Thème, devise, notifications' },
];

export function UserMenu({ email }: { email: string }): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
  function items(): HTMLElement[] {
    const root = menuRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  function openAt(position: 'first' | 'last'): void {
    setOpen(true);
    // Après le rendu : les éléments n'existent pas encore au moment du clic.
    requestAnimationFrame(() => {
      const list = items();
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
    const list = items();
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
      setOpen(false);
      router.push('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu du compte — ${email}`}
        className="inline-flex max-w-[13rem] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm transition hover:bg-[var(--surface-muted)]"
      >
        <span
          aria-hidden="true"
          className="font-display inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--accent)] text-[0.6rem] font-black text-[var(--accent)]"
        >
          {initialsOfEmail(email)}
        </span>
        {/* L'adresse complète disparaît sous 640 px : les initiales suffisent, et
            la barre reste utilisable sur mobile (docs/04 § Responsive). */}
        <span className="hidden truncate text-[var(--foreground-muted)] sm:inline">{email}</span>
        <span aria-hidden="true" className="text-xs opacity-50">
          ▾
        </span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Mon compte"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          <p className="truncate border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--foreground-muted)]">
            Connecté en tant que{' '}
            <span className="font-medium text-[var(--foreground)]">{email}</span>
          </p>

          <ul className="py-1">
            {ENTRIES.map((entry) => (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex flex-col gap-0.5 px-3 py-2 text-sm transition hover:bg-[var(--surface-muted)]"
                >
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">{entry.hint}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--border)] p-1">
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              className="w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {signingOut ? 'Déconnexion…' : 'Déconnexion'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Initiales de repli calculées depuis l'adresse.
 *
 * Le header ne connaît que la session better-auth (email, éventuellement nom) et
 * n'appelle PAS `/account/profile` : une requête réseau par page pour deux
 * lettres dans un coin de l'écran serait un mauvais échange. Les initiales
 * calculées côté serveur restent celles du profil, sur la page profil.
 */
export function initialsOfEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter((p) => p.length > 0);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (local.slice(0, 2) || '?').toUpperCase();
}
