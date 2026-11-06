'use client';

// Briques du second volet des ressources humaines (ADR-0051 § 10, lot H16) : moi (fiche
// et compte), mon équipe, fonction éteinte expliquée, carte entièrement cliquable,
// aperçu d'un justificatif sans adresse publique.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Power } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { hrApi } from '@/lib/api-hr';
import { rh2Api } from '@/lib/api-rh-2';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { apercuEnLigne, type Moi } from './frais-model';
import { useAccesRh } from './rh-access';
import { explicationEteinte, messageRh2, type Fonction } from './rh2-model';
import { nomAffiche, type Ton } from './rh-model';
import { enregistrerFichier } from './rh-ui';

/** Ma fiche et mon compte, lus dans `GET /hr/me` par la coquille. */
export function useMoi(): Moi & {
  estManager: boolean;
  estResponsableEquipe: boolean;
  membresMenes: string[];
} {
  const { moi } = useAccesRh();
  return useMemo(() => {
    const v = moi?.ok ? moi.valeur : null;
    return {
      employeeId: v?.employee?.id ?? null,
      userId: v?.employee?.userId ?? null,
      estManager: v?.isManager === true,
      // ADR-0066 § 1 : responsable d'une équipe RH (valide l'étape « manager »).
      estResponsableEquipe: v?.isTeamLead === true,
      membresMenes: v?.ledEmployeeIds ?? [],
    };
  }, [moi]);
}

/** Fiches de mon équipe (relation de manager), lues une fois ; vide sinon. */
export function useEquipe(estManager: boolean): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!estManager) return;
    let annule = false;
    hrApi
      .getTeam()
      .then((t) => {
        if (!annule) setIds(t.members.map((m) => m.employee.id));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [estManager]);
  return ids;
}

/** Fonction éteinte : ce qu'elle fait, pourquoi elle est éteinte, qui l'active. Aucune donnée. */
export function FonctionEteinte({
  fonction,
  actions,
}: {
  fonction: Fonction;
  actions: readonly OrgAction[] | null;
}): React.ReactElement {
  const e = explicationEteinte(fonction, actions);
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-5 sm:p-6">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Power aria-hidden="true" className="h-4 w-4 text-[var(--foreground-muted)]" />
        {e.titre}
      </p>
      <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">{e.texte}</p>
      <p className="text-sm">{e.action}</p>
    </div>
  );
}

/** Carte entièrement cliquable (un seul bouton) : titre, détail, statut, montant. */
export function Carte({
  titre,
  detail,
  statut,
  ton,
  valeur,
  onOuvrir,
}: {
  titre: React.ReactNode;
  detail?: React.ReactNode;
  statut: string;
  ton: Ton;
  valeur?: React.ReactNode;
  onOuvrir: () => void;
}): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onOuvrir}
        className="flex h-full w-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--accent)] focus-visible:border-[var(--accent)] sm:p-4"
      >
        <span className="flex w-full flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 flex-1 font-medium break-words">{titre}</span>
          <Badge tone={ton}>{statut}</Badge>
        </span>
        {detail ? <span className="text-xs text-[var(--foreground-muted)]">{detail}</span> : null}
        {valeur ? (
          <span className="font-display text-base font-bold tabular-nums">{valeur}</span>
        ) : null}
      </button>
    </li>
  );
}

/** Grille de cartes, pleine largeur. */
export function GrilleCartes({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {children}
    </ul>
  );
}

/**
 * Bouton « Voir le justificatif » : lu avec la session en octets, affiché par une
 * adresse locale éphémère (`blob:`) révoquée à la fermeture ; un PDF s'enregistre
 * (servi inerte). Aucune adresse publique, rien en cache.
 */
export function VoirJustificatif({
  reportId,
  lineId,
  libelle,
}: {
  reportId: string;
  lineId: string;
  libelle: string;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function ouvrir(): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      const f = await rh2Api.downloadReceipt(reportId, lineId);
      if (apercuEnLigne(f.contentType)) setUrl(URL.createObjectURL(f.blob));
      else enregistrerFichier(f.blob, `justificatif-${lineId}.pdf`);
    } catch (err) {
      setErreur(messageRh2(err, 'Justificatif illisible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <button type="button" className={BOUTON_PETIT} disabled={envoi} onClick={() => void ouvrir()}>
        {envoi ? 'Ouverture…' : 'Voir le justificatif'}
      </button>
      {erreur ? <span className="text-xs text-[var(--danger)]">{erreur}</span> : null}
      <Modal
        open={url !== null}
        onClose={() => setUrl(null)}
        title="Justificatif"
        description={libelle}
        size="lg"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              onClick={() => setUrl(null)}
            >
              Fermer
            </button>
          </div>
        }
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- adresse `blob:` locale, éphémère
          <img src={url} alt={`Justificatif : ${libelle}`} className="mx-auto max-h-[70dvh]" />
        ) : null}
      </Modal>
    </>
  );
}

/** Échec d'une action, dit en français simple. */
export function ErreurAction({ erreur }: { erreur: string | null }): React.ReactElement | null {
  if (!erreur) return null;
  return (
    <Alerte>
      <p>{erreur}</p>
    </Alerte>
  );
}

/**
 * Noms des collaborateurs que l'appelant peut lire : tout le personnel avec `hr.read`,
 * sinon son équipe ; toujours sa propre fiche. Repli « Collaborateur » ailleurs.
 */
export function useNoms(lireTout: boolean, estManager: boolean): Map<string, string> {
  const { moi } = useAccesRh();
  const [noms, setNoms] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let annule = false;
    const source = lireTout
      ? hrApi.listEmployees({ limit: 200 }).then((p) => p.items)
      : estManager
        ? hrApi.getTeam().then((t) => t.members.map((m) => m.employee))
        : Promise.resolve([]);
    source
      .then((items) => {
        if (annule) return;
        const m = new Map<string, string>();
        for (const e of items) m.set(e.id, nomAffiche(e));
        setNoms(m);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [lireTout, estManager]);
  return useMemo(() => {
    const m = new Map(noms);
    const e = moi?.ok ? moi.valeur.employee : null;
    if (e) m.set(e.id, `${nomAffiche(e)} (moi)`);
    return m;
  }, [noms, moi]);
}
