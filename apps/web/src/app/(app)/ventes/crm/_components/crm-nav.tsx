'use client';

// Sous-navigation du CRM (ADR-0035 § 5) et import/export CSV partagés.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { type ImportResult } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT } from '../../_components/form-ui';

import { CRM_BASE, erreursImport, messageCrm } from './crm-model';

const LIENS = [
  { href: CRM_BASE, label: 'Pipeline' },
  { href: `${CRM_BASE}/contacts`, label: 'Contacts et prospects' },
  { href: `${CRM_BASE}/reglages`, label: 'Réglages du pipeline' },
];

export function CrmNav(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections du CRM" className="flex flex-wrap gap-3 text-sm">
      {LIENS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={pathname === l.href ? 'page' : undefined}
          className={
            pathname === l.href
              ? 'font-semibold underline underline-offset-4'
              : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
          }
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

function telecharger(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Import (essai puis confirmation) et export CSV ; réservés à `crm.manage`. */
export function CsvActions({
  quoi,
  colonnes,
  exporter,
  importer,
  onImporte,
}: {
  quoi: string;
  colonnes: string;
  exporter: () => Promise<{ blob: Blob; filename: string }>;
  importer: (csv: string, dryRun: boolean) => Promise<ImportResult>;
  onImporte: () => void;
}): React.ReactElement {
  const [erreur, setErreur] = useState<string | null>(null);
  const [lignes, setLignes] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);

  async function choisir(fichier: File | undefined): Promise<void> {
    setErreur(null);
    setLignes([]);
    setInfo(null);
    if (!fichier) return;
    const csv = await fichier.text();
    try {
      const essai = await importer(csv, true);
      if (!window.confirm(`${essai.rows} ligne(s) valides. Importer ${quoi} ?`)) return;
      const r = await importer(csv, false);
      setInfo(`${r.created} ${quoi} importé(s).`);
      onImporte();
    } catch (err) {
      setErreur(messageCrm(err, 'Import impossible.'));
      setLignes(erreursImport(err));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BOUTON_PETIT}
          onClick={() =>
            void exporter()
              .then((r) => telecharger(r.blob, r.filename))
              .catch((err) => setErreur(messageCrm(err, 'Export impossible.')))
          }
        >
          Exporter en CSV
        </button>
        <label className={`${BOUTON_PETIT} cursor-pointer`}>
          Importer un CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              void choisir(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-xs text-[var(--foreground-muted)]">Colonnes : {colonnes}</span>
      </div>
      {info ? (
        <p role="status" className="text-sm">
          {info}
        </p>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
          {lignes.length > 0 ? (
            <ul className="list-disc pl-5">
              {lignes.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
    </div>
  );
}
