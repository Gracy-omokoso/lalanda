'use client';

// Réglages des stocks — ADR-0046 § 2.8 : sortie de stock à la vente, stock
// négatif pour les mouvements manuels, rappels d'inventaire, motifs
// d'ajustement. Lecture `stock.read` ; modification `stock.manage`.

import { STOCK_SALES_ISSUE_MODES } from '@lalanda/shared/stock';
import { Button, ChoiceCards, Field, FormGrid, SubmitButton, Switch, TextInput } from '@lalanda/ui';
import { Plus, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { stockApi, type StockSettingsView } from '@/lib/api-stock';

import { Alerte } from '../../ventes/_components/form-ui';

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
              <ChoiceCards<FormulaireReglages['salesIssueMode']>
                aria-label="Sortie de stock à la vente"
                value={f.salesIssueMode}
                onChange={(v) => maj({ salesIssueMode: v })}
                disabled={!gerer || envoi}
                options={STOCK_SALES_ISSUE_MODES.map((m) => ({
                  value: m,
                  label: LIBELLES_MODE_VENTE[m].titre,
                  description: LIBELLES_MODE_VENTE[m].aide,
                }))}
              />
              <p className="text-xs text-[var(--foreground-muted)]">
                Les avoirs sont toujours proposés dans « À traiter » : une remise n’a pas de retour
                physique.
              </p>
            </div>
          </Panneau>

          <Panneau titre="Sorties, transferts et ajustements" id="reglages-negatif">
            <Switch
              checked={f.allowNegativeManualMoves}
              onChange={(v) => maj({ allowNegativeManualMoves: v })}
              disabled={!gerer || envoi}
              label="Permettre de sortir plus que le disponible"
              description="Désactivé (recommandé) : un bon qui dépasse le stock est refusé. Les ventes émises sortent toujours, avec une alerte."
            />
          </Panneau>

          <Panneau titre="Inventaires" id="reglages-inventaires">
            <FormGrid>
              <Field
                id="reglages-rappel"
                label="Rappel d’inventaire tous les (jours)"
                size="md"
                hint="0 : aucun rappel."
                error={champs['countReminderDays']}
              >
                <ChampNombre
                  value={f.countReminderDays}
                  onChange={(e) => maj({ countReminderDays: e.target.value })}
                />
              </Field>
            </FormGrid>
          </Panneau>

          <Panneau titre="Motifs d’ajustement" id="reglages-motifs">
            {champs['motifs'] ? (
              <p className="text-xs text-[var(--danger)]">{champs['motifs']}</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {f.motifs.map((m, i) => (
                <li key={m.key} className="flex items-start gap-2">
                  <div className="flex-1">
                    <TextInput
                      aria-label={`Motif ${i + 1}`}
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
                  <Button
                    size="sm"
                    className="max-sm:h-11"
                    aria-label={`Retirer le motif ${m.label || i + 1}`}
                    onClick={() => maj({ motifs: f.motifs.filter((_, j) => j !== i) })}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              className="self-start max-sm:h-11"
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
            </Button>
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
          <SubmitButton
            busy={envoi}
            busyLabel="Enregistrement…"
            className="self-start max-sm:w-full"
          >
            Enregistrer les réglages
          </SubmitButton>
        ) : null}
      </form>
    </section>
  );
}
