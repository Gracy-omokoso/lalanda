'use client';

// Onglet "Amortissements" — S14c.
// Tableau année × immobilisation + ligne total DAP + ligne total VNC.
// Le calcul est fait côté moteur (SYSCOHADA linéaire, prorata temporis 1re année).

import type { AmortissementsView } from '@/lib/api';

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

interface Props {
  amortissements: AmortissementsView;
  currency: string;
}

export function AmortissementsTable({ amortissements, currency }: Props): React.ReactElement {
  const { horizonAnnees, lignes, dapParAnnee, vncParAnnee } = amortissements;
  const annees = Array.from({ length: horizonAnnees }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        Amortissements SYSCOHADA — dotations annuelles
      </h3>

      {lignes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune immobilisation déclarée pour ce projet.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-[var(--foreground-muted)]">
              Dotations aux amortissements (linéaire, prorata temporis 1re année)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="py-2 pr-2 font-medium text-[var(--foreground-muted)]">
                      Immobilisation
                    </th>
                    <th className="py-2 px-2 font-medium text-[var(--foreground-muted)]">
                      Catégorie
                    </th>
                    <th className="py-2 px-2 text-right font-medium text-[var(--foreground-muted)]">
                      Durée
                    </th>
                    <th className="py-2 px-2 text-right font-medium text-[var(--foreground-muted)]">
                      Montant HT
                    </th>
                    {annees.map((a) => (
                      <th
                        key={a}
                        className="py-2 px-2 text-right font-medium text-[var(--foreground-muted)]"
                      >
                        DAP A{a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((li, i) => (
                    <tr key={`${li.label}-${i}`} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-2">{li.label}</td>
                      <td className="py-2 px-2 text-xs text-[var(--foreground-muted)]">
                        {formatCategorie(li.categorie)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{li.dureeAnnees} ans</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {formatMoney(li.montantHt, currency)}
                      </td>
                      {li.dotations.map((d, j) => (
                        <td key={j} className="py-2 px-2 text-right tabular-nums">
                          {formatMoney(d, currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-b border-[var(--border)] font-semibold text-[var(--accent)]">
                    <td className="py-2 pr-2" colSpan={4}>
                      TOTAL DAP
                    </td>
                    {dapParAnnee.map((v, i) => (
                      <td key={i} className="py-2 px-2 text-right tabular-nums">
                        {formatMoney(v, currency)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-[var(--foreground-muted)]">
              Valeur nette comptable (VNC) en fin d&apos;année
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="py-2 pr-2 font-medium text-[var(--foreground-muted)]">
                      Immobilisation
                    </th>
                    {annees.map((a) => (
                      <th
                        key={a}
                        className="py-2 px-2 text-right font-medium text-[var(--foreground-muted)]"
                      >
                        VNC fin A{a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((li, i) => (
                    <tr key={`vnc-${li.label}-${i}`} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-2">{li.label}</td>
                      {li.vnc.map((v, j) => (
                        <td key={j} className="py-2 px-2 text-right tabular-nums">
                          {formatMoney(v, currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-b border-[var(--border)] font-semibold">
                    <td className="py-2 pr-2">TOTAL VNC</td>
                    {vncParAnnee.map((v, i) => (
                      <td key={i} className="py-2 px-2 text-right tabular-nums">
                        {formatMoney(v, currency)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[11px] italic text-[var(--foreground-muted)]">
            Durées standard SYSCOHADA révisé (AUDCIF 2017), méthode linéaire. À faire valider par
            un expert-comptable local pour tout dépôt bancaire officiel.
          </p>
        </>
      )}
    </div>
  );
}

const CATEGORIE_LABELS: Record<string, string> = {
  constructions: 'Constructions',
  materiel_outillage: 'Matériel & outillage',
  materiel_transport: 'Matériel de transport',
  materiel_informatique: 'Matériel informatique',
  mobilier_bureau: 'Mobilier de bureau',
  amenagements: 'Aménagements',
  logiciels: 'Logiciels',
};

function formatCategorie(id: string): string {
  return CATEGORIE_LABELS[id] ?? id;
}
