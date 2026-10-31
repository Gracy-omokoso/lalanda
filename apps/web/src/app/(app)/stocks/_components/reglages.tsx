'use client';

// Réglages des stocks — ADR-0046 § 2.8 : sortie de stock à la vente, stock
// négatif pour les mouvements manuels, rappels d'inventaire, motifs
// d'ajustement. Lecture `stock.read` ; modification `stock.manage`.

import { STOCK_SALES_ISSUE_MODES } from '@lalanda/shared/stock';
import { buttonClasses } from '@lalanda/ui';
import { Plus, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { stockApi, type StockSettingsView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import {
  LIBELLES_MODE_VENTE,
  cleMotif,
  formulaireReglages,
  preparerReglages,
  type FormulaireReglages,
} from './reglages-model';
import { useAccesStocks } from './stocks-access';
import { lire, messageStocks, peutGererStocks, type Lecture } from './stocks-model';
import { Bandeau, Chargement, ChampNombre, EchecLecture, Panneau } from './stocks-ui';

export function Reglages(): React.ReactElement {
  const { actions } = useAccesStocks();
  const gerer = peutGererStocks(actions);
  const [lecture, setLecture] = useState<Lecture<StockSettingsView> | null>(null);
  const [f, setF] = useState<FormulaireReglages | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void lire(stockApi.getSettings()).then((l) => {
      if (annule) return;
      setLecture(l);
      if (l.ok) setF(formulaireReglages(l.valeur));
    });
    return () => {
      annule = true;
    };
  }, [version]);

  if (lecture === null) return <Chargement texte="Chargement des réglages…" />;
  if (!lecture.ok || f === null) {
    return (
      <EchecLecture
        erreur={lecture.ok ? null : lecture.erreur}
        repli="Les réglages sont illisibles."
        onReessayer={() => setVersion((v) => v + 1)}
      />
    );
  }
  const vue = lecture.valeur;
  const maj = (p: Partial<FormulaireReglages>): void => {
    setMessage(null);
    setF((x) => (x ? { ...x, ...p } : x));
  };

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (f === null) return;
    setErreur(null);
    const p = preparerReglages(f, vue.revision);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const suite = await stockApi.updateSettings(p.corps);
      setLecture({ ok: true, valeur: suite });
      setF(formulaireReglages(suite));
      setMessage('Réglages enregistrés.');
    } catch (err) {
      setErreur(messageStocks(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Settings}
        titre="Réglages des stocks"
        sousTitre={
          gerer
            ? 'Comment les ventes, les sorties et les inventaires touchent le stock.'
            : 'Consultation seulement : les gestionnaires des stocks les modifient.'
        }
      />
      <form noValidate onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-5">
        <fieldset disabled={!gerer || envoi} className="flex flex-col gap-5">
          <Panneau titre="Sortie de stock à la vente" id="reglages-vente">
            <div className="flex flex-col gap-2">
              {STOCK_SALES_ISSUE_MODES.map((m) => (
                <label key={m} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="mode-vente"
                    className="mt-1"
                    checked={f.salesIssueMode === m}
                    onChange={() => maj({ salesIssueMode: m })}
                  />
                  <span>
                    {LIBELLES_MODE_VENTE[m].titre}
                    <span className="block text-xs text-[var(--foreground-muted)]">
                      {LIBELLES_MODE_VENTE[m].aide}
                    </span>
                  </span>
                </label>
              ))}
              <p className="text-xs text-[var(--foreground-muted)]">
                Les avoirs sont toujours proposés dans « À traiter » : une remise n’a pas de retour
                physique.
              </p>
            </div>
          </Panneau>

          <Panneau titre="Sorties, transferts et ajustements" id="reglages-negatif">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={f.allowNegativeManualMoves}
                onChange={(e) => maj({ allowNegativeManualMoves: e.target.checked })}
              />
              <span>
                Permettre de sortir plus que le disponible
                <span className="block text-xs text-[var(--foreground-muted)]">
                  Décoché (recommandé) : un bon qui dépasse le stock est refusé. Les ventes émises
                  sortent toujours, avec une alerte.
                </span>
              </span>
            </label>
          </Panneau>

          <Panneau titre="Inventaires" id="reglages-inventaires">
            <div className="sm:w-64">
              <Champ
                id="reglages-rappel"
                label="Rappel d’inventaire tous les (jours)"
                aide="0 : aucun rappel."
                erreur={champs['countReminderDays']}
              >
                <ChampNombre
                  id="reglages-rappel"
                  value={f.countReminderDays}
                  onChange={(e) => maj({ countReminderDays: e.target.value })}
                  {...aria('reglages-rappel', champs['countReminderDays'], true)}
                />
              </Champ>
            </div>
          </Panneau>

          <Panneau titre="Motifs d’ajustement" id="reglages-motifs">
            {champs['motifs'] ? (
              <p className="text-xs text-[var(--danger)]">{champs['motifs']}</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {f.motifs.map((m, i) => (
                <li key={m.key} className="flex items-start gap-2">
                  <div className="flex-1">
                    <input
                      aria-label={`Motif ${i + 1}`}
                      className={CHAMP}
                      value={m.label}
                      maxLength={60}
                      onChange={(e) =>
                        maj({
                          motifs: f.motifs.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                      aria-invalid={champs[`motif-${i}`] ? true : undefined}
                    />
                    {champs[`motif-${i}`] ? (
                      <p className="text-xs text-[var(--danger)]">{champs[`motif-${i}`]}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-label={`Retirer le motif ${m.label || i + 1}`}
                    onClick={() => maj({ motifs: f.motifs.filter((_, j) => j !== i) })}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start`}
              disabled={f.motifs.length >= 20}
              onClick={() =>
                maj({
                  motifs: [
                    ...f.motifs,
                    {
                      key: cleMotif(
                        `motif ${f.motifs.length + 1}`,
                        f.motifs.map((x) => x.key),
                      ),
                      label: '',
                    },
                  ],
                })
              }
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Ajouter un motif
            </button>
          </Panneau>
        </fieldset>

        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {message ? (
          <p className="text-sm" role="status">
            {message}
          </p>
        ) : null}
        {gerer ? (
          <button
            type="submit"
            disabled={envoi}
            className={buttonClasses('primary', 'md', 'self-start')}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </button>
        ) : null}
      </form>
    </section>
  );
}
