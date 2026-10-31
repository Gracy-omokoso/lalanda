'use client';

// Bons de stock — ADR-0046 § 2.4, § 5.1 : liste filtrable ; création en fenêtre
// modale (`?nouveau=<type>`) ; fiche d'un bon en fenêtre (lignes, passer,
// annuler avec motif). Numéros `BS`, `BT`, `BJ` : pièces internes, hors série
// fiscale, attribués par l'API.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { FileStack, Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { STOCK_VOUCHER_KINDS } from '@lalanda/shared/stock';

import { stockApi, type StockVoucherKind, type StockVoucherView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { BonFormulaire } from './bon-formulaire';
import {
  FILTRES_BONS,
  gestesBon,
  requeteBons,
  trajetBon,
  typesBon,
  type FiltreBons,
} from './bons-model';
import { DialogueMotif } from './dialogue-motif';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_BON,
  LIBELLES_STATUT_BON,
  formatJour,
  formatQuantite,
  formatQuantiteSignee,
  messageStocks,
  nomPersonne,
  tonStatutBon,
} from './stocks-model';
import { Bandeau, CARTE, CarteVide, Chargement, EchecLecture } from './stocks-ui';

function estType(v: string | null): v is StockVoucherKind {
  return v !== null && (STOCK_VOUCHER_KINDS as readonly string[]).includes(v);
}

