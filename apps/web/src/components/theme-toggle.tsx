'use client';

// Toggle light/dark simple, sans dépendance externe.
// Le thème initial est appliqué par le script inline dans layout.tsx (évite le FOUC).
// La mécanique d'application (document + localStorage) vit dans `@/lib/theme`.
//
// `persist` (S20b) : dans l'espace applicatif, le choix est aussi enregistré sur
// le compte, si bien qu'il suit l'utilisateur d'un appareil à l'autre et que la
// page /compte/preferences affiche la même chose. Le bascule reste purement
// local sur les pages publiques et d'authentification, où il n'y a pas de compte
// à écrire — d'où un opt-in explicite plutôt qu'un appel réseau systématique.
//
// ADR-0055 : sous le thème Ébène, toujours sombre, le bouton est désactivé et
// dit pourquoi (le choix se fait dans Mon compte › Préférences). Il suit les
// attributs de <html> : un thème changé ailleurs dans la page s'y reflète.

import { useEffect, useState } from 'react';

import { IconeLune, IconeSoleil } from '@/components/icons';
import { applyThemePreference, type ResolvedTheme } from '@/lib/theme';

function readTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset['theme'];
  return attr === 'dark' ? 'dark' : 'light';
}

function readForcedDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset['uiTheme'] === 'ebene';
}

export function ThemeToggle({ persist = false }: { persist?: boolean }): React.ReactElement {
  // Éviter l'hydration mismatch : on démarre en "light" côté serveur,
  // puis on lit l'état réel après le mount.
  const [theme, setTheme] = useState<ResolvedTheme>('light');
  const [mounted, setMounted] = useState(false);
  const [forcedDark, setForcedDark] = useState(false);

  useEffect(() => {
    const sync = (): void => {
      setTheme(readTheme());
      setForcedDark(readForcedDark());
    };
    sync();
    setMounted(true);
    // Préférences ou synchronisation du compte peuvent changer le thème après
    // le montage : on suit les attributs plutôt que de garder une copie périmée.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ui-theme'],
    });
    return () => observer.disconnect();
  }, []);

  function toggle(): void {
    const next: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyThemePreference(next);
    if (persist) {
      // Écriture au mieux : le thème est DÉJÀ appliqué localement. Un échec
      // réseau ne doit ni annuler le geste ni afficher une erreur pour un
      // réglage d'apparence — la page Préférences reste l'endroit où le
      // constater et le corriger.
      void import('@/lib/api').then(({ api }) => api.setAccountTheme(next).catch(() => undefined));
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={forcedDark}
      aria-label={
        forcedDark
          ? 'Mode clair indisponible : le thème Ébène est toujours sombre'
          : theme === 'dark'
            ? 'Passer en mode clair'
            : 'Passer en mode sombre'
      }
      title={
        forcedDark
          ? 'Ébène est toujours sombre — changez de thème dans Mon compte › Préférences'
          : theme === 'dark'
            ? 'Mode clair'
            : 'Mode sombre'
      }
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {/* Icônes au trait plutôt qu'emoji : un emoji est dessiné par la police du
          système — il change d'aspect d'une plateforme à l'autre, arrive en
          couleur dans une interface qui n'en a pas et ignore la graisse des
          traits voisins. Le SVG suit `currentColor` et l'épaisseur du reste.
          Avant le montage, `theme` vaut encore « light » côté serveur : on
          affiche donc la lune, cohérente avec le rendu initial (pas de
          clignotement d'hydratation). */}
      {mounted && theme === 'dark' ? (
        <IconeSoleil className="h-4 w-4" />
      ) : (
        <IconeLune className="h-4 w-4" />
      )}
    </button>
  );
}
