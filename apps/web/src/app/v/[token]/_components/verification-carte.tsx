'use client';

// Page publique de vérification d'une carte de service — ADR-0069 § 4.
//
// Une colonne lisible sur téléphone (on y arrive en scannant le QR). Le statut est
// dit en TEXTE, la couleur n'est qu'un renfort. Ni matricule, ni service, ni
// coordonnées : seulement ce qui permet de reconnaître la personne.

import { BadgeCheck, CircleSlash, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { verifierCarte, type PublicCardView } from '@/lib/api-hr-cards';

type Etat = PublicCardView | { erreur: 'reseau' | 'debit' } | null;

export function VerificationCarte({ token }: { token: string }): React.ReactElement {
  const [etat, setEtat] = useState<Etat>(null);

  useEffect(() => {
    let annule = false;
    void verifierCarte(token).then((r) => {
      if (!annule) setEtat(r);
    });
    return () => {
      annule = true;
    };
  }, [token]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-10">
      <p className="text-center text-xs uppercase tracking-[0.2em] text-[var(--foreground-muted)]">
        Vérification d’une carte de service
      </p>
      <div
        role="status"
        aria-live="polite"
        className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
      >
        {etat === null ? (
          <p className="text-center text-sm text-[var(--foreground-muted)]">
            Vérification en cours…
          </p>
        ) : 'erreur' in etat ? (
          <p className="text-center text-sm">
            {etat.erreur === 'debit'
              ? 'Trop de vérifications depuis cet appareil. Réessayez dans une minute.'
              : 'Vérification impossible pour le moment : vérifiez votre connexion et réessayez.'}
          </p>
        ) : !etat.valid ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <ShieldAlert aria-hidden="true" className="h-12 w-12 text-[var(--danger)]" />
            <h1 className="text-xl font-semibold">Carte non valide</h1>
            <p className="text-sm text-[var(--foreground-muted)]">
              Cette carte n’est pas reconnue : elle a pu être remplacée, révoquée ou falsifiée. Ne
              vous fiez pas à ce qui y est imprimé.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            {etat.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée de l'API
              <img
                src={etat.organization.logoUrl}
                alt={etat.organization.name}
                className="h-12 max-w-[60%] object-contain"
              />
            ) : null}
            <p className="text-sm font-medium">{etat.organization.name}</p>
            {etat.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL de l'API, jeton requis
              <img
                src={etat.photoUrl}
                alt={`Photo de ${etat.displayName}`}
                className="h-36 w-28 rounded-[var(--radius-md)] object-cover"
              />
            ) : null}
            <div>
              <h1 className="text-2xl font-semibold">{etat.displayName}</h1>
              <p className="text-[var(--foreground-muted)]">{etat.jobTitle}</p>
            </div>
            <p
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold ${
                etat.status === 'active'
                  ? 'border-[var(--success)]/40 text-[var(--success)]'
                  : 'border-[var(--warn)]/60 text-[var(--foreground)]'
              }`}
            >
              {etat.status === 'active' ? (
                <BadgeCheck aria-hidden="true" className="h-4 w-4" />
              ) : (
                <CircleSlash aria-hidden="true" className="h-4 w-4" />
              )}
              {etat.statusLabel}
            </p>
            <p className="text-xs text-[var(--foreground-muted)]">
              Vérifié le {new Date(etat.checkedAt).toLocaleString('fr-FR')}
            </p>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-[var(--foreground-muted)]">
        Vérification fournie par Lalanda pour le compte de l’organisation émettrice.
      </p>
    </main>
  );
}
