'use client';

// Pièce jointe d'une réception ou d'une facture fournisseur (ADR-0044 § 2.7) : une
// par document. Servie inerte par l'API (téléchargement seulement) ; le web en fait
// un lien local. L'API vérifie le contenu (signature PDF, image assainie).

import type { PurchaseAttachmentView } from '@lalanda/shared/purchases';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { formatInstantJour, messageAchats } from './achats-model';
import { TYPES_PIECE, verifierPiece } from './factures-model';

function taille(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Kio`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mio`;
}

export function PieceJointe({
  piece,
  peutJoindre,
  manque,
  telecharger,
  envoyer,
  onEnvoyee,
}: {
  piece: PurchaseAttachmentView | null;
  peutJoindre: boolean;
  /** Phrase quand la pièce manque (« Facture sans pièce »). */
  manque: string;
  telecharger: () => Promise<Blob>;
  envoyer: (file: File) => Promise<void>;
  onEnvoyee: () => void;
}): React.ReactElement {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function ouvrir(): Promise<void> {
    if (piece === null) return;
    setErreur(null);
    try {
      const blob = await telecharger();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = piece.fileName;
      a.rel = 'noopener';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setErreur(messageAchats(err, 'Téléchargement impossible.'));
    }
  }

  async function joindre(file: File | undefined): Promise<void> {
    if (!file) return;
    const refus = verifierPiece(file);
    if (refus) {
      setErreur(refus);
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      await envoyer(file);
      onEnvoyee();
    } catch (err) {
      setErreur(messageAchats(err, 'Envoi de la pièce impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {piece ? (
        <div className="flex flex-wrap items-center gap-2">
          <Paperclip aria-hidden="true" className="h-4 w-4 text-[var(--module-run)]" />
          <span className="min-w-0 break-all">{piece.fileName}</span>
          <span className="text-xs text-[var(--foreground-muted)]">
            {taille(piece.size)} · {formatInstantJour(piece.uploadedAt)}
          </span>
          <button type="button" className={BOUTON_PETIT} onClick={() => void ouvrir()}>
            Télécharger
          </button>
        </div>
      ) : (
        <p className="text-[var(--foreground-muted)]">{manque}</p>
      )}
      {piece === null && peutJoindre ? (
        <label className={`${BOUTON_PETIT} w-fit cursor-pointer`}>
          {envoi ? 'Envoi…' : 'Joindre un PDF ou une photo'}
          <input
            type="file"
            accept={TYPES_PIECE}
            className="sr-only"
            disabled={envoi}
            onChange={(e) => void joindre(e.target.files?.[0])}
          />
        </label>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
