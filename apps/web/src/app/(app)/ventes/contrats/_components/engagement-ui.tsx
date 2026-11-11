'use client';

// Briques d'écran partagées par les fiches Commande et Contrat — ADR-0050 § 9, lot V7.
//
// - Aperçu d'une pièce PDF en fenêtre modale (`Modal` de `@lalanda/ui`), avec
//   téléchargement et impression comme pour les factures ; la pièce est servie en
//   téléchargement inerte par l'API et affichée depuis une URL `blob:` locale.
// - Fenêtres « motif » (annuler, clore, rejeter, marquer un acompte traité).
// - Acomptes : liste, « + Acompte » (groupe de taxation JAMAIS prérempli), rappel affiché
//   sans imputation automatique (§ 5.2).
// - Factures liées : lien vers la facture ; aucune émission ici.

import {
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  MoneyInput,
  Select,
  TextArea,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { api, type CustomerView, type TaxGroupList } from '@/lib/api';
import {
  salesContractsApi,
  type LinkedInvoiceView,
  type SalesContractFileView,
  type SalesDepositsView,
} from '@/lib/api-sales-contracts';

import { lecteurPdfIntegre } from '../../_components/apercu-document-model';
import { Alerte, BOUTON, BOUTON_PETIT, Pastille } from '../../_components/form-ui';
import { CustomerForm } from '../../_components/customer-form';
import { useAccesVentes } from '../../_components/sales-access';
import { formatMontant } from '../../_components/sales-model';
import { formatJour } from '../../devis/_components/quote-model';
import type { ClientChoix } from '../../factures/_components/invoice-model';

import {
  PIECE_LABELS,
  acompteVide,
  lienFacture,
  libelleTaille,
  lireMotif,
  messageEngagement,
  phrasesAvertissements,
  preparerAcompte,
  type FormulaireAcompte,
} from './contract-model';

function enregistrer(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Aperçu d'une pièce ─────────────────────────────────────────────────────

type LecteurPiece = () => Promise<{ blob: Blob; filename: string }>;

export function ApercuPiece({
  titre,
  lire,
  onFermer,
}: {
  titre: string;
  lire: LecteurPiece;
  onFermer: () => void;
}): React.ReactElement {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [pdf, setPdf] = useState<{ blob: Blob; filename: string; url: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lecteur] = useState(() =>
    lecteurPdfIntegre(typeof navigator === 'undefined' ? undefined : navigator),
  );
  const lireRef = useRef(lire);

  useEffect(() => {
    let annule = false;
    let url: string | null = null;
    lireRef
      .current()
      .then((r) => {
        if (annule) return;
        const blob =
          r.blob.type === 'application/pdf'
            ? r.blob
            : new Blob([r.blob], { type: 'application/pdf' });
        url = URL.createObjectURL(blob);
        setPdf({ blob, filename: r.filename, url });
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageEngagement(err, 'La pièce n’a pas pu être lue.'));
      });
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  function ouvrirOnglet(): void {
    if (pdf) window.open(pdf.url, '_blank', 'noopener');
  }

  function imprimer(): void {
    setInfo(null);
    const w = iframe.current?.contentWindow;
    try {
      if (!lecteur || !w) throw new Error('aperçu indisponible');
      w.focus();
      w.print();
    } catch {
      ouvrirOnglet();
      setInfo('Le PDF s’est ouvert dans un nouvel onglet : imprimez-le depuis celui-ci.');
    }
  }

  return (
    <Modal open onClose={onFermer} title={titre} size="xl">
      <div className="-mx-4 -my-4 flex min-h-full flex-col sm:-mx-5 sm:-my-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <button
            type="button"
            className={BOUTON}
            disabled={!pdf}
            onClick={() => pdf && enregistrer(pdf.blob, pdf.filename)}
          >
            Télécharger
          </button>
          <button type="button" className={BOUTON} disabled={!pdf} onClick={imprimer}>
            Imprimer
          </button>
          {pdf ? (
            <a
              href={pdf.url}
              target="_blank"
              rel="noopener"
              className="text-sm underline sm:ml-auto"
            >
              Ouvrir le PDF
            </a>
          ) : null}
        </div>
        {info ? (
          <p role="status" className="px-4 pt-2 text-xs text-[var(--foreground-muted)] sm:px-5">
            {info}
          </p>
        ) : null}
        <div className="flex min-h-[50vh] flex-1 flex-col bg-[var(--surface-muted)]">
          {erreur ? (
            <div className="p-4">
              <Alerte>
                <p>{erreur}</p>
              </Alerte>
            </div>
          ) : !pdf ? (
            <p className="m-auto p-6 text-sm text-[var(--foreground-muted)]" aria-live="polite">
              Lecture de la pièce…
            </p>
          ) : lecteur ? (
            <iframe
              ref={iframe}
              src={pdf.url}
              title={`Aperçu PDF — ${titre}`}
              className="h-full min-h-[50vh] w-full flex-1 border-0 bg-white"
            />
          ) : (
            <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm">Ce navigateur n’affiche pas les PDF dans la page.</p>
              <button type="button" className={BOUTON} onClick={ouvrirOnglet}>
                Ouvrir le PDF
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Liste des pièces, chacune ouvrable en aperçu ; « + Pièce » ouvre une fenêtre. */
export function ListePieces({
  pieces,
  lire,
  televerser,
  libelleAjout,
  onAjoutee,
}: {
  pieces: readonly SalesContractFileView[];
  lire: (p: SalesContractFileView) => LecteurPiece;
  /** `null` : pas de téléversement proposé (droit ou état). */
  televerser: ((fichier: File) => Promise<SalesContractFileView>) | null;
  libelleAjout: string;
  onAjoutee: () => void;
}): React.ReactElement {
  const [ouverte, setOuverte] = useState<SalesContractFileView | null>(null);
  const [ajout, setAjout] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {pieces.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucune pièce.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pieces.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOuverte(p)}
                className="flex w-full flex-col gap-0.5 rounded-md border border-[var(--border)] p-3 text-left text-sm transition hover:border-[var(--accent)]"
              >
                <span className="font-medium">{p.fileName}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {PIECE_LABELS[p.kind]} · {libelleTaille(p.size)} · déposée le{' '}
                  {formatJour(p.uploadedAt.slice(0, 10))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {televerser ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-start`}
          onClick={() => setAjout(true)}
        >
          + {libelleAjout}
        </button>
      ) : null}
      {ouverte ? (
        <ApercuPiece
          titre={`${PIECE_LABELS[ouverte.kind]} — ${ouverte.fileName}`}
          lire={lire(ouverte)}
          onFermer={() => setOuverte(null)}
        />
      ) : null}
      {ajout && televerser ? (
        <FenetreTeleversement
          titre={libelleAjout}
          televerser={televerser}
          onFermer={() => setAjout(false)}
          onFait={() => {
            setAjout(false);
            onAjoutee();
          }}
        />
      ) : null}
    </div>
  );
}

function FenetreTeleversement({
  titre,
  televerser,
  onFermer,
  onFait,
}: {
  titre: string;
  televerser: (fichier: File) => Promise<SalesContractFileView>;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [fichier, setFichier] = useState<File | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(): Promise<void> {
    if (!fichier) {
      setErreur('Choisissez un fichier PDF.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await televerser(fichier);
      onFait();
    } catch (err) {
      setErreur(messageEngagement(err, 'Le fichier n’a pas pu être déposé.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description="PDF seulement, 10 Mo au plus. Une pièce déposée n’est jamais remplacée : une nouvelle s’ajoute."
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => void envoyer()}
          >
            {envoi ? 'Dépôt…' : 'Déposer'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <label htmlFor={`${id}-f`} className="text-sm font-medium">
          Fichier PDF
        </label>
        <input
          id={`${id}-f`}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
      </div>
    </Modal>
  );
}

// ─── Fenêtre « motif » ──────────────────────────────────────────────────────

export function FenetreMotif({
  titre,
  description,
  libelle = 'Motif',
  bouton,
  danger = false,
  facultatif = false,
  onConfirmer,
  onFermer,
}: {
  titre: string;
  description?: string;
  libelle?: string;
  bouton: string;
  danger?: boolean;
  /** Saisie facultative (commentaire d'approbation) : vide accepté. */
  facultatif?: boolean;
  onConfirmer: (motif: string) => Promise<void>;
  onFermer: () => void;
}): React.ReactElement {
  const id = useId();
  const [motif, setMotif] = useState('');
  const [erreurChamp, setErreurChamp] = useState<string | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function confirmer(): Promise<void> {
    const lu = facultatif && motif.trim() === '' ? '' : lireMotif(motif);
    if (typeof lu !== 'string') {
      setErreurChamp(lu.erreur);
      return;
    }
    setErreurChamp(undefined);
    setEnvoi(true);
    setErreur(null);
    try {
      await onConfirmer(lu);
    } catch (err) {
      setErreur(messageEngagement(err, 'Action impossible.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description={description}
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses(danger ? 'danger' : 'primary', 'md')}
            disabled={envoi}
            onClick={() => void confirmer()}
          >
            {bouton}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <Field
          id={`${id}-m`}
          label={libelle}
          required={!facultatif}
          optional={facultatif}
          error={erreurChamp}
          size="full"
        >
          <TextArea
            value={motif}
            rows={3}
            maxLength={1000}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

/** Confirmation simple (sans saisie) : soumettre, confirmer, constater une reconduction. */
export function FenetreConfirmation({
  titre,
  children,
  bouton,
  onConfirmer,
  onFermer,
}: {
  titre: string;
  children: React.ReactNode;
  bouton: string;
  onConfirmer: () => Promise<void>;
  onFermer: () => void;
}): React.ReactElement {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => {
              setEnvoi(true);
              setErreur(null);
              onConfirmer().catch((err: unknown) => {
                setErreur(messageEngagement(err, 'Action impossible.'));
                setEnvoi(false);
              });
            }}
          >
            {bouton}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {children}
      </div>
    </Modal>
  );
}

// ─── Client (fiche seulement : un prospect est d'abord converti) ────────────
//
// ADR-0074 § 4 : on tape pour trouver le client (même recherche qu'avant : clients
// actifs, 50 au plus) ; « + » ouvre la fiche client complète en fenêtre (sous
// `sales.manage`), et le client créé est choisi d'office.

/** Client tel que le sélecteur le connaît : la fiche lue, ou ce que le formulaire en garde. */
type ClientListe = Pick<CustomerView, 'id' | 'name'> &
  Partial<Pick<CustomerView, 'typeLabel' | 'nif'>>;

const chercherClients = async (q: string): Promise<CustomerView[]> =>
  (await api.listCustomers({ status: 'active', limit: 50, ...(q ? { q } : {}) })).items;

export function ChoixClientFiche({
  client,
  onChange,
  erreur,
  desactive,
}: {
  client: ClientChoix | null;
  onChange: (c: ClientChoix | null) => void;
  erreur: string | undefined;
  desactive: boolean;
}): React.ReactElement {
  const { gerer } = useAccesVentes();
  const choisi = client?.mode === 'fiche' ? client : null;
  const valeur: ClientListe | null = choisi ? { id: choisi.customerId, name: choisi.nom } : null;

  function choisir(c: ClientListe | null): void {
    onChange(
      c ? { mode: 'fiche', customerId: c.id, nom: c.name, printContactDetails: false } : null,
    );
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={desactive}>
      <legend className="sr-only">Client</legend>
      <FormGrid>
        <Field
          label="Client"
          size="lg"
          hint={
            gerer
              ? 'Tapez un nom, un NIF ou un e-mail. Client absent : « + » le crée. Un prospect est d’abord converti en client depuis le CRM.'
              : 'Tapez un nom, un NIF ou un e-mail. Un prospect est d’abord converti en client depuis le CRM.'
          }
          error={erreur}
        >
          <EntityPicker<ClientListe>
            value={valeur}
            onChange={choisir}
            search={chercherClients}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getDescription={(c) =>
              [c.typeLabel ?? null, c.nif ? `NIF ${c.nif}` : null].filter(Boolean).join(' · ') ||
              null
            }
            placeholder="Nom, NIF ou e-mail"
            recentKey="ventes.clients"
            createTitle="Nouveau client"
            createButtonLabel="Créer un client"
            createSize="lg"
            {...(gerer
              ? {
                  createForm: ({ initialText, onCreated, onCancel }) => (
                    <CustomerForm
                      fiche={{ mode: 'creation' }}
                      gerer
                      base="/ventes/clients"
                      enModal
                      nomInitial={initialText}
                      onFermer={(c) => (c ? onCreated(c) : onCancel())}
                    />
                  ),
                }
              : {})}
          />
        </Field>
      </FormGrid>
    </fieldset>
  );
}

// ─── Factures liées ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  FV: 'Facture',
  EV: 'Facture export',
  FT: 'Facture d’acompte',
  ET: 'Facture d’acompte export',
};

export function FacturesLiees({
  factures,
}: {
  factures: readonly Pick<
    LinkedInvoiceView,
    'invoiceId' | 'type' | 'state' | 'reference' | 'currency' | 'total'
  >[];
}): React.ReactElement {
  if (factures.length === 0) {
    return <p className="text-sm text-[var(--foreground-muted)]">Aucune facture liée.</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {factures.map((f) => (
        <li key={f.invoiceId}>
          <Link
            href={lienFacture(f.invoiceId)}
            className="flex h-full flex-col gap-1 rounded-md border border-[var(--border)] p-3 text-sm transition hover:border-[var(--accent)]"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{f.reference ?? 'Brouillon'}</span>
              <Pastille ton={f.state === 'draft' ? 'attention' : 'neutre'}>
                {f.state === 'draft' ? 'Brouillon à émettre' : 'Émise'}
              </Pastille>
            </span>
            <span className="text-xs text-[var(--foreground-muted)]">
              {TYPE_LABELS[f.type] ?? f.type}
              {f.total ? ` · ${formatMontant(f.total, f.currency)}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Acomptes (§ 5.1, § 5.2) ────────────────────────────────────────────────

export function SectionAcomptes({
  proprietaire,
  id: ownerId,
  peutPreparer,
  ouvert,
  devise,
  onChange,
}: {
  proprietaire: 'orders' | 'contracts';
  id: string;
  /** `sales.read` + `sales.manage`. */
  peutPreparer: boolean;
  /** Commande confirmée ou contrat signé. */
  ouvert: boolean;
  devise: string;
  onChange?: () => void;
}): React.ReactElement {
  const [vue, setVue] = useState<SalesDepositsView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [traiter, setTraiter] = useState<string | null>(null);
  const [info, setInfo] = useState<string[]>([]);

  useEffect(() => {
    let annule = false;
    salesContractsApi
      .getDeposits(proprietaire, ownerId)
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageEngagement(err, 'Acomptes illisibles.'));
      });
    return () => {
      annule = true;
    };
  }, [proprietaire, ownerId]);

  return (
    <div className="flex flex-col gap-3">
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info.length > 0 ? (
        <ul role="status" className="list-disc pl-5 text-sm">
          {info.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {vue === null ? (
        erreur ? null : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Lecture des acomptes…
          </p>
        )
      ) : (
        <>
          {vue.warning ? (
            <p className="rounded-md border border-[var(--warn)]/50 p-3 text-sm">{vue.warning}</p>
          ) : null}
          {!vue.available ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Une facture liée est illisible par le moteur : les totaux ne sont pas affichés.
            </p>
          ) : null}
          {vue.byCurrency.length > 0 ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {vue.byCurrency.map((c) => (
                <div key={c.currency} className="rounded-md border border-[var(--border)] p-3">
                  <dt className="text-xs text-[var(--foreground-muted)]">
                    Acomptes en {c.currency}
                  </dt>
                  <dd className="font-mono">Demandé : {formatMontant(c.requested, c.currency)}</dd>
                  <dd className="font-mono">Facturé : {formatMontant(c.invoiced, c.currency)}</dd>
                  <dd className="font-mono">
                    En brouillon : {formatMontant(c.inDraft, c.currency)}
                  </dd>
                  <dd className="font-mono">Encaissé : {formatMontant(c.paid, c.currency)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {vue.deposits.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">Aucune facture d’acompte.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {vue.deposits.map((d) => (
                <li
                  key={d.invoiceId}
                  className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <Link href={lienFacture(d.invoiceId)} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono underline underline-offset-2">
                        {d.reference ?? 'Brouillon'}
                      </span>
                      <Pastille ton={d.state === 'draft' ? 'attention' : 'neutre'}>
                        {d.state === 'draft' ? 'Brouillon à émettre' : 'Émise'}
                      </Pastille>
                      {d.resolved ? <Pastille ton="neutre">Marqué traité</Pastille> : null}
                      {vue.unresolved.includes(d.invoiceId) ? (
                        <Pastille ton="attention">À traiter sur la facture finale</Pastille>
                      ) : null}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {d.total
                        ? `Total ${formatMontant(d.total, d.currency)}`
                        : 'Total indisponible'}
                      {d.requestedAmount
                        ? ` · demandé ${formatMontant(d.requestedAmount, d.currency)}`
                        : ''}
                      {d.gapToRequested && d.gapToRequested !== '0' && d.gapToRequested !== '0.00'
                        ? ` · écart ${d.gapToRequested} ${d.currency} (signalé, non corrigé)`
                        : ''}
                      {d.paid ? ` · encaissé ${formatMontant(d.paid, d.currency)}` : ''}
                      {d.recallCode ? ` · code rappelé : ${d.recallCode}` : ''}
                    </span>
                    {d.resolution ? (
                      <span className="text-xs">Traité : {d.resolution.reason}</span>
                    ) : null}
                  </Link>
                  {peutPreparer && d.state === 'issued' && !d.resolved ? (
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      onClick={() => setTraiter(d.invoiceId)}
                    >
                      Marquer traité
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {peutPreparer && ouvert ? (
            <button
              type="button"
              className={`${BOUTON_PETIT} self-start`}
              onClick={() => setAjout(true)}
            >
              + Facture d’acompte
            </button>
          ) : null}
        </>
      )}
      {ajout && vue ? (
        <FenetreAcompte
          devise={devise}
          onFermer={() => setAjout(false)}
          onPreparer={async (f) => {
            const prep = preparerAcompte(f, vue.owner.revision);
            if (!prep.ok) return prep.champs;
            const r = await salesContractsApi.prepareDeposit(proprietaire, ownerId, prep.corps);
            setVue(r.deposits);
            setInfo([
              'Brouillon de facture d’acompte préparé. Ouvrez-le dans la liste pour l’émettre.',
              ...phrasesAvertissements(r.warnings),
            ]);
            setAjout(false);
            onChange?.();
            return null;
          }}
        />
      ) : null}
      {traiter && vue ? (
        <FenetreMotif
          titre="Marquer l’acompte traité"
          description="Geste déclaratif : vous indiquez que la facture finale tient compte de cet acompte, comme convenu avec votre expert-comptable. Rien n’est retiré automatiquement."
          bouton="Marquer traité"
          onFermer={() => setTraiter(null)}
          onConfirmer={async (motif) => {
            const v = await salesContractsApi.resolveDeposit(
              proprietaire,
              ownerId,
              traiter,
              vue.owner.revision,
              motif,
            );
            setVue(v);
            setTraiter(null);
            onChange?.();
          }}
        />
      ) : null}
    </div>
  );
}

function FenetreAcompte({
  devise,
  onFermer,
  onPreparer,
}: {
  devise: string;
  onFermer: () => void;
  /** Rend les erreurs de champ, ou `null` si c'est fait. */
  onPreparer: (f: FormulaireAcompte) => Promise<Record<string, string> | null>;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireAcompte>(acompteVide);
  const [groupes, setGroupes] = useState<TaxGroupList | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api
      .getTaxGroups()
      .then(setGroupes)
      .catch(() => undefined);
  }, []);

  async function preparer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await onPreparer(f);
      if (r) setChamps(r);
    } catch (err) {
      setErreur(messageEngagement(err, 'Le brouillon d’acompte n’a pas pu être préparé.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Préparer une facture d’acompte"
      description="Un brouillon est créé : vous l’émettez ensuite depuis l’écran des factures. Aucun pourcentage n’est proposé et le groupe de taxation n’est jamais prérempli : leur choix est à confirmer avec votre expert-comptable."
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => void preparer()}
          >
            {envoi ? 'Préparation…' : 'Préparer le brouillon'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <FormGrid>
          <Field id={`${id}-type`} label="Type de facture" size="lg">
            <Select<'FT' | 'ET'>
              value={f.type}
              onChange={(v) => setF((x) => ({ ...x, type: v }))}
              options={[
                { value: 'FT', label: 'Facture d’acompte (FT)' },
                { value: 'ET', label: 'Facture d’acompte à l’export (ET)' },
              ]}
            />
          </Field>
          <Field
            id={`${id}-montant`}
            label="Montant demandé"
            required
            size="sm"
            newRow
            hint="Dans le mode de prix de l’engagement (TTC ou HT)."
            error={champs['requestedAmount']}
          >
            <MoneyInput
              value={f.montant}
              currency={devise}
              onChange={(v) => setF((x) => ({ ...x, montant: v }))}
            />
          </Field>
          <Field
            id={`${id}-groupe`}
            label="Groupe de taxation"
            required
            size="lg"
            newRow
            error={champs['taxGroup']}
          >
            <Select<string>
              value={f.groupe}
              placeholder="Choisir…"
              loading={groupes === null}
              onChange={(v) => setF((x) => ({ ...x, groupe: v }))}
              options={(groupes?.groups ?? []).map((g) => ({
                value: g.letter,
                label: `[${g.letter}] ${g.label}${g.ratePercent ? ` — ${g.ratePercent.replace('.', ',')} %` : ''}`,
                keywords: g.letter,
              }))}
            />
          </Field>
          <Field id={`${id}-libelle`} label="Libellé" optional size="full" error={champs['label']}>
            <TextInput
              value={f.libelle}
              maxLength={200}
              onChange={(e) => setF((x) => ({ ...x, libelle: e.target.value }))}
              placeholder="Acompte — prérempli par Lalanda si vide"
            />
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}