function FicheBon({
  bon,
  nom,
  onChange,
}: {
  bon: StockVoucherView;
  nom: (id: string) => string;
  onChange: (b: StockVoucherView) => void;
}): React.ReactElement {
  const { actions, membres, moi } = useAccesStocks();
  const [erreur, setErreur] = useState<string | null>(null);
  const [annulation, setAnnulation] = useState(false);
  const [occupe, setOccupe] = useState(false);

  async function passer(): Promise<void> {
    setErreur(null);
    setOccupe(true);
    try {
      onChange(await stockApi.postVoucher(bon.id, bon.revision));
    } catch (err) {
      setErreur(messageStocks(err, 'Le bon n’a pas pu être passé.'));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={tonStatutBon(bon.status)}>{LIBELLES_STATUT_BON[bon.status]}</Badge>
        <span>{trajetBon(bon, nom)}</span>
        <span className="text-[var(--foreground-muted)]">· {formatJour(bon.postedOn)}</span>
      </div>
      {bon.recipient || bon.reason ? (
        <p className="text-sm">
          {bon.recipient ? `Remis à ${bon.recipient}. ` : ''}
          {bon.reason
            ? `Motif : ${bon.reason}${bon.reasonNote ? ` (${bon.reasonNote})` : ''}.`
            : ''}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
        {bon.lines.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <span className="min-w-0 break-words">{l.itemName ?? 'Article'}</span>
            <span className="tabular-nums font-medium">
              {bon.kind === 'adjustment'
                ? formatQuantiteSignee(l.quantity, l.unit)
                : formatQuantite(l.quantity, l.unit)}
            </span>
          </li>
        ))}
      </ul>
      {bon.cancellationReason ? (
        <p className="text-sm text-[var(--foreground-muted)]">Annulé : {bon.cancellationReason}</p>
      ) : null}
      {bon.createdBy ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Saisi par {nomPersonne(membres, bon.createdBy, moi)}
        </p>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {gestesBon(bon, actions).map((g) => (
          <div key={g.id} className="flex flex-col gap-1">
            <button
              type="button"
              disabled={!g.actif || occupe}
              className={buttonClasses(g.id === 'passer' ? 'primary' : 'secondary', 'sm')}
              onClick={() => (g.id === 'passer' ? void passer() : setAnnulation(true))}
            >
              {g.libelle}
            </button>
            {g.raison ? (
              <span className="text-xs text-[var(--foreground-muted)]">{g.raison}</span>
            ) : null}
          </div>
        ))}
      </div>
      {annulation ? (
        <DialogueMotif
          titre="Annuler le bon"
          description="L’annulation ajoute des mouvements inverses : rien n’est effacé du grand livre."
          libelle="Motif de l’annulation"
          bouton="Annuler le bon"
          motif="obligatoire"
          onFermer={() => setAnnulation(false)}
          onValider={async (motif) => {
            onChange(
              await stockApi.cancelVoucher(bon.id, {
                reason: motif,
                expectedRevision: bon.revision,
              }),
            );
            setAnnulation(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function Bons(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions, emplacements } = useAccesStocks();
  const types = typesBon(actions);
  const demande = params.get('nouveau');
  const nouveau =
    estType(demande) && types.some((t) => t.kind === demande && t.actif) ? demande : null;
  const [filtre, setFiltre] = useState<FiltreBons>('tous');
  const [items, setItems] = useState<StockVoucherView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [ouvert, setOuvert] = useState<StockVoucherView | null>(null);
  const [sale, setSale] = useState(false);

  const nom = (id: string): string =>
    (emplacements?.ok ? emplacements.valeur.find((l) => l.id === id)?.name : null) ?? 'Emplacement';

  const charger = useCallback((f: FiltreBons, cursor: string | null) => {
    stockApi
      .listVouchers(requeteBons(f, cursor))
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

  const creer = (kind: StockVoucherKind | null): void => {
    setSale(false);
    router.replace(kind ? `${pathname}?nouveau=${kind}` : pathname);
  };
  const remplacer = (b: StockVoucherView): void => {
    setOuvert(b);
    setItems((avant) => (avant ? avant.map((x) => (x.id === b.id ? b : x)) : avant));
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={FileStack}
        titre="Bons"
        sousTitre="Sorties, entrées, transferts et ajustements décidés au magasin."
      >
        {types.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Nouveau bon">
              {types.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  disabled={!t.actif}
                  title={t.raison ?? undefined}
                  className={buttonClasses(t.kind === 'issue' ? 'primary' : 'secondary', 'sm')}
                  onClick={() => creer(t.kind)}
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t.libelle}
                </button>
              ))}
            </div>
            {types
              .filter((t) => t.raison)
              .map((t) => (
                <p key={t.kind} className="text-xs text-[var(--foreground-muted)]">
                  {t.libelle} : {t.raison}
                </p>
              ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les bons">
          {FILTRES_BONS.map((f) => (
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
        open={nouveau !== null}
        onClose={() => creer(null)}
        dirty={sale}
        title={nouveau ? LIBELLES_BON[nouveau] : 'Nouveau bon'}
        size="lg"
      >
        {nouveau ? (
          <BonFormulaire
            key={nouveau}
            kind={nouveau}
            onSale={setSale}
            onFait={(b) => {
              creer(null);
              charger(filtre, null);
              setOuvert(b);
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={ouvert !== null}
        onClose={() => setOuvert(null)}
        title={ouvert ? `${LIBELLES_BON[ouvert.kind]} ${ouvert.number ?? '(brouillon)'}` : 'Bon'}
        size="md"
      >
        {ouvert ? <FicheBon bon={ouvert} nom={nom} onChange={remplacer} /> : null}
      </Modal>

      {erreur ? <EchecLecture erreur={erreur} repli="Impossible de charger les bons." /> : null}

      {items === null ? (
        <Chargement texte="Chargement des bons…" />
      ) : items.length === 0 ? (
        erreur ? null : (
          <CarteVide>Aucun bon ne correspond.</CarteVide>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((b) => (
            <li key={b.id}>
              <button type="button" className={CARTE} onClick={() => setOuvert(b)}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-words">{LIBELLES_BON[b.kind]}</span>
                  <Badge tone={tonStatutBon(b.status)}>{LIBELLES_STATUT_BON[b.status]}</Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {b.number ?? 'Brouillon sans numéro'} · {formatJour(b.postedOn)}
                </span>
                <span className="text-sm break-words">{trajetBon(b, nom)}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {b.lines.length} article{b.lines.length > 1 ? 's' : ''}
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
          Afficher plus de bons
        </button>
      ) : null}
    </section>
  );
}
