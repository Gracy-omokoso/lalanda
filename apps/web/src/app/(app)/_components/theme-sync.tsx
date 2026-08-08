'use client';

// Synchronisation du thème enregistré sur le compte (S20b).
//
// POURQUOI CE COMPOSANT EXISTE.
// Le script inline de `app/layout.tsx` applique, avant le premier paint, le
// thème mémorisé dans `localStorage` — ce qui est bon pour la vitesse mais
// ignore le compte. Sur un appareil neuf, ou après vidage du stockage, le
// réglage choisi sur /compte/preferences serait perdu : la préférence ne serait
// « persistée serveur » que de nom.
//
// Ce composant lit la préférence UNE FOIS au montage de l'espace applicatif et
// l'applique. L'ordre est délibéré : rendu immédiat avec la valeur locale (pas
// de page blanche en attendant le réseau), correction ensuite si le compte dit
// autre chose. Un utilisateur dont les deux valeurs coïncident — le cas courant —
// ne voit strictement rien.
//
// N'affiche rien et ne bloque rien : en cas d'échec (hors ligne, session
// expirée), le thème local reste en place. Un réglage d'apparence ne justifie ni
// un écran d'erreur ni un rendu retardé.

import { useEffect } from 'react';

import { api } from '@/lib/api';
import { applyThemePreference } from '@/lib/theme';

export function ThemeSync(): null {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // `/account/preferences` ne dépend d'AUCUNE organisation (ADR-0012,
        // risque n°2) : cet appel fonctionne aussi pour un compte qui n'en a
        // plus aucune, là où les routes métier répondraient 403.
        const prefs = await api.getAccountPreferences();
        if (!cancelled) applyThemePreference(prefs.theme);
      } catch {
        /* thème local conservé */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
