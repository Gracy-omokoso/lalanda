'use client';

// Exports pour l'expert-comptable (ADR-0049 § 9, § 13) : choix du format et de la
// période, historique avec empreintes. Chaque fichier porte l'en-tête « Projet — à
// valider par un expert-comptable » et, en simulation, la marque « SIMULATION ».

import type { AccountingMode } from '@lalanda/shared/accounting';
import { Badge, Button } from '@lalanda/ui';
import { Download, History } from 'lucide-react';
import { useState } from 'react';

import {
  accountingApi,
  type AccountingExportFormat,
  type AccountingExportKind,
} from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import { useAccesCompta } from './comptabilite-access';
import {
  bornesDuMois,
  formatInstantJour,
  formatJour,
  messageCompta,
  moisDe,
  peutExporter,
} from './comptabilite-model';
import {
  Bandeau,
  CarteVide,
  Chargement,
  ChoixMois,
  EchecLecture,
  Panneau,
} from './comptabilite-ui';
import {
  LIBELLES_FORMAT,
  TYPES_EXPORT,
  empreinteCourte,
  formatsDe,
  titreExport,
} from './exports-model';
import { useLecture } from './use-lecture';

function phraseModeExport(mode: AccountingMode | null): string | null {
  if (mode === 'simulation') {
    return 'Mode simulation : le nom et l’en-tête de chaque fichier portent la mention « SIMULATION ».';
  }
  if (mode === 'off') return 'La comptabilité est éteinte : il n’y a rien à exporter.';
  return null;
}

export function Exports(): React.ReactElement {
  const { actions, mode } = useAccesCompta();
  const [kind, setKind] = useState<AccountingExportKind>('entries');
  const [format, setFormat] = useState<AccountingExportFormat>('csv');
  const [mois, setMois] = useState(() => moisDe(new Date()));
  const [version, setVersion] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const historique = useLecture(() => accountingApi.listExports(), `${version}-${String(mode)}`);
  const autorise = peutExporter(actions);
  const phrase = phraseModeExport(mode);

  async function exporter(): Promise<void> {
    const b = bornesDuMois(mois);
    if (b === null) {
      setErreur('Choisissez un mois.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await accountingApi.createExport({ kind, format, from: b.from, to: b.to });
      setVersion((v) => v + 1);
    } catch (err) {
      setErreur(messageCompta(err, 'L’export a échoué.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Download}
        titre="Exports"
        sousTitre="Des fichiers propres pour votre expert-comptable. Chaque export est enregistré avec son empreinte."
      >
        {phrase ? <p className="text-sm font-medium">{phrase}</p> : null}
        {autorise ? (
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="compta-export-type" className="flex flex-col gap-1 text-sm font-medium">
              Contenu
              <select
                id="compta-export-type"
                className={`${CHAMP} sm:w-72`}
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as AccountingExportKind;
                  setKind(k);
                  setFormat(formatsDe(k)[0] ?? 'csv');
                }}
              >
                {TYPES_EXPORT.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.libelle}
                  </option>
                ))}
              </select>
            </label>
            <label
              htmlFor="compta-export-format"
              className="flex flex-col gap-1 text-sm font-medium"
            >
              Format
              <select
                id="compta-export-format"
                className={`${CHAMP} sm:w-60`}
                value={format}
                onChange={(e) => setFormat(e.target.value as AccountingExportFormat)}
              >
                {formatsDe(kind).map((f) => (
                  <option key={f} value={f}>
                    {LIBELLES_FORMAT[f]}
                  </option>
                ))}
              </select>
            </label>
            <ChoixMois id="compta-export-mois" libelle="Mois" valeur={mois} onChange={setMois} />
            <Button
              variant="primary"
              busy={envoi}
              disabled={mode === 'off'}
              onClick={() => void exporter()}
            >
              Préparer l’export
            </Button>
          </div>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            Votre rôle permet de consulter l’historique, pas de créer un export.
          </p>
        )}
        {erreur ? (
          <p role="alert" className="text-sm font-medium text-[var(--danger)]">
            {erreur}
          </p>
        ) : null}
        <p className="text-xs text-[var(--foreground-muted)]">
          Le format attendu par le logiciel de votre expert-comptable reste à confirmer avec lui.
        </p>
      </Bandeau>

      <Panneau titre="Historique" icone={History} id="compta-exports-historique">
        {historique === null ? (
          <Chargement />
        ) : !historique.ok ? (
          <EchecLecture erreur={historique.erreur} repli="L’historique est illisible." />
        ) : historique.valeur.items.length === 0 ? (
          <CarteVide>Aucun export pour le moment.</CarteVide>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {historique.valeur.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 font-medium">
                  {titreExport(e)}
                  <span className="block text-xs font-normal text-[var(--foreground-muted)]">
                    Du {formatJour(e.from)} au {formatJour(e.to)} · préparé le{' '}
                    {formatInstantJour(e.createdAt)}
                  </span>
                </span>
                {e.simulation ? <Badge tone="warning">Simulation</Badge> : null}
                <Badge tone="neutral">{e.format.toUpperCase()}</Badge>
                <span className="font-mono text-xs" title={e.sha256}>
                  Empreinte {empreinteCourte(e.sha256)}
                </span>
                {autorise ? (
                  <a
                    href={accountingApi.exportFileUrl(e.id)}
                    className="underline underline-offset-2"
                    rel="noopener"
                  >
                    Télécharger
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panneau>
    </section>
  );
}
