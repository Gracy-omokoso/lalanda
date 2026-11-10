'use client';

// Favicon de l'organisation active dans l'espace applicatif (ADR-0073 § 3).
// N'affiche rien ; en cas d'échec (hors ligne, aucun favicon), celui de Lalanda
// reste en place. Changer d'organisation recharge la page
// (`lib/bascule-organisation.ts`) : le favicon suit.

import { useEffect } from 'react';

import { brandApi } from '@/lib/api-brand';
import { applyFavicon } from '@/lib/favicon';

export function OrganizationFavicon(): null {
  useEffect(() => {
    let annule = false;
    void brandApi
      .currentFavicon()
      .then((url) => {
        if (!annule) applyFavicon(url);
      })
      .catch(() => {
        /* favicon Lalanda conservé */
      });
    return () => {
      annule = true;
    };
  }, []);
  return null;
}
