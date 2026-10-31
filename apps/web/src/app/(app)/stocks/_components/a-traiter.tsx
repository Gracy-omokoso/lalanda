'use client';

// « À traiter » — ADR-0046 § 2.6 : lignes de réception non reconnues, unités
// inconnues, coûts à saisir, retours de vente proposés, coûts différents de la
// facture. Résolution en fenêtre modale ; « classer » avec motif. Une ligne ne
// disparaît qu'une fois résolue ou classée.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Inbox } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { stockApi, type StockPendingLineView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT, Champ, aria } from '../../ventes/_components/form-ui';

import {
  FILTRES_A_TRAITER,
  SAISIE_VIDE,
  champsResolution,
  deviseVisible,
  droitATraiter,
  preparerResolution,
  type FiltreATraiter,
  type SaisieResolution,
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
          <dd className="break-words">{ligne.label ?? ligne.itemName ?? '—'}</dd>
          {ligne.quantity !== null ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Quantité</dt>
              <dd>{formatQuantite(ligne.quantity, ligne.unit)}</dd>
            </>
          ) : null}
          {ligne.sourceLabel ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Origine</dt>
              <dd>{ligne.sourceLabel}</dd>
            </>
          ) : null}
        </dl>
        {!droit.actif ? (
          <p className="text-sm text-[var(--foreground-muted)]">{droit.raison}</p>
        ) : (
          <>
            {c.article ? (
              <Champ id={`${id}-article`} label="Article" requis erreur={champs['article']}>
                <ChoixArticle
                  id={`${id}-article`}
                  valeur={s.itemId}
                  onChange={(a) => setS({ ...s, itemId: a?.id ?? '' })}
                  aria={aria(`${id}-article`, champs['article'])}
                />
              </Champ>
            ) : null}
            {c.facteur ? (
              <Champ
                id={`${id}-facteur`}
                label={`1 ${ligne.unit ?? 'unité'} = combien d’unités de stock`}
                requis
                erreur={champs['facteur']}
              >
                <ChampNombre
                  id={`${id}-facteur`}
                  value={s.factor}
                  onChange={(e) => setS({ ...s, factor: e.target.value })}
                  {...aria(`${id}-facteur`, champs['facteur'])}
                />
              </Champ>
            ) : null}
            {c.quantite ? (
              <Champ
                id={`${id}-quantite`}
                label="Quantité revenue"
                requis
                aide="Au plus la quantité créditée par l’avoir."
                erreur={champs['quantite']}
              >
                <ChampNombre
                  id={`${id}-quantite`}
                  value={s.quantity}
                  onChange={(e) => setS({ ...s, quantity: e.target.value })}
                  {...aria(`${id}-quantite`, champs['quantite'], true)}
                />
              </Champ>
            ) : null}
            {c.emplacement ? (
              <Champ id={`${id}-emplacement`} label="Rangé à" requis erreur={champs['emplacement']}>
                <ChoixEmplacement
                  id={`${id}-emplacement`}
                  valeur={s.locationId}
                  vide="Choisir"
                  onChange={(v) => setS({ ...s, locationId: v })}
                  aria={aria(`${id}-emplacement`, champs['emplacement'])}
                />
              </Champ>
            ) : null}
            {c.cout ? (
              <Champ
                id={`${id}-cout`}
                label={`Coût unitaire${devise ? ` (${devise})` : ''}`}
                requis
                aide="Dans la devise de l’article ; aucun taux n’est appliqué."
                erreur={champs['cout']}
              >
                <ChampNombre
                  id={`${id}-cout`}
                  value={s.unitCost}
                  onChange={(e) => setS({ ...s, unitCost: e.target.value })}
                  {...aria(`${id}-cout`, champs['cout'], true)}
                />
              </Champ>
            ) : null}
            {erreur ? (
              <Alerte>
                <p>{erreur}</p>
              </Alerte>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={envoi} className={buttonClasses('primary', 'md')}>
                {envoi ? 'Enregistrement…' : 'Résoudre'}
              </button>
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
          {items.map((l) => (
            <li key={l.id}>
              <button type="button" className={CARTE} onClick={() => setOuverte(l)}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-words">
                    {l.label ?? l.itemName ?? 'Ligne'}
                  </span>
                  <Badge tone="warning">{LIBELLES_A_TRAITER[l.reason]}</Badge>
                </span>
                {l.quantity !== null ? (
                  <span className="text-sm tabular-nums">{formatQuantite(l.quantity, l.unit)}</span>
                ) : null}
                <span className="text-xs text-[var(--foreground-muted)]">
                  {[l.sourceLabel, formatInstantJour(l.createdAt)].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
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
