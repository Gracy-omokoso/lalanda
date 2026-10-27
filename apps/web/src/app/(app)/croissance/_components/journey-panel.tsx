'use client';

// Parcours (Startup Journey, ADR-0032 § 5) : étape suggérée par des règles
// explicites, étape déclarée par l'utilisateur, conditions et checklists.
// Ouvert à toutes les offres : aucun indicateur financier n'y est calculé.

import { useCallback, useEffect, useState } from 'react';

import {
  growApi,
  JOURNEY_STAGES,
  type GrowJourneyResponse,
  type GrowProfileResponse,
  type JourneyStage,
  type JourneyStageView,
} from '@/lib/grow-api';

import { useAccesCroissance } from './grow-chrome';
import { LIBELLES_ETAPES, libelleEtat, messageErreur } from './grow-model';
import { Bloc, Chargement, Erreur, Pastille } from './grow-ui';

export function JourneyPanel(): React.ReactElement {
  const acces = useAccesCroissance();
  const [vue, setVue] = useState<GrowJourneyResponse | null>(null);
  const [profil, setProfil] = useState<GrowProfileResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      const [j, p] = await Promise.all([growApi.getJourney(), growApi.getProfile()]);
      setVue(j);
      setProfil(p);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger le parcours.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function declarer(stage: JourneyStage | null): Promise<void> {
    if (!profil) return;
    setMessage(null);
    try {
      await growApi.putProfile({
        referenceProjectId: profil.referenceProjectId,
        declaredStage: stage,
        recurringCatalogItemIds: profil.recurringCatalogItemIds,
      });
      await charger();
    } catch (err) {
      setMessage(messageErreur(err, 'Enregistrement impossible.'));
    }
  }

  async function cocher(itemId: string, done: boolean): Promise<void> {
    setMessage(null);
    try {
      await growApi.putChecklist(itemId, done);
      await charger();
    } catch (err) {
      setMessage(messageErreur(err, 'Enregistrement impossible.'));
    }
  }

  if (chargement && !vue) return <Chargement />;
  if (erreur || !vue || !profil) {
    return <Erreur message={erreur ?? 'Parcours indisponible.'} onRetry={() => void charger()} />;
  }

  const { journey } = vue;
  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="doc-card flex flex-col gap-1 px-4 py-3">
          <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] opacity-70">
            Étape retenue
          </span>
          <span className="text-xl font-semibold">{LIBELLES_ETAPES[journey.retenue]}</span>
          <span className="text-xs opacity-70">
            {journey.declaree ? 'Déclarée par vous' : 'Suggérée par vos données'}
          </span>
        </div>
        <div className="doc-card flex flex-col gap-1 px-4 py-3">
          <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] opacity-70">
            Étape suggérée
          </span>
          <span className="text-xl font-semibold">{LIBELLES_ETAPES[journey.suggeree]}</span>
          <span className="text-xs opacity-70">Règles {journey.reglesVersion}</span>
        </div>
        <div className="doc-card flex flex-col gap-2 px-4 py-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] opacity-70">
              Votre étape
            </span>
            <select
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-60"
              value={journey.declaree ?? ''}
              disabled={!acces.declarer}
              onChange={(e) =>
                void declarer(e.target.value === '' ? null : (e.target.value as JourneyStage))
              }
            >
              <option value="">Suivre la suggestion</option>
              {JOURNEY_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LIBELLES_ETAPES[s]}
                </option>
              ))}
            </select>
          </label>
          {!acces.declarer ? (
            <span className="text-xs opacity-70">Consultation seule pour votre rôle.</span>
          ) : null}
        </div>
      </section>

      {journey.ecart ? (
        <p className="rounded-md border border-[var(--warn)] p-3 text-sm">
          Vous avez déclaré «&nbsp;{LIBELLES_ETAPES[journey.retenue]}&nbsp;», vos données suggèrent
          «&nbsp;{LIBELLES_ETAPES[journey.suggeree]}&nbsp;». Votre déclaration est retenue ; les
          conditions ci-dessous montrent ce que les données établissent.
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      ) : null}

      <Bloc titre="Les huit étapes">
        <ol className="flex flex-col gap-3">
          {journey.etapes.map((e) => (
            <Etape
              key={e.etape}
              etape={e}
              retenue={e.etape === journey.retenue}
              peutCocher={acces.declarer}
              onCocher={(id, done) => void cocher(id, done)}
            />
          ))}
        </ol>
      </Bloc>
    </div>
  );
}

function Etape({
  etape,
  retenue,
  peutCocher,
  onCocher,
}: {
  etape: JourneyStageView;
  retenue: boolean;
  peutCocher: boolean;
  onCocher: (id: string, done: boolean) => void;
}): React.ReactElement {
  return (
    <li
      className={`doc-card flex flex-col gap-3 px-4 py-3 ${retenue ? 'ring-1 ring-[var(--accent)]' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{etape.libelle}</h3>
        <div className="flex gap-1">
          {retenue ? <Pastille ton="accent">Étape retenue</Pastille> : null}
          {!etape.suggerable ? (
            <Pastille ton="neutre">Déclarée seulement</Pastille>
          ) : etape.atteinte ? (
            <Pastille ton="ok">Conditions remplies</Pastille>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.06em] opacity-70">
            Conditions
          </span>
          {etape.conditions.length === 0 ? (
            <p className="text-xs text-[var(--foreground-muted)]">Point de départ : aucune.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {etape.conditions.map((c) => (
                <li key={c.code}>
                  <span className="font-medium">{c.libelle}</span> : {c.valeur ?? '—'} (seuil{' '}
                  {c.seuil}) — {libelleEtat(c.etat)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.06em] opacity-70">
            Checklist
          </span>
          <ul className="flex flex-col gap-1 text-sm">
            {etape.checklist.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                {i.mode === 'manuel' ? (
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={i.libelle}
                    checked={i.fait === true}
                    disabled={!peutCocher}
                    onChange={(e) => onCocher(i.id, e.target.checked)}
                  />
                ) : (
                  <span aria-hidden="true" className="mt-0.5 w-4 text-center">
                    {i.fait === true ? '✓' : i.fait === false ? '○' : '?'}
                  </span>
                )}
                <span>
                  {i.libelle}
                  {i.mode === 'auto' ? (
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {' '}
                      — vérifié par vos données :{' '}
                      {i.fait === true ? 'fait' : i.fait === false ? 'pas encore' : 'inconnu'}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}
