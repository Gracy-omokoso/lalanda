'use client';

// Événements de sécurité agrégés de la plateforme (ADR-0053 § 6.5 — lot P5).
//
// Des COMPTES par jour et par nature : refus sur la console, ré-authentifications,
// sessions de comptes bloqués, blocages, rôles attribués, exports. Aucun identifiant,
// aucune adresse, aucune organisation — l'API n'en sert pas.

import { useEffect, useState } from 'react';

import { api, type PlatformSecuritySummaryView } from '@/lib/api';

import { Bandeau, Compteur, Vide } from './admin-chrome';
import { messageErreur } from './admin-model';
import { LIMITE_SECURITE, joursActifs, lignesSecurite } from './journal-model';

export function SecurityEventsPanel(): React.ReactElement {
  const [resume, setResume] = useState<PlatformSecuritySummaryView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    api
      .getPlatformSecurityEvents()
      .then((r) => {
        if (actif) setResume(r);
      })
      .catch((err: unknown) => {
        if (actif)
          setErreur(messageErreur(err, 'Impossible de charger les événements de sécurité.'));
      });
    return () => {
      actif = false;
    };
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold">Événements de sécurité</h2>
        <p className="max-w-2xl text-xs text-[var(--foreground-muted)]">
          {resume
            ? `Du ${resume.from} au ${resume.to} (UTC). Des comptes seulement, sans identifiant ni adresse.`
            : 'Trente derniers jours. Des comptes seulement, sans identifiant ni adresse.'}{' '}
          {LIMITE_SECURITE}
        </p>
      </div>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      {!resume ? (
        erreur ? null : (
          <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Compteur libelle="Comptes bloqués à l’instant" valeur={resume.blockedAccountsNow} />
            {lignesSecurite(resume).map((l) => (
              <Compteur
                key={l.kind}
                libelle={l.libelle}
                valeur={l.total}
                precision={l.source === 'audit' ? 'Compté au journal' : 'Relevé sur les réponses'}
              />
            ))}
          </div>
          {joursActifs(resume).length === 0 ? (
            <Vide>Aucun événement de sécurité sur la période.</Vide>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {joursActifs(resume).map((j) => (
                <li
                  key={j.day}
                  className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-[var(--border)] px-3 py-2"
                >
                  <span className="font-mono text-xs">{j.day}</span>
                  {j.detail.map((d) => (
                    <span key={d.libelle} className="text-xs text-[var(--foreground-muted)]">
                      {d.libelle} : <strong className="text-[var(--foreground)]">{d.n}</strong>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
