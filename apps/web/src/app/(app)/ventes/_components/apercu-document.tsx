'use client';

// Aperçu d'un document de vente en fenêtre modale (ADR-0042 § 9).
//
// Le PDF vient de la route PDF existante (`GET …/pdf`), affiché dans un
// `<iframe>` sur une URL `blob:` : le navigateur ne compose rien. Trois gestes :
// envoyer par e-mail (préremplissage `GET …/email`, confirmation, `POST …/email`),
// télécharger (le même fichier, sans second rendu) et imprimer
// (`iframe.contentWindow.print()`, repli : ouvrir le PDF dans un onglet).
//
// Fenêtre : le `Modal` partagé de `@lalanda/ui` (taille `xl`) — dialogue,
// focus piégé et rendu à la fermeture, Échap, fond cliquable, confirmation si
// un message est en cours de saisie, aucune fermeture pendant l'envoi, plein
// écran sur téléphone.

import { Modal } from '@lalanda/ui';
import { useEffect, useId, useRef, useState } from 'react';

import {
  api,
  type DocumentEmailDraft,
  type DocumentEmailInput,
  type DocumentEmailResult,
} from '@/lib/api';
import { crmApi } from '@/lib/api-crm';
import { purchasesApi } from '@/lib/api-purchases';

import {
  destinataireDocument,
  lecteurPdfIntegre,
  messageErreurEnvoi,
  messageResultat,
  phraseConfirmation,
  raisonSansDroit,
  verifierEnvoi,
  type ErreursEnvoi,
  type FormulaireEnvoi,
  type GenreDocument,
} from './apercu-document-model';
import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Champ, aria } from './form-ui';

export interface DocumentApercu {
  genre: GenreDocument;
  id: string;
  /** Intitulé affiché : « Facture FV2610-000001 ». */
  titre: string;
  /** Nom de fichier de repli (l'en-tête de l'API l'emporte s'il est lisible). */
  nomFichier: string;
  /** Droit d'envoyer (`sales.invoice` / `sales.quote`) confirmé par le serveur. */
  peutEnvoyer: boolean;
}

interface Pdf {
  blob: Blob;
  filename: string;
  url: string;
}

const sources = {
  facture: {
    pdf: (id: string, nom: string) => api.downloadInvoicePdf(id, nom),
    brouillon: (id: string) => api.getInvoiceEmailDraft(id),
    envoyer: (id: string, corps: DocumentEmailInput) => api.sendInvoiceEmail(id, corps),
  },
  devis: {
    pdf: (id: string, nom: string) => crmApi.downloadQuotePdf(id, nom),
    brouillon: (id: string) => crmApi.getQuoteEmailDraft(id),
    envoyer: (id: string, corps: DocumentEmailInput) => crmApi.sendQuoteEmail(id, corps),
  },
  // ADR-0044 § 3.3 — bon de commande (chaîne PDF et envoi d'ADR-0042).
  'bon-de-commande': {
    pdf: (id: string, nom: string) => purchasesApi.downloadOrderPdf(id, nom),
    brouillon: (id: string) => purchasesApi.getOrderEmailDraft(id),
    envoyer: (id: string, corps: DocumentEmailInput) => purchasesApi.sendOrderEmail(id, corps),
  },
} as const;

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

function messageChargement(err: unknown): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    status?: unknown;
    message?: unknown;
  };
  if (e.status === 403) return 'Votre rôle ne permet pas d’afficher ce document.';
  if (e.status === 404) return 'Document introuvable.';
  return typeof e.message === 'string' && e.message !== ''
    ? e.message
    : 'Le PDF n’a pas pu être préparé.';
}

/** Bouton « Aperçu » et sa fenêtre. */
export function BoutonApercu({
  document: doc,
  className,
  libelle = 'Aperçu',
}: {
  document: DocumentApercu;
  className?: string;
  libelle?: string;
}): React.ReactElement {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? BOUTON}
        aria-haspopup="dialog"
        aria-label={libelle === 'Aperçu' ? `Aperçu — ${doc.titre}` : undefined}
        onClick={() => setOuvert(true)}
      >
        {libelle}
      </button>
      {ouvert ? <ApercuDocument document={doc} onFermer={() => setOuvert(false)} /> : null}
    </>
  );
}

