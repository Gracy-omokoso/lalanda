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

import { useEffect, useState } from 'react';

import { applyThemePreference, type ResolvedTheme } from '@/lib/theme';

function readTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset['theme'];
  return attr === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle({ persist = false }: { persist?: boolean }): React.ReactElement {
  // Éviter l'hydration mismatch : on démarre en "light" côté serveur,
  // puis on lit l'état réel après le mount.
  const [theme, setTheme] = useState<ResolvedTheme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
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
      aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
      title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm transition hover:bg-[var(--surface-muted)]"
    >
      <span aria-hidden="true">{mounted && theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
