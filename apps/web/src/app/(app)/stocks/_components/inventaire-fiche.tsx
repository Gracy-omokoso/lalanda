'use client';

// Fiche d'un inventaire — ADR-0046 § 2.7 : saisie du comptage PENSÉE POUR UN
// TÉLÉPHONE (une carte par article, grand champ numérique qui sélectionne son
// contenu, enregistrement ligne par ligne, recherche et filtre « à compter »),
// puis écarts rendus par le moteur et validation par un gestionnaire qui n'a pas
// compté (bouton désactivé avec sa raison sinon). Comptage à l'aveugle : la
// quantité théorique n'est jamais affichée au compteur.

import { Badge } from '@lalanda/ui';
import { ArrowLeft, Check, ClipboardCheck, Scale } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { stockApi, type StockCountLineView, type StockCountView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { DialogueMotif } from './dialogue-motif';
import {
  gestesInventaire,
  lignesAffichees,
  lireComptage,
  mentionApprobateurUnique,
  peutSaisirComptage,
  progression,
  theoriqueAffichee,
  type FiltreLignes,
  type IdGesteInventaire,
} from './inventaires-model';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_STATUT_INVENTAIRE,
  STOCKS_BASE,
  estNegatif,
  estNul,
  formatInstantJour,
  formatQuantite,
  formatQuantiteSignee,
  formatValeur,
  lire,
  messageStocks,
  nomPersonne,
  quantitePourSaisie,
  statutDe,
  tonStatutInventaire,
  valeursAffichees,
  type Lecture,
} from './stocks-model';
import {
  Bandeau,
  CarteVide,
  Chargement,
  ChampNombre,
  EchecLecture,
  Panneau,
  PhraseSection,
} from './stocks-ui';