export function ApercuDocument({
  document: doc,
  onFermer,
}: {
  document: DocumentApercu;
  onFermer: () => void;
}): React.ReactElement {
  const iframe = useRef<HTMLIFrameElement>(null);
  const id = useId();
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [lecteur] = useState(() =>
    lecteurPdfIntegre(typeof navigator === 'undefined' ? undefined : navigator),
  );

  useEffect(() => {
    let annule = false;
    let url: string | null = null;
    sources[doc.genre]
      .pdf(doc.id, doc.nomFichier)
      .then((r) => {
        if (annule) return;
        // Type forcé : un `blob:` sans type serait téléchargé au lieu d'être affiché.
        const blob =
          r.blob.type === 'application/pdf'
            ? r.blob
            : new Blob([r.blob], { type: 'application/pdf' });
        url = URL.createObjectURL(blob);
        setPdf({ blob, filename: r.filename, url });
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageChargement(err));
      });
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.genre, doc.id, doc.nomFichier]);

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
      // Navigateur qui bloque l'impression d'un cadre (Safari, Firefox selon la
      // version) : on ouvre le PDF, son lecteur a sa propre impression.
      ouvrirOnglet();
      setInfo('Le PDF s’est ouvert dans un nouvel onglet : imprimez-le depuis celui-ci.');
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={doc.titre}
      size="xl"
      busy={occupe}
      discardTitle="Abandonner le message en cours ?"
    >
      <div className="-mx-4 -my-4 flex min-h-full flex-col sm:-mx-5 sm:-my-5">
        <div className="flex flex-wrap items-start gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className={BOUTON}
              disabled={!doc.peutEnvoyer || envoi}
              aria-describedby={doc.peutEnvoyer ? undefined : `${id}-sans-droit`}
              aria-expanded={envoi}
              onClick={() => setEnvoi(true)}
            >
              Envoyer par e-mail
            </button>
            {doc.peutEnvoyer ? null : (
              <p
                id={`${id}-sans-droit`}
                className="max-w-xs text-xs text-[var(--foreground-muted)]"
              >
                {raisonSansDroit(doc.genre)}
              </p>
            )}
          </div>
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
              className="self-center text-sm underline sm:ml-auto"
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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {envoi ? (
            <FormulaireEmail
              document={doc}
              fichier={pdf?.filename ?? null}
              onFermer={() => setEnvoi(false)}
              onOccupe={setOccupe}
            />
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
                Préparation du PDF…
              </p>
            ) : lecteur ? (
              <iframe
                ref={iframe}
                src={pdf.url}
                title={`Aperçu PDF — ${doc.titre}`}
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
      </div>
    </Modal>
  );
}

type Etape =
  | { nom: 'chargement' }
  | { nom: 'saisie'; brouillon: DocumentEmailDraft }
  | { nom: 'confirmation'; brouillon: DocumentEmailDraft; corps: DocumentEmailInput }
  | { nom: 'envoi'; brouillon: DocumentEmailDraft; corps: DocumentEmailInput }
  | { nom: 'resultat'; brouillon: DocumentEmailDraft; resultat: DocumentEmailResult }
  | { nom: 'echec'; message: string };

