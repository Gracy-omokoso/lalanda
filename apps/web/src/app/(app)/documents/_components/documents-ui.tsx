'use client';

// Briques visuelles de la bibliothèque (ADR-0046, lot S9) : celles des équipements,
// des stocks et des RH ; la liste des membres de l'organisation (droits des
// dossiers, auteurs) ; une carte de document entièrement cliquable.

import { Badge } from '@lalanda/ui';
import { FileText, Lock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { LibraryDocumentView } from '@/lib/api-documents';

import { useShell } from '../../_components/shell-context';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  LIBELLES_NATURE,
  badgeExpiration,
  formatJour,
  lienDocument,
  messageDocuments,
} from './documents-model';

export {
  CARTE,
  CarteVide,
  Chargement,
  ChampNombre,
} from '../../equipements/_components/equipements-ui';
export { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
export { enregistrerFichier } from '../../rh/_components/rh-ui';

export function EchecLecture({
  erreur,
  repli,
  onReessayer,
}: {
  erreur: unknown;
  repli: string;
  onReessayer?: () => void;
}): React.ReactElement {
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
      <p>{messageDocuments(erreur, repli)}</p>
    </Alerte>
  );
}

export interface MembreOrg {
  userId: string;
  name: string;
}

/** Membres de l'organisation (`GET /organizations/:id/members`) ; vide si illisible. */
export function useMembres(): MembreOrg[] {
  const { organizationId } = useShell();
  const [membres, setMembres] = useState<MembreOrg[]>([]);
  useEffect(() => {
    if (organizationId === null) return;
    let annule = false;
    api
      .listMembers(organizationId)
      .then((r) => {
        if (!annule) {
          setMembres(
            r.members.map((m) => ({ userId: m.userId, name: m.name ?? m.email ?? 'Membre' })),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [organizationId]);
  return membres;
}

export function nomMembre(membres: readonly MembreOrg[], userId: string): string {
  return membres.find((m) => m.userId === userId)?.name ?? 'un membre';
}

export function BadgeSensible(): React.ReactElement {
  return (
    <Badge tone="warning">
      <Lock aria-hidden="true" className="mr-1 inline h-3 w-3" />
      Sensible
    </Badge>
  );
}

/** Carte d'un document, entièrement cliquable vers sa fiche. */
export function CarteDocument({
  d,
  dossier,
}: {
  d: LibraryDocumentView;
  dossier?: string | null;
}): React.ReactElement {
  const exp = badgeExpiration(d.expiryStatus, d.expiresOn, formatJour);
  return (
    <Link
      href={lienDocument(d.id)}
      className="flex h-full w-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
    >
      <span className="flex items-start gap-2">
        <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--module-run)]" />
        <span className="min-w-0 flex-1 font-semibold break-words">{d.title}</span>
      </span>
      <span className="text-xs text-[var(--foreground-muted)]">
        {LIBELLES_NATURE[d.nature]}
        {dossier ? ` · ${dossier}` : ''} · version {d.versionCount}
      </span>
      {d.sensitive || exp || d.status === 'archived' ? (
        <span className="flex flex-wrap gap-1">
          {d.sensitive ? <BadgeSensible /> : null}
          {exp ? <Badge tone={exp.ton}>{exp.texte}</Badge> : null}
          {d.status === 'archived' ? <Badge tone="neutral">Corbeille</Badge> : null}
        </span>
      ) : null}
      {d.tags.length > 0 ? (
        <span className="flex flex-wrap gap-1 text-xs text-[var(--foreground-muted)]">
          {d.tags.map((t) => (
            <span key={t} className="rounded-full border border-[var(--border)] px-2 py-0.5">
              #{t}
            </span>
          ))}
        </span>
      ) : null}
    </Link>
  );
}
