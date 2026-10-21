'use client';

// Tableau de bord « Santé » (ADR-0032 § 4) : score, axes, trois risques, trois
// actions. Tout vient du moteur par l'API ; l'écran montre aussi POURQUOI.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { growApi, type GrowHealthResponse, type HealthAxisView } from '@/lib/grow-api';

import {
  appreciation,
  formatRatio,
  LIBELLES_ETAPES,
  libelleGravite,
  messageErreur,
  refusForfait,
} from './grow-model';
import { Bloc, Chargement, EtatVide, Erreur, Pastille, RefusForfait, Sources } from './grow-ui';

export function HealthPanel(): React.ReactElement {
  const [vue, setVue] = useState<GrowHealthResponse | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      setVue(await growApi.getHealth());
      setRefus(null);
    } catch (err) {
      const r = refusForfait(err);
      if (r) setRefus(r);
      else setErreur(messageErreur(err, 'Impossible de calculer la santé de l’entreprise.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement) return <Chargement />;
  if (refus) return <RefusForfait message={refus} />;
  if (erreur || !vue) {
    return <Erreur message={erreur ?? 'Santé indisponible.'} onRetry={() => void charger()} />;
  }

  const { health } = vue;
  const score = health.score;
  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="doc-card flex flex-col gap-2 px-5 py-4">
          <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] opacity-70">
            Score de santé
          </span>
          {score.disponible ? (
            <>
              <span className="fig text-4xl font-semibold">
                {score.valeur}
                <span className="text-lg font-normal opacity-60"> / 100</span>
              </span>
              <Pastille ton={appreciation(score.valeur).ton}>
                {appreciation(score.valeur).texte}
              </Pastille>
              <span className="text-xs opacity-70">
                Axes disponibles : {formatRatio(score.couverture)} du poids.
              </span>
            </>
          ) : (
            <>
              <span className="text-lg font-semibold">Non publié</span>
              <p className="text-sm text-[var(--foreground-muted)]">{score.message}</p>
              {score.manquants.length > 0 ? (
                <p className="text-xs text-[var(--foreground-muted)]">
                  Axes manquants : {score.manquants.join(', ')}.
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-col justify-center gap-2 text-sm text-[var(--foreground-muted)]">
          <p>
            Pondérations du stade «&nbsp;{LIBELLES_ETAPES[health.etape]}&nbsp;» —{' '}
            <Link href="/croissance/parcours" className="underline hover:text-[var(--accent)]">
              modifier l’étape
            </Link>
            .
          </p>
          <p>
            Le score résume des données réelles (réalisé clôturé, ventes, solde déclaré). Il n’est
            jamais complété par une estimation : un axe sans donnée est écarté et le dit.
          </p>
          <p className="font-mono text-[0.65rem] opacity-70">
            {health.baremesVersion} · {health.ponderationsVersion} · {health.risquesVersion} ·
            calcul du {vue.asOf}
          </p>
        </div>
      </section>

      <Bloc titre="Axes">
        <div className="grid gap-3 sm:grid-cols-2">
          {health.axes.map((a) => (
            <Axe key={a.axe} axe={a} />
          ))}
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          Non couverts dans ce lot :{' '}
          {health.axesNonCouverts.map((a) => `${a.libelle} (${a.raison})`).join(' ; ')}
        </p>
      </Bloc>

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloc titre="Risques prioritaires">
          {health.risques.length === 0 ? (
            <EtatVide titre="Aucun risque détecté">
              Les règles de risque ne se sont déclenchées sur aucune donnée disponible.
            </EtatVide>
          ) : (
            <ol className="flex flex-col gap-3">
              {health.risques.map((r) => (
                <li key={r.code} className="doc-card flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.titre}</span>
                    <Pastille
                      ton={r.gravite === 'critique' || r.gravite === 'haute' ? 'ko' : 'warn'}
                    >
                      {libelleGravite(r.gravite)}
                    </Pastille>
                  </div>
                  <p className="text-sm">{r.message}</p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Pourquoi : {r.preuve.donnee} = {r.preuve.valeur}, seuil {r.preuve.seuil} (
                    {r.preuve.regle}).
                  </p>
                  <Sources sources={r.sources} />
                </li>
              ))}
            </ol>
          )}
        </Bloc>

        <Bloc titre="Actions recommandées">
          {health.actions.length === 0 ? (
            <EtatVide titre="Aucune action proposée">
              Rien à signaler sur les données lues.
            </EtatVide>
          ) : (
            <ol className="flex flex-col gap-3">
              {health.actions.map((a) => (
                <li key={a.code} className="doc-card flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.titre}</span>
                    <Pastille ton="neutre">
                      {a.origine === 'risque' ? 'Suite à un risque' : 'Compléter les données'}
                    </Pastille>
                  </div>
                  <p className="text-sm">{a.detail}</p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Pourquoi ce message : {a.pourquoi}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-[var(--foreground-muted)]">
            Règles déterministes et versionnées : aucune de ces recommandations n’est produite par
            une IA, et aucune ne promet un résultat.
          </p>
        </Bloc>
      </div>
    </div>
  );
}

function Axe({ axe }: { axe: HealthAxisView }): React.ReactElement {
  return (
    <div className="doc-card flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{axe.libelle}</span>
        <span className="font-mono text-[0.65rem] opacity-70">poids {axe.poids} %</span>
      </div>
      {axe.note !== null ? (
        <div className="flex items-center gap-2">
          <span className="fig text-2xl font-semibold">{axe.note}</span>
          <Pastille ton={appreciation(axe.note).ton}>{appreciation(axe.note).texte}</Pastille>
        </div>
      ) : (
        <span className="text-sm text-[var(--foreground-muted)]">Indisponible</span>
      )}
      <ul className="flex flex-col gap-1 text-xs">
        {axe.metriques.map((m) => (
          <li key={m.code} className="text-[var(--foreground-muted)]">
            <span className="font-medium text-[var(--foreground)]">{m.libelle}</span>
            {m.note !== null ? ` : note ${Math.round(m.note)}` : ''}
            {m.message ? ` — ${m.message}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
