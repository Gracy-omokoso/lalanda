'use client';

// Toggle light/dark simple, sans dépendance externe.
// Le thème initial est appliqué par le script inline dans layout.tsx (évite le FOUC).
// Ici on synchronise juste l'état React et localStorage sur clic.

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset['theme'];
  return attr === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle(): React.ReactElement {
  // Éviter l'hydration mismatch : on démarre en "light" côté serveur,
  // puis on lit l'état réel après le mount.
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset['theme'] = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* Safari mode privé, iframe cross-origin, etc. — dégradation silencieuse */
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