function FormulaireEmail({
  document: doc,
  fichier,
  onFermer,
  onOccupe,
}: {
  document: DocumentApercu;
  fichier: string | null;
  onFermer: () => void;
  /** Envoi en cours : la fenêtre ne se ferme pas. */
  onOccupe: (occupe: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const [etape, setEtape] = useState<Etape>({ nom: 'chargement' });
  const [f, setF] = useState<FormulaireEnvoi>({ to: '', cc: '', subject: '', message: '' });
  const [erreurs, setErreurs] = useState<ErreursEnvoi>({});
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    sources[doc.genre]
      .brouillon(doc.id)
      .then((b) => {
        if (annule) return;
        setF({ to: b.to ?? '', cc: b.cc.join(', '), subject: b.subject, message: b.message });
        setEtape({ nom: 'saisie', brouillon: b });
      })
      .catch((err: unknown) => {
        if (!annule) setEtape({ nom: 'echec', message: messageErreurEnvoi(err) });
      });
    return () => {
      annule = true;
    };
  }, [doc.genre, doc.id]);

  const champ = (k: keyof FormulaireEnvoi) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function envoyer(brouillon: DocumentEmailDraft, corps: DocumentEmailInput): Promise<void> {
    setEtape({ nom: 'envoi', brouillon, corps });
    setErreurEnvoi(null);
    onOccupe(true);
    try {
      const resultat = await sources[doc.genre].envoyer(doc.id, corps);
      setEtape({ nom: 'resultat', brouillon, resultat });
    } catch (err) {
      setErreurEnvoi(messageErreurEnvoi(err));
      setEtape({ nom: 'saisie', brouillon });
    } finally {
      onOccupe(false);
    }
  }

  const cadre = 'flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5';
  const titre = (
    <h3 className="text-sm font-semibold" id={`${id}-titre`}>
      Envoyer par e-mail
    </h3>
  );

  if (etape.nom === 'chargement') {
    return (
      <section aria-labelledby={`${id}-titre`} className={cadre}>
        {titre}
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Préparation du message…
        </p>
      </section>
    );
  }
  if (etape.nom === 'echec') {
    return (
      <section aria-labelledby={`${id}-titre`} className={cadre}>
        {titre}
        <Alerte>
          <p>{etape.message}</p>
        </Alerte>
        <button type="button" className={`${BOUTON_PETIT} self-start`} onClick={onFermer}>
          Fermer
        </button>
      </section>
    );
  }
  if (!etape.brouillon.sendable) {
    return (
      <section aria-labelledby={`${id}-titre`} className={cadre}>
        {titre}
        <Alerte>
          <p>{etape.brouillon.reason ?? 'Ce document ne peut pas être envoyé.'}</p>
        </Alerte>
        <button type="button" className={`${BOUTON_PETIT} self-start`} onClick={onFermer}>
          Fermer
        </button>
      </section>
    );
  }
  if (etape.nom === 'resultat') {
    const m = messageResultat(etape.resultat);
    return (
      <section aria-labelledby={`${id}-titre`} className={cadre}>
        {titre}
        {m.ok ? (
          <p role="status" className="text-sm">
            {m.texte}
          </p>
        ) : (
          <Alerte>
            <p>{m.texte}</p>
          </Alerte>
        )}
        <button type="button" className={`${BOUTON_PETIT} self-start`} onClick={onFermer}>
          Fermer
        </button>
      </section>
    );
  }
  if (etape.nom === 'confirmation' || etape.nom === 'envoi') {
    const { brouillon, corps } = etape;
    return (
      <section aria-labelledby={`${id}-titre`} className={cadre}>
        {titre}
        <p className="text-sm" role="alert">
          {phraseConfirmation(corps, fichier ?? brouillon.attachmentName)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BOUTON}
            disabled={etape.nom === 'envoi'}
            onClick={() => void envoyer(brouillon, corps)}
            autoFocus
          >
            {etape.nom === 'envoi' ? 'Envoi…' : 'Confirmer l’envoi'}
          </button>
          <button
            type="button"
            className={BOUTON}
            disabled={etape.nom === 'envoi'}
            onClick={() => setEtape({ nom: 'saisie', brouillon })}
          >
            Modifier
          </button>
        </div>
      </section>
    );
  }

  const brouillon = etape.brouillon;
  return (
    <section aria-labelledby={`${id}-titre`} className={cadre}>
      {titre}
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = verifierEnvoi(f);
          setErreurs(v.erreurs);
          if (v.corps) setEtape({ nom: 'confirmation', brouillon, corps: v.corps });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id={`${id}-to`} label="Destinataire" requis erreur={erreurs.to}>
            <input
              id={`${id}-to`}
              type="email"
              autoComplete="email"
              className={CHAMP}
              value={f.to}
              maxLength={254}
              onChange={(e) => champ('to')(e.target.value)}
              {...aria(`${id}-to`, erreurs.to)}
            />
          </Champ>
          <Champ
            id={`${id}-cc`}
            label="Copie (facultatif)"
            aide="Jusqu’à cinq adresses, séparées par des virgules."
            erreur={erreurs.cc}
          >
            <input
              id={`${id}-cc`}
              type="text"
              inputMode="email"
              className={CHAMP}
              value={f.cc}
              onChange={(e) => champ('cc')(e.target.value)}
              {...aria(`${id}-cc`, erreurs.cc, true)}
            />
          </Champ>
        </div>
        <Champ id={`${id}-objet`} label="Objet" requis erreur={erreurs.subject}>
          <input
            id={`${id}-objet`}
            type="text"
            className={CHAMP}
            value={f.subject}
            maxLength={200}
            onChange={(e) => champ('subject')(e.target.value)}
            {...aria(`${id}-objet`, erreurs.subject)}
          />
        </Champ>
        <Champ id={`${id}-message`} label="Message" erreur={erreurs.message}>
          <textarea
            id={`${id}-message`}
            rows={6}
            className={CHAMP}
            value={f.message}
            maxLength={5000}
            onChange={(e) => champ('message')(e.target.value)}
            {...aria(`${id}-message`, erreurs.message)}
          />
        </Champ>
        <p className="text-xs text-[var(--foreground-muted)]">
          Pièce jointe : {fichier ?? brouillon.attachmentName ?? 'le PDF du document'}.{' '}
          {destinataireDocument(doc.genre)} pourra vous répondre directement.
        </p>
        {erreurEnvoi ? (
          <Alerte>
            <p>{erreurEnvoi}</p>
          </Alerte>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BOUTON}>
            Continuer
          </button>
          <button type="button" className={BOUTON} onClick={onFermer}>
            Annuler
          </button>
        </div>
      </form>
    </section>
  );
}
