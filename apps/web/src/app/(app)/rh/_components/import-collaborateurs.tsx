'use client';

// Import du personnel existant (ADR-0068 § 4) : modèle CSV, fichier .xlsx ou .csv,
// aperçu ligne par ligne (erreurs qui écartent la ligne, avertissements), puis
// création des lignes valides. Les matricules du fichier sont conservés ; les autres
// sont attribués. Option : inviter sur Lalanda les lignes qui ont un e-mail
// (`members.invite` exigé : sans lui, rien ne part). L'API reste juge.

import { Badge, buttonClasses } from '@lalanda/ui';
import { FileUp, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  LIBELLES_INVITATION,
  hrLot1Api,
  type EmployeeImportPreview,
  type EmployeeImportResult,
} from '@/lib/api-hr-lot1';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { peutInviterSurLalanda } from './lot1-model';
import { useAccesRh } from './rh-access';
import { RH_BASE, formatJour, lienCollaborateur, messageRh, peutGererRh } from './rh-model';
import { Bandeau, PhraseSection } from './rh-ui';

export function ImportCollaborateurs(): React.ReactElement {
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions);
  const peutInviter = peutInviterSurLalanda(actions);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<EmployeeImportPreview | null>(null);
  const [resultat, setResultat] = useState<EmployeeImportResult | null>(null);
  const [inviter, setInviter] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  if (!gerer) {
    return (
      <PhraseSection>
        L’import du personnel est réservé aux rôles qui gèrent les dossiers des collaborateurs.
      </PhraseSection>
    );
  }

  async function lireFichier(f: File): Promise<void> {
    setFichier(f);
    setApercu(null);
    setResultat(null);
    setErreur(null);
    setEnvoi(true);
    try {
      setApercu(await hrLot1Api.previewImport(f));
    } catch (err) {
      setErreur(messageRh(err, 'Le fichier n’a pas pu être lu.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function importer(): Promise<void> {
    if (!fichier || !apercu) return;
    setEnvoi(true);
    setErreur(null);
    try {
      setResultat(
        await hrLot1Api.applyImport(fichier, {
          invite: peutInviter && inviter,
          skipInvalid: apercu.counts.invalid > 0,
        }),
      );
    } catch (err) {
      setErreur(messageRh(err, 'L’import a échoué.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function modele(): Promise<void> {
    try {
      const blob = await hrLot1Api.downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modele-import-collaborateurs.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErreur(messageRh(err, 'Le modèle n’a pas pu être téléchargé.'));
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={FileUp}
        titre="Importer des collaborateurs"
        sousTitre="Reprenez votre registre du personnel depuis Excel (.xlsx) ou un fichier .csv. Rien n’est créé avant votre confirmation ; les matricules du fichier sont conservés."
        actions={
          <button type="button" className={BOUTON_PETIT} onClick={() => void modele()}>
            Télécharger le modèle (.csv)
          </button>
        }
      >
        <label className="flex flex-wrap items-center gap-3 text-sm">
          <span className={buttonClasses('secondary', 'sm')}>
            <Upload aria-hidden="true" className="h-4 w-4" />
            Choisir un fichier
          </span>
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void lireFichier(f);
            }}
          />
          <span className="text-xs text-[var(--foreground-muted)]">
            {fichier
              ? fichier.name
              : 'Colonnes : Matricule, Nom, Prénom, Poste, Service, Type de contrat, Date d’entrée, Fin de contrat, E-mail professionnel, Téléphone, Lieu de travail.'}
          </span>
        </label>
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {envoi && !apercu ? <p className="text-sm">Lecture du fichier…</p> : null}

      {apercu && !resultat ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {apercu.counts.total} ligne(s) : <strong>{apercu.counts.valid} valide(s)</strong>
            {apercu.counts.invalid > 0 ? `, ${apercu.counts.invalid} en erreur (écartée(s))` : ''}
            {apercu.counts.warnings > 0 ? `, ${apercu.counts.warnings} avec avertissement` : ''}.
          </p>
          {apercu.columns.some((c) => c.field === null) ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Colonnes ignorées :{' '}
              {apercu.columns
                .filter((c) => c.field === null)
                .map((c) => c.header || '(sans titre)')
                .join(', ')}
              .
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)]">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--foreground-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Ligne</th>
                  <th className="px-3 py-2 font-medium">Collaborateur</th>
                  <th className="px-3 py-2 font-medium">Matricule</th>
                  <th className="px-3 py-2 font-medium">Poste</th>
                  <th className="px-3 py-2 font-medium">Entrée</th>
                  <th className="px-3 py-2 font-medium">Contrôle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {apercu.rows.map((r) => (
                  <tr key={r.row} className={r.valid ? '' : 'bg-[var(--surface-muted)]'}>
                    <td className="px-3 py-2">{r.row}</td>
                    <td className="px-3 py-2 break-words">
                      {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                      {r.workEmail ? (
                        <span className="block text-xs text-[var(--foreground-muted)]">
                          {r.workEmail}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{r.employeeNumber ?? 'attribué'}</td>
                    <td className="px-3 py-2 break-words">
                      {r.jobTitle || '—'}
                      {r.departmentName ? ` · ${r.departmentName}` : ''}
                    </td>
                    <td className="px-3 py-2">{r.startDate ? formatJour(r.startDate) : '—'}</td>
                    <td className="px-3 py-2">
                      {r.issues.length === 0 ? (
                        <Badge tone="success">Prête</Badge>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {r.issues.map((i, n) => (
                            <li key={n} className="flex items-start gap-1 text-xs">
                              <Badge tone={i.level === 'error' ? 'danger' : 'warning'}>
                                {i.level === 'error' ? 'Erreur' : 'À noter'}
                              </Badge>
                              <span>{i.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={peutInviter && inviter}
              disabled={!peutInviter}
              onChange={(e) => setInviter(e.target.checked)}
            />
            Inviter sur Lalanda les collaborateurs qui ont un e-mail professionnel
          </label>
          {!peutInviter ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Vous n’avez pas le droit d’inviter : les fiches seront créées sans invitation, un
              administrateur pourra inviter depuis chaque fiche.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              disabled={envoi || apercu.counts.valid === 0}
              onClick={() => void importer()}
            >
              {envoi
                ? 'Import…'
                : apercu.counts.invalid > 0
                  ? `Importer les ${apercu.counts.valid} ligne(s) valide(s)`
                  : `Importer ${apercu.counts.valid} collaborateur(s)`}
            </button>
          </div>
        </div>
      ) : null}

      {resultat ? (
        <div className="flex flex-col gap-3 text-sm">
          <p role="status">
            {resultat.created.length} collaborateur(s) créé(s)
            {resultat.skippedRows.length > 0
              ? ` ; ligne(s) écartée(s) : ${resultat.skippedRows.join(', ')}`
              : ''}
            .
          </p>
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {resultat.created.map((c) => (
              <li key={c.employeeId} className="flex flex-wrap justify-between gap-2 py-1.5">
                <Link className="underline" href={lienCollaborateur(c.employeeId)}>
                  Ligne {c.row} — {c.employeeNumber ?? 'sans matricule'}
                </Link>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {LIBELLES_INVITATION[c.invitation]}
                </span>
              </li>
            ))}
          </ul>
          <Link className={`${BOUTON_PETIT} self-start`} href={`${RH_BASE}/collaborateurs`}>
            Voir les collaborateurs
          </Link>
        </div>
      ) : null}
    </section>
  );
}
