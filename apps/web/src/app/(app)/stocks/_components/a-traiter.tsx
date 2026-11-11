'use client';

// « À traiter » — ADR-0046 § 2.6 : lignes de réception non reconnues, unités
// inconnues, coûts à saisir, retours de vente proposés, coûts différents de la
// facture. Résolution en fenêtre modale ; « classer » avec motif. Une ligne ne
// disparaît qu'une fois résolue ou classée.

import { Badge, Field, FormGrid, Modal, SubmitButton, buttonClasses } from '@lalanda/ui';
import { Inbox } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { stockApi, type StockPendingLineView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  FILTRES_A_TRAITER,
  SAISIE_VIDE,
  champsResolution,
  deviseVisible,
  droitATraiter,
  preparerResolution,
  type FiltreATraiter,
  type SaisieResolution,
  affichageATraiter,
} from './a-traiter-model';
import { DialogueMotif } from './dialogue-motif';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_A_TRAITER,
  formatInstantJour,
  formatQuantite,
  messageStocks,
} from './stocks-model';
import {
  Bandeau,
  CARTE,
  CarteVide,
  Chargement,
  ChampNombre,
  ChoixArticle,
  ChoixEmplacement,
  EchecLecture,
} from './stocks-ui';

function Resolution({
  ligne,
  onFait,
}: {
  ligne: StockPendingLineView;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const { actions } = useAccesStocks();
  const c = champsResolution(ligne.reason);
  const vue = affichageATraiter(ligne);
  const droit = droitATraiter(ligne.reason, actions);
  const devise = deviseVisible(ligne, actions);
  const [s, setS] = useState<SaisieResolution>(SAISIE_VIDE);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [classement, setClassement] = useState(false);

  async function resoudre(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerResolution(ligne, s);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      await stockApi.resolvePending(ligne.id, p.corps);
      onFait();
    } catch (err) {
      setErreur(messageStocks(err, 'Résolution impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <form noValidate onSubmit={(e) => void resoudre(e)} className="flex flex-col gap-4">
        <p className="text-sm">{c.explication}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-[var(--foreground-muted)]">Ligne</dt>
          <dd className="break-words">{vue.libelle}</dd>
          {vue.quantite !== null ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Quantité</dt>
              <dd>{formatQuantite(vue.quantite, vue.unite)}</dd>
            </>
          ) : null}
          {vue.origine ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Origine</dt>
              <dd>{vue.origine}</dd>
            </>
          ) : null}
        </dl>
        {!droit.actif ? (
          <p className="text-sm text-[var(--foreground-muted)]">{droit.raison}</p>
        ) : (
          <>
            <FormGrid>
              {c.article ? (
                <Field
                  id={`${id}-article`}
                  label="Article"
                  required
                  size="full"
                  error={champs['article']}
                >
                  <ChoixArticle
                    valeur={s.itemId}
                    creer
                    onChange={(a) => setS({ ...s, itemId: a?.id ?? '' })}
                  />
                </Field>
              ) : null}
              {c.facteur ? (
                <Field
                  id={`${id}-facteur`}
                  label={`1 ${vue.unite ?? 'unité'} = combien d’unités de stock`}
                  required
                  size="md"
                  error={champs['facteur']}
                >
                  <ChampNombre
                    value={s.factor}
                    onChange={(e) => setS({ ...s, factor: e.target.value })}
                  />
                </Field>
              ) : null}
              {c.quantite ? (
                <Field
                  id={`${id}-quantite`}
                  label="Quantité revenue"
                  required
                  size="sm"
                  hint="Au plus la quantité créditée par l’avoir."
                  error={champs['quantite']}
                >
                  <ChampNombre
                    value={s.quantity}
                    onChange={(e) => setS({ ...s, quantity: e.target.value })}
                  />
                </Field>
              ) : null}
              {c.emplacement ? (
                <Field
                  id={`${id}-emplacement`}
                  label="Rangé à"
                  required
                  size="md"
                  newRow
                  error={champs['emplacement']}
                >
                  <ChoixEmplacement
                    valeur={s.locationId}
                    vide="Choisir"
                    onChange={(v) => setS({ ...s, locationId: v })}
                  />
                </Field>
              ) : null}
              {c.cout ? (
                <Field
                  id={`${id}-cout`}
                  label={`Coût unitaire${devise ? ` (${devise})` : ''}`}
                  required
                  size="md"
                  newRow
                  hint="Dans la devise de l’article ; aucun taux n’est appliqué."
                  error={champs['cout']}
                >
                  <ChampNombre
                    value={s.unitCost}
                    onChange={(e) => setS({ ...s, unitCost: e.target.value })}
                  />
                </Field>
              ) : null}
            </FormGrid>
            {erreur ? (
              <Alerte>
                <p>{erreur}</p>
              </Alerte>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="max-sm:w-full">
                Résoudre
              </SubmitButton>
              <button
                type="button"
                disabled={envoi}
                className={buttonClasses('secondary', 'md')}
                onClick={() => setClassement(true)}
              >
                {c.classer}
              </button>
            </div>
          </>
        )}
      </form>
      {classement ? (
        <DialogueMotif
          titre={c.classer}
          libelle="Motif"
          bouton={c.classer}
          motif="obligatoire"
          onFermer={() => setClassement(false)}
          onValider={async (motif) => {
            await stockApi.dismissPending(ligne.id, {
              reason: motif,
              expectedRevision: ligne.revision,
            });
            setClassement(false);
            onFait();
          }}
        />
      ) : null}
    </>
  );
}

export function ATraiter(): React.ReactElement {
  const [filtre, setFiltre] = useState<FiltreATraiter>('tous');
  const [items, setItems] = useState<StockPendingLineView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [ouverte, setOuverte] = useState<StockPendingLineView | null>(null);

  const charger = useCallback((f: FiltreATraiter, cursor: string | null) => {
    stockApi
      .listPending({
        status: 'open',
        limit: 50,
        ...(f === 'tous' ? {} : { reason: f }),
        ...(cursor ? { cursor } : {}),
      })
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(err);
      });
  }, []);

  useEffect(() => charger(filtre, null), [filtre, charger]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Inbox}
        titre="À traiter"
        sousTitre="Ce qui arrive des achats et des ventes et attend une décision avant d’entrer ou de sortir."
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les lignes">
          {FILTRES_A_TRAITER.map((f) => (
            <button
              key={f.valeur}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={filtre === f.valeur}
              onClick={() => setFiltre(f.valeur)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Bandeau>

      <Modal
        open={ouverte !== null}
        onClose={() => setOuverte(null)}
        title={ouverte ? LIBELLES_A_TRAITER[ouverte.reason] : 'À traiter'}
        size="md"
      >
        {ouverte ? (
          <Resolution
            ligne={ouverte}
            onFait={() => {
              setOuverte(null);
              charger(filtre, null);
            }}
          />
        ) : null}
      </Modal>

      {erreur ? (
        <EchecLecture erreur={erreur} repli="Impossible de charger les lignes à traiter." />
      ) : null}

      {items === null ? (
        <Chargement />
      ) : items.length === 0 ? (
        erreur ? null : (
          <CarteVide>Rien à traiter : tout ce qui est arrivé est rangé.</CarteVide>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((l) => {
            const v = affichageATraiter(l);
            return (
              <li key={l.id}>
                <button type="button" className={CARTE} onClick={() => setOuverte(l)}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold break-words">{v.libelle}</span>
                    <Badge tone="warning">{LIBELLES_A_TRAITER[l.reason]}</Badge>
                  </span>
                  {v.quantite !== null ? (
                    <span className="text-sm tabular-nums">
                      {formatQuantite(v.quantite, v.unite)}
                    </span>
                  ) : null}
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {[v.origine, formatInstantJour(l.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtre, suivante)}
        >
          Afficher plus
        </button>
      ) : null}
    </section>
  );
}
