'use client';

// Réinitialisation de la double authentification d'un opérateur (ADR-0053 — P8).
//
// Super-administrateur seul (`platform.roles.manage`), jamais sur soi-même (deux
// personnes : l'opérateur qui a perdu son téléphone et ses codes, et un AUTRE
// super-administrateur), motif obligatoire, ré-authentification (mot de passe + code).
// L'API impose tout cela ; ce panneau ne fait que le dire.

import { useState } from 'react';

import { api } from '@/lib/api';

import { Bandeau } from './admin-chrome';
import { messageErreur } from './admin-model';
import { ChampsMotif } from './champs-motif';
import { MOTIF_VIDE, motifComplet, type MotifSaisi } from './motif-model';

export function ReinitialisationDeuxFacteurs({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): React.ReactElement {
  const [motif, setMotif] = useState<MotifSaisi>(MOTIF_VIDE);
  const [etat, setEtat] = useState<{ ton: 'succes' | 'echec'; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const complet = motifComplet(motif, { avecCategorie: true, avecMessageClient: false });

  async function reinitialiser(): Promise<void> {
    if (motif.reasonCategory === '') return;
    setEnvoi(true);
    setEtat(null);
    try {
      await api.resetPlatformTwoFactor(userId, {
        reasonCategory: motif.reasonCategory,
        internalNote: motif.internalNote.trim(),
      });
      setMotif(MOTIF_VIDE);
      setEtat({
        ton: 'succes',
        texte:
          'Double authentification réinitialisée : sessions révoquées. L’opérateur se ré-enrôlera à sa prochaine entrée dans la console.',
      });
    } catch (err) {
      setEtat({ ton: 'echec', texte: messageErreur(err, 'Réinitialisation refusée.') });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <p className="text-xs text-[var(--foreground-muted)]">
        Téléphone et codes de secours perdus : réinitialiser la double authentification de {email}.
        Vérifiez son identité hors de la plateforme avant d’agir.
      </p>
      <ChampsMotif motif={motif} onChange={setMotif} avecCategorie avecMessageClient={false} />
      <div>
        <button
          type="button"
          disabled={envoi || !complet}
          onClick={() => void reinitialiser()}
          className="rounded-md border border-[var(--danger)]/40 px-3 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-40"
        >
          Réinitialiser la double authentification
        </button>
      </div>
      {etat ? <Bandeau ton={etat.ton}>{etat.texte}</Bandeau> : null}
    </div>
  );
}