function LigneComptage({
  inventaire,
  ligne,
  onEnregistre,
}: {
  inventaire: StockCountView;
  ligne: StockCountLineView;
  onEnregistre: (c: StockCountView) => void;
}): React.ReactElement {
  const id = useId();
  const { membres, moi } = useAccesStocks();
  const [saisie, setSaisie] = useState(quantitePourSaisie(ligne.countedQuantity));
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const theorique = theoriqueAffichee(inventaire, ligne);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const q = lireComptage(saisie);
    if (!q.ok) {
      setErreur(q.erreur);
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      onEnregistre(
        await stockApi.saveCountLine(inventaire.id, ligne.id, { countedQuantity: q.valeur }),
      );
    } catch (err) {
      setErreur(messageStocks(err, 'Comptage non enregistré.'));
    } finally {
      setEnvoi(false);
    }
  }

  const compte = ligne.countedQuantity !== null;
  return (
    <form
      noValidate
      onSubmit={(e) => void enregistrer(e)}
      className={`flex flex-col gap-2 rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4 ${compte ? 'border-[var(--ok)]/50' : 'border-[var(--border)]'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={`${id}-q`} className="min-w-0 font-semibold break-words">
          {ligne.itemName}
          <span className="block text-xs font-normal text-[var(--foreground-muted)]">
            {ligne.itemCode ? `${ligne.itemCode} · ` : ''}en {ligne.unit}
            {theorique !== null ? ` · attendu ${formatQuantite(theorique)}` : ''}
          </span>
        </label>
        {compte ? (
          <Badge tone="success">
            <Check aria-hidden="true" className="mr-1 inline h-3 w-3" />
            Compté
          </Badge>
        ) : null}
      </div>
      <div className="flex gap-2">
        <ChampNombre
          id={`${id}-q`}
          grand
          value={saisie}
          placeholder="Quantité comptée"
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? `${id}-erreur` : undefined}
          onChange={(e) => setSaisie(e.target.value)}
        />
        <button
          type="submit"
          disabled={envoi}
          className="shrink-0 rounded-[var(--radius-md)] bg-[var(--module-run)] px-4 text-sm font-semibold text-[var(--surface)] disabled:opacity-60"
        >
          {envoi ? '…' : compte ? 'Corriger' : 'Enregistrer'}
        </button>
      </div>
      {erreur ? (
        <p id={`${id}-erreur`} className="text-xs text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
      {compte && ligne.countedBy ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Compté par {nomPersonne(membres, ligne.countedBy, moi)} ·{' '}
          {formatInstantJour(ligne.countedAt)}
        </p>
      ) : null}
    </form>
  );
}

const FILTRES_LIGNES: readonly { valeur: FiltreLignes; label: string }[] = [
  { valeur: 'a-compter', label: 'À compter' },
  { valeur: 'comptees', label: 'Comptées' },
  { valeur: 'toutes', label: 'Toutes' },
];

export function InventaireFiche({ countId }: { countId: string }): React.ReactElement {
  const { actions, emplacements, membres, moi } = useAccesStocks();
  const [lecture, setLecture] = useState<Lecture<StockCountView> | null>(null);
  const [version, setVersion] = useState(0);
  const [filtre, setFiltre] = useState<FiltreLignes>('a-compter');
  const [recherche, setRecherche] = useState('');
  const [dialogue, setDialogue] = useState<IdGesteInventaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(stockApi.getCount(countId)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [countId, version]);

  const retour = (
    <Link
      href={`${STOCKS_BASE}/inventaires`}
      className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Tous les inventaires
    </Link>
  );

  if (lecture === null) return <Chargement texte="Chargement de l’inventaire…" />;
  if (!lecture.ok) {
    return (
      <section className="flex flex-col gap-4">
        {retour}
        {statutDe(lecture.erreur) === 404 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center sm:p-8">
            <p className="text-sm font-medium">Inventaire introuvable</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
              Cet inventaire n’existe pas, appartient à une autre organisation, ou les stocks ne
              sont pas encore disponibles sur ce serveur.
            </p>
          </div>
        ) : (
          <EchecLecture
            erreur={lecture.erreur}
            repli="L’inventaire est illisible."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        )}
      </section>
    );
  }

  const c = lecture.valeur;
  const remplacer = (v: StockCountView): void => setLecture({ ok: true, valeur: v });
  const p = progression(c);
  const saisie = peutSaisirComptage(c, actions);
  const gestes = gestesInventaire(c, actions, moi);
  const valeurs = valeursAffichees(actions, c.valuesHidden);
  const mention = mentionApprobateurUnique(c);
  const lieu =
    c.locationName ??
    (emplacements?.ok ? emplacements.valeur.find((l) => l.id === c.locationId)?.name : null) ??
    'Emplacement';
  const lignes = lignesAffichees(c.lines, saisie ? filtre : 'toutes', recherche);
  const ecartsParLigne = new Map((c.variances?.lines ?? []).map((v) => [v.lineId, v]));

  async function demarrer(): Promise<void> {
    setErreur(null);
    setOccupe(true);
    try {
      remplacer(await stockApi.startCount(c.id, c.revision));
    } catch (err) {
      setErreur(messageStocks(err, 'Le comptage n’a pas pu s’ouvrir.'));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5 pb-24 sm:pb-0">
      {retour}
      <Bandeau
        icone={ClipboardCheck}
        titre={`Inventaire — ${lieu}`}
        sousTitre={[c.number, c.blind ? 'à l’aveugle' : null, p.phrase].filter(Boolean).join(' · ')}
        actions={
          <Badge tone={tonStatutInventaire(c.status)}>{LIBELLES_STATUT_INVENTAIRE[c.status]}</Badge>
        }
      >
        {gestes.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {gestes.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  disabled={!g.actif || occupe}
                  aria-describedby={g.raison ? `inv-${g.id}-raison` : undefined}
                  className={
                    g.id === 'annuler'
                      ? BOUTON_PETIT
                      : 'rounded-[var(--radius-md)] bg-[var(--module-run)] px-4 py-2 text-sm font-semibold text-[var(--surface)] disabled:opacity-50'
                  }
                  onClick={() => (g.id === 'demarrer' ? void demarrer() : setDialogue(g.id))}
                >
                  {g.libelle}
                </button>
              ))}
            </div>
            {gestes
              .filter((g) => g.raison)
              .map((g) => (
                <p
                  key={g.id}
                  id={`inv-${g.id}-raison`}
                  className="text-xs text-[var(--foreground-muted)]"
                >
                  {g.raison}
                </p>
              ))}
            {mention ? <p className="text-xs text-[var(--foreground-muted)]">{mention}</p> : null}
          </div>
        ) : null}
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {c.status === 'draft' ? (
        <CarteVide>
          L’inventaire est en préparation : ses lignes sont figées à l’ouverture du comptage.
        </CarteVide>
      ) : null}

      {c.status !== 'draft' && c.lines.length > 0 ? (
        <Panneau
          titre={saisie ? 'Comptage' : 'Lignes comptées'}
          icone={ClipboardCheck}
          id="inv-lignes"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              aria-label="Rechercher un article de l’inventaire"
              placeholder="Rechercher un article…"
              className={`${CHAMP} sm:max-w-xs`}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            {saisie ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les lignes">
                {FILTRES_LIGNES.map((f) => (
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
            ) : null}
          </div>
          {lignes.length === 0 ? (
            <PhraseSection>
              {saisie && filtre === 'a-compter'
                ? 'Toutes les lignes sont comptées.'
                : 'Aucune ligne ne correspond.'}
            </PhraseSection>
          ) : saisie ? (
            <div className="grid gap-3 md:grid-cols-2">
              {lignes.map((l) => (
                <LigneComptage key={l.id} inventaire={c} ligne={l} onEnregistre={remplacer} />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {lignes.map((l) => {
                const v = ecartsParLigne.get(l.id);
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 break-words">{l.itemName}</span>
                    <span className="tabular-nums">
                      {l.countedQuantity === null
                        ? 'non comptée'
                        : formatQuantite(l.countedQuantity, l.unit)}
                    </span>
                    {v?.variance != null && !estNul(v.variance) ? (
                      <span
                        className={`tabular-nums font-semibold ${estNegatif(v.variance) ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}
                      >
                        écart {formatQuantiteSignee(v.variance)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panneau>
      ) : null}

      {c.variances ? (
        <Panneau titre="Écarts" icone={Scale} id="inv-ecarts">
          <PhraseSection>
            {c.variances.varianceLineCount} ligne{c.variances.varianceLineCount > 1 ? 's' : ''} en
            écart sur {c.variances.countedLineCount} comptée
            {c.variances.countedLineCount > 1 ? 's' : ''}. La théorie est celle de l’instant de
            chaque comptage ; la validation crée un mouvement d’écart par ligne.
          </PhraseSection>
          {valeurs && c.variances.byCurrency.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {c.variances.byCurrency.map((d) => (
                <li
                  key={d.currency}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm"
                >
                  <p className="font-semibold">Écarts valorisés en {d.currency}</p>
                  <p>Gains : {formatValeur(d.gains, d.currency)}</p>
                  <p>Pertes : {formatValeur(d.losses, d.currency)}</p>
                  <p className="font-medium">Net : {formatValeur(d.net, d.currency)}</p>
                  {d.unvaluedLineCount > 0 ? (
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {d.unvaluedLineCount} ligne{d.unvaluedLineCount > 1 ? 's' : ''} sans coût
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Panneau>
      ) : null}

      {c.validation ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Validé par {nomPersonne(membres, c.validation.by, moi)} le{' '}
          {formatInstantJour(c.validation.at)}
          {c.validation.comment ? ` : ${c.validation.comment}` : ''}.
        </p>
      ) : null}

      {saisie && p.total > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-pop)] sm:hidden">
          <p className="text-center text-sm font-medium" aria-live="polite">
            {p.phrase}
          </p>
        </div>
      ) : null}

      {dialogue === 'soumettre' ? (
        <DialogueMotif
          titre="Soumettre le comptage"
          description="Les écarts sont calculés par Lalanda ; un gestionnaire des stocks qui n’a pas compté les valide."
          libelle=""
          bouton="Soumettre"
          motif="aucun"
          onFermer={() => setDialogue(null)}
          onValider={async () => {
            remplacer(await stockApi.submitCount(c.id, c.revision));
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue === 'valider' ? (
        <DialogueMotif
          titre="Valider les écarts"
          description="Un mouvement d’écart est créé par ligne en écart, daté d’aujourd’hui. Rien n’est effacé."
          libelle=""
          bouton="Valider"
          motif="aucun"
          onFermer={() => setDialogue(null)}
          onValider={async () => {
            remplacer(await stockApi.validateCount(c.id, { expectedRevision: c.revision }));
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue === 'annuler' ? (
        <DialogueMotif
          titre="Annuler l’inventaire"
          libelle="Motif de l’annulation"
          bouton="Annuler l’inventaire"
          motif="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (motif) => {
            remplacer(
              await stockApi.cancelCount(c.id, { reason: motif, expectedRevision: c.revision }),
            );
            setDialogue(null);
          }}
        />
      ) : null}
    </section>
  );
}
