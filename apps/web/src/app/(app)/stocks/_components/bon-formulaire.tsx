'use client';

// Nouveau bon de stock (ADR-0046 § 2.4), dans le `Modal` de `@lalanda/ui`.
// Sortie, entrée (retour au magasin), transfert, retour fournisseur
// (`stock.move`) ; ajustement avec motif (`stock.manage`). « Enregistrer et
// passer » écrit les mouvements ; le disponible est jugé par l'API.

import { STOCK_DEFAULT_ADJUSTMENT_REASONS } from '@lalanda/shared/stock';
import { buttonClasses } from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import {
  stockApi,
  type StockAdjustmentReasonView,
  type StockVoucherKind,
  type StockVoucherView,
} from '@/lib/api-stock';
import { workApi } from '@/lib/work-api';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import {
  emplacementsDuBon,
  formulaireBon,
  ligneBonVide,
  preparerBon,
  type FormulaireBon,
  type LigneBon,
} from './bons-model';
import { useAccesStocks } from './stocks-access';
import { LIBELLES_BON, jourKinshasa, messageStocks } from './stocks-model';
import { ChampNombre, ChoixArticle, ChoixEmplacement } from './stocks-ui';

function useMotifs(actif: boolean): StockAdjustmentReasonView[] {
  const [motifs, setMotifs] = useState<StockAdjustmentReasonView[]>(
    STOCK_DEFAULT_ADJUSTMENT_REASONS.map((m) => ({ key: m.key, label: m.label })),
  );
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    stockApi
      .getSettings()
      .then((s) => {
        if (!annule && s.adjustmentReasons.length > 0) setMotifs(s.adjustmentReasons);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [actif]);
  return motifs;
}

function useProjets(actif: boolean): { id: string; name: string }[] {
  const [projets, setProjets] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    workApi
      .listProjects({ status: 'active', limit: 100 })
      .then((p) => {
        if (!annule) setProjets(p.items.map((x) => ({ id: x.id, name: x.name })));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [actif]);
  return projets;
}

export function BonFormulaire({
  kind,
  onFait,
  onSale,
}: {
  kind: StockVoucherKind;
  onFait: (b: StockVoucherView) => void;
  onSale: (s: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { actions, emplacements } = useAccesStocks();
  const parDefaut = emplacements?.ok
    ? (emplacements.valeur.find((l) => l.isDefault)?.id ?? '')
    : '';
  const aujourdhui = jourKinshasa(new Date());
  const [f, setF] = useState<FormulaireBon>(() => formulaireBon(kind, aujourdhui, parDefaut));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const motifs = useMotifs(kind === 'adjustment');
  const projets = useProjets(kind === 'issue' && (actions?.includes('work.read') ?? false));
  const e = emplacementsDuBon(kind);

  const maj = (p: Partial<FormulaireBon>): void => {
    setF((x) => ({ ...x, ...p }));
    onSale(true);
  };
  const majLigne = (i: number, p: Partial<LigneBon>): void =>
    maj({ lignes: f.lignes.map((l, j) => (j === i ? { ...l, ...p } : l)) });

  async function enregistrer(passer: boolean): Promise<void> {
    setErreur(null);
    const p = preparerBon(f, aujourdhui);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      let b = await stockApi.createVoucher(p.corps);
      if (passer) {
        try {
          b = await stockApi.postVoucher(b.id, b.revision);
        } catch (err) {
          // Le brouillon existe : on le dit, il se passe depuis la liste.
          setErreur(
            `${messageStocks(err, 'Le bon n’a pas pu être passé.')} Le bon est enregistré en brouillon.`,
          );
          onFait(b);
          return;
        }
      }
      onFait(b);
    } catch (err) {
      setErreur(messageStocks(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        void enregistrer(true);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-[var(--foreground-muted)]">{LIBELLES_BON[kind]}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {e.depart ? (
          <Champ
            id={`${id}-de`}
            label={kind === 'adjustment' ? 'Emplacement' : 'Depuis'}
            requis
            erreur={champs['from']}
          >
            <ChoixEmplacement
              id={`${id}-de`}
              valeur={f.fromLocationId}
              vide="Choisir"
              onChange={(v) => maj({ fromLocationId: v })}
              aria={aria(`${id}-de`, champs['from'])}
            />
          </Champ>
        ) : null}
        {e.arrivee ? (
          <Champ id={`${id}-vers`} label="Vers" requis erreur={champs['to']}>
            <ChoixEmplacement
              id={`${id}-vers`}
              valeur={f.toLocationId}
              vide="Choisir"
              exclure={kind === 'transfer' ? f.fromLocationId : undefined}
              onChange={(v) => maj({ toLocationId: v })}
              aria={aria(`${id}-vers`, champs['to'])}
            />
          </Champ>
        ) : null}
        <Champ id={`${id}-date`} label="Date" requis erreur={champs['postedOn']}>
          <input
            id={`${id}-date`}
            type="date"
            max={aujourdhui}
            className={CHAMP}
            value={f.postedOn}
            onChange={(ev) => maj({ postedOn: ev.target.value })}
            {...aria(`${id}-date`, champs['postedOn'])}
          />
        </Champ>
        {kind === 'issue' ? (
          <>
            <Champ id={`${id}-projet`} label="Projet consommateur" aide="Facultatif.">
              <select
                id={`${id}-projet`}
                className={CHAMP}
                value={f.workProjectId}
                onChange={(ev) => maj({ workProjectId: ev.target.value })}
              >
                <option value="">Aucun (consommation interne)</option>
                {projets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ id={`${id}-pour`} label="Remis à" erreur={champs['recipient']}>
              <input
                id={`${id}-pour`}
                className={CHAMP}
                value={f.recipient}
                maxLength={500}
                placeholder="Nom du bénéficiaire"
                onChange={(ev) => maj({ recipient: ev.target.value })}
              />
            </Champ>
          </>
        ) : null}
        {kind === 'adjustment' ? (
          <>
            <Champ id={`${id}-motif`} label="Motif" requis erreur={champs['reason']}>
              <select
                id={`${id}-motif`}
                className={CHAMP}
                value={f.reason}
                onChange={(ev) => maj({ reason: ev.target.value })}
                {...aria(`${id}-motif`, champs['reason'])}
              >
                <option value="">Choisir un motif</option>
                {motifs.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ id={`${id}-precision`} label="Précision" erreur={champs['reasonNote']}>
              <input
                id={`${id}-precision`}
                className={CHAMP}
                value={f.reasonNote}
                maxLength={500}
                onChange={(ev) => maj({ reasonNote: ev.target.value })}
              />
            </Champ>
          </>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Articles</legend>
        {champs['lignes'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['lignes']}</p>
        ) : null}
        {f.lignes.map((l, i) => (
          <div
            key={i}
            className={`grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 ${kind === 'adjustment' ? 'sm:grid-cols-[2fr_auto_1fr_auto]' : 'sm:grid-cols-[2fr_1fr_auto]'}`}
          >
            <Champ id={`${id}-l${i}-art`} label="Article" erreur={champs[`ligne-${i}-item`]}>
              <ChoixArticle
                id={`${id}-l${i}-art`}
                valeur={l.itemId}
                nomInitial={l.itemName || null}
                onChange={(a) =>
                  majLigne(i, { itemId: a?.id ?? '', itemName: a?.name ?? '', unit: a?.unit ?? '' })
                }
                aria={aria(`${id}-l${i}-art`, champs[`ligne-${i}-item`])}
              />
            </Champ>
            {kind === 'adjustment' ? (
              <Champ id={`${id}-l${i}-sens`} label="Sens">
                <select
                  id={`${id}-l${i}-sens`}
                  className={CHAMP}
                  value={l.sens}
                  onChange={(ev) => majLigne(i, { sens: ev.target.value as LigneBon['sens'] })}
                >
                  <option value="out">Retirer</option>
                  <option value="in">Ajouter</option>
                </select>
              </Champ>
            ) : null}
            <Champ
              id={`${id}-l${i}-q`}
              label={l.unit ? `Quantité (${l.unit})` : 'Quantité'}
              erreur={champs[`ligne-${i}-quantity`]}
            >
              <ChampNombre
                id={`${id}-l${i}-q`}
                value={l.quantity}
                onChange={(ev) => majLigne(i, { quantity: ev.target.value })}
                {...aria(`${id}-l${i}-q`, champs[`ligne-${i}-quantity`])}
              />
            </Champ>
            <button
              type="button"
              className={`${BOUTON_PETIT} self-end`}
              disabled={f.lignes.length === 1}
              aria-label={`Retirer la ligne ${i + 1}`}
              onClick={() => maj({ lignes: f.lignes.filter((_, j) => j !== i) })}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start`}
          disabled={f.lignes.length >= 100}
          onClick={() => maj({ lignes: [...f.lignes, ligneBonVide()] })}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter un article
        </button>
      </fieldset>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={envoi} className={buttonClasses('primary', 'md')}>
          {envoi ? 'Enregistrement…' : 'Enregistrer et passer'}
        </button>
        <button
          type="button"
          disabled={envoi}
          className={buttonClasses('secondary', 'md')}
          onClick={() => void enregistrer(false)}
        >
          Enregistrer en brouillon
        </button>
      </div>
    </form>
  );
}
