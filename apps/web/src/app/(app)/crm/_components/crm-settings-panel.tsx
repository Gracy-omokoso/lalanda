'use client';

// Réglages du pipeline — ADR-0035 § 2 : étapes (libellés, ordre, ajout,
// retrait), règle de gain à l'acceptation d'un devis, seuil d'inactivité.
// Le serveur refuse de retirer une étape utilisée ou d'en changer la nature.

import { buttonClasses } from '@lalanda/ui';
import { useEffect, useState } from 'react';

import { crmApi, type CrmSettingsView, type PipelineStage } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';
import { useAccesCrm } from './crm-access';

import { messageCrm, peutGererCrm } from './crm-model';

const NATURES: Record<PipelineStage['kind'], string> = {
  open: 'En cours',
  won: 'Gagnée',
  lost: 'Perdue',
};

function cleDepuis(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

export function CrmSettingsPanel(): React.ReactElement {
  const { actions } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [s, setS] = useState<CrmSettingsView | null>(null);
  const [existantes, setExistantes] = useState<Set<string>>(new Set());
  const [nouvelle, setNouvelle] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    crmApi
      .getSettings()
      .then((v) => {
        setS(v);
        setExistantes(new Set(v.stages.map((x) => x.key)));
      })
      .catch((err) => setErreur(messageCrm(err, 'Réglages illisibles.')));
  }, []);

  if (s === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
    );
  }

  const deplacer = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= s.stages.length) return;
    const stages = [...s.stages];
    [stages[i], stages[j]] = [stages[j]!, stages[i]!];
    setS({ ...s, stages });
  };

  async function enregistrer(): Promise<void> {
    if (!s) return;
    setErreur(null);
    setInfo(null);
    try {
      const v = await crmApi.putSettings({
        expectedRevision: s.revision,
        stages: s.stages,
        autoWinOnQuoteAccepted: s.autoWinOnQuoteAccepted,
        staleAfterDays: s.staleAfterDays,
      });
      setS(v);
      setExistantes(new Set(v.stages.map((x) => x.key)));
      setInfo('Réglages enregistrés.');
    } catch (err) {
      setErreur(messageCrm(err, 'Enregistrement impossible.'));
    }
  }

  return (
    <section className="flex flex-col gap-5">
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info ? (
        <p role="status" className="text-sm">
          {info}
        </p>
      ) : null}
      <fieldset disabled={!gerer} className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Étapes du pipeline</legend>
        <ol className="flex flex-col gap-2">
          {s.stages.map((st, i) => (
            <li key={st.key} className="flex flex-wrap items-center gap-2 text-sm">
              <input
                aria-label={`Libellé de l’étape ${i + 1}`}
                className={`${CHAMP} max-w-xs`}
                value={st.label}
                maxLength={40}
                onChange={(e) =>
                  setS({
                    ...s,
                    stages: s.stages.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)),
                  })
                }
              />
              {existantes.has(st.key) ? (
                <span className="text-xs text-[var(--foreground-muted)]">{NATURES[st.kind]}</span>
              ) : (
                <select
                  aria-label={`Nature de l’étape ${i + 1}`}
                  className={`${CHAMP} max-w-[10rem]`}
                  value={st.kind}
                  onChange={(e) =>
                    setS({
                      ...s,
                      stages: s.stages.map((x, n) =>
                        n === i ? { ...x, kind: e.target.value as PipelineStage['kind'] } : x,
                      ),
                    })
                  }
                >
                  <option value="open">En cours</option>
                </select>
              )}
              <button
                type="button"
                className={BOUTON_PETIT}
                onClick={() => deplacer(i, -1)}
                aria-label="Monter"
              >
                ↑
              </button>
              <button
                type="button"
                className={BOUTON_PETIT}
                onClick={() => deplacer(i, 1)}
                aria-label="Descendre"
              >
                ↓
              </button>
              {st.kind === 'open' ? (
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  onClick={() => setS({ ...s, stages: s.stages.filter((_, n) => n !== i) })}
                >
                  Retirer
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Nouvelle étape"
            placeholder="Nouvelle étape (ex. Démonstration)"
            className={`${CHAMP} max-w-xs`}
            value={nouvelle}
            maxLength={40}
            onChange={(e) => setNouvelle(e.target.value)}
          />
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={cleDepuis(nouvelle) === ''}
            onClick={() => {
              const key = cleDepuis(nouvelle);
              if (s.stages.some((x) => x.key === key)) return;
              const firstClosed = s.stages.findIndex((x) => x.kind !== 'open');
              const stages = [...s.stages];
              stages.splice(firstClosed === -1 ? stages.length : firstClosed, 0, {
                key,
                label: nouvelle.trim(),
                kind: 'open',
              });
              setS({ ...s, stages });
              setNouvelle('');
            }}
          >
            Ajouter l’étape
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.autoWinOnQuoteAccepted}
            onChange={(e) => setS({ ...s, autoWinOnQuoteAccepted: e.target.checked })}
          />
          Passer l’opportunité à « gagnée » quand son devis est accepté
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Opportunité inactive après
          <input
            type="number"
            min={1}
            max={365}
            className={`${CHAMP} w-24`}
            value={s.staleAfterDays}
            onChange={(e) =>
              setS({ ...s, staleAfterDays: Math.trunc(e.target.valueAsNumber || 1) })
            }
          />
          jours sans activité
        </label>
        {gerer ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md', 'self-start')}
            onClick={() => void enregistrer()}
          >
            Enregistrer les réglages
          </button>
        ) : null}
      </fieldset>
    </section>
  );
}
