'use client';

// Briques visuelles des ressources humaines (ADR-0045 § 8, lot H6) : reprennent
// celles du CRM et des achats (bandeaux teintés, panneaux, tuiles), plus une
// phrase d'indisponibilité (route pas encore livrée : 404, jamais de donnée
// inventée) et une fenêtre de décision avec commentaire.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import type { LeaveRequestView } from '@/lib/api-hr';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import {
  LIBELLES_STATUT_DEMANDE,
  PHRASE_PAS_ENCORE,
  formatJours,
  libellePeriode,
  libelleType,
  messageRh,
  statutDe,
  tonStatutDemande,
} from './rh-model';

export { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';

/**
 * Échec d'une lecture : la phrase « pas encore disponible » pour un 404 (lot non
 * fusionné), sinon le message de l'API, avec « Réessayer » si fourni.
 */
export function EchecLecture({
  erreur,
  repli,
  onReessayer,
}: {
  erreur: unknown;
  repli: string;
  onReessayer?: () => void;
}): React.ReactElement {
  if (statutDe(erreur) === 404) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-5 text-center text-sm text-[var(--foreground-muted)]">
        {PHRASE_PAS_ENCORE}
      </p>
    );
  }
  return (
    <Alerte
      action={
        onReessayer ? (
          <button type="button" className={BOUTON_PETIT} onClick={onReessayer}>
            Réessayer
          </button>
        ) : undefined
      }
    >
      <p>{messageRh(erreur, repli)}</p>
    </Alerte>
  );
}

export function Chargement({ texte = 'Chargement…' }: { texte?: string }): React.ReactElement {
  return (
    <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
      {texte}
    </p>
  );
}

/** Une demande d'absence en ligne : type, période, jours (moteur), statut. */
export function LigneDemande({
  demande,
  nom,
  action,
}: {
  demande: LeaveRequestView;
  /** Nom du collaborateur, quand la liste mêle plusieurs personnes. */
  nom?: string | null;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium break-words">
          {nom ? `${nom} · ` : ''}
          {libelleType(demande)}
        </span>
        <span className="text-xs text-[var(--foreground-muted)]">
          {libellePeriode(demande.start, demande.end)} · {formatJours(demande.days)}
        </span>
        {demande.reason ? (
          <span className="text-xs break-words text-[var(--foreground-muted)]">
            Motif : {demande.reason}
          </span>
        ) : null}
      </span>
      <Badge tone={tonStatutDemande(demande.status)}>
        {LIBELLES_STATUT_DEMANDE[demande.status]}
      </Badge>
      {action}
    </li>
  );
}

/**
 * Fenêtre de décision : confirmation simple, commentaire facultatif ou
 * obligatoire. Vérifie le champ requis ; l'API revérifie et reste juge.
 */
export function DialogueDecision({
  titre,
  description,
  libelle,
  bouton,
  commentaire,
  children,
  onFermer,
  onValider,
}: {
  titre: string;
  description?: string;
  libelle: string;
  bouton: string;
  commentaire: 'obligatoire' | 'facultatif' | 'aucun';
  children?: React.ReactNode;
  onFermer: () => void;
  onValider: (texte: string) => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [texte, setTexte] = useState('');
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(): Promise<void> {
    const t = texte.trim();
    if (commentaire === 'obligatoire' && t === '') {
      setChamp('Le commentaire est obligatoire.');
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      await onValider(t);
    } catch (err) {
      setErreur(messageRh(err, 'Action impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description={description}
      size="sm"
      busy={envoi}
      dirty={texte.trim() !== ''}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi}
            onClick={() => void valider()}
          >
            {envoi ? 'Envoi…' : bouton}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {children}
        {commentaire !== 'aucun' ? (
          <Champ
            id={`${id}-texte`}
            label={libelle}
            requis={commentaire === 'obligatoire'}
            erreur={champ}
          >
            <textarea
              id={`${id}-texte`}
              rows={3}
              className={CHAMP}
              value={texte}
              maxLength={2000}
              onChange={(e) => setTexte(e.target.value)}
              {...aria(`${id}-texte`, champ)}
            />
          </Champ>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Enregistre un fichier reçu de l'API (lot H7) : lien local éphémère, révoqué
 * aussitôt. Rien n'est gardé en cache ni en stockage local.
 */
export function enregistrerFichier(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.rel = 'noopener';
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
