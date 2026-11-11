'use client';

// Niveaux par emplacement — ADR-0046 § 2.5, § 5.1 : le stock en temps réel,
// filtrable par emplacement et « sous le seuil ». Quantités servies par l'API.

import { Badge, Field, Switch } from '@lalanda/ui';
import { Layers } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { stockApi, type StockLevelRowView, type StockReorderAlertView } from '@/lib/api-stock';

import { alerteDe, etatNiveau, requeteNiveaux } from './niveaux-model';
import { useAccesStocks } from './stocks-access';
import { formatQuantite, lienArticle } from './stocks-model';
import { Bandeau, CarteVide, Chargement, ChoixEmplacement, EchecLecture } from './stocks-ui';

export function Niveaux(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { etat } = useAccesStocks();
  const emplacement = params.get('emplacement') ?? '';
  const sousSeuil = params.get('seuil') === '1';
  const [rows, setRows] = useState<StockLevelRowView[] | null>(null);
  const [alertes, setAlertes] = useState<StockReorderAlertView[]>([]);
  const [erreur, setErreur] = useState<unknown>(null);

  const charger = useCallback((loc: string, seuil: boolean) => {
    stockApi
      .listLevels(requeteNiveaux(loc, seuil))
      .then((p) => {
        setRows(p.levels);
        setAlertes(p.belowReorder);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setRows([]);
        setErreur(err);
      });
  }, []);

  useEffect(() => {
    if (etat === 'pret') charger(emplacement, sousSeuil);
  }, [etat, emplacement, sousSeuil, charger]);

  const filtrer = (loc: string, seuil: boolean): void => {
    const q = new URLSearchParams();
    if (loc) q.set('emplacement', loc);
    if (seuil) q.set('seuil', '1');
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Layers}
        titre="Niveaux par emplacement"
        sousTitre="Le stock en temps réel, article par article et emplacement par emplacement."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6">
          <Field id="niveaux-emplacement" label="Emplacement" size="full" className="sm:w-80">
            <ChoixEmplacement
              valeur={emplacement}
              vide="Tous les emplacements"
              onChange={(v) => filtrer(v, sousSeuil)}
            />
          </Field>
          <Switch
            className="sm:pb-2"
            checked={sousSeuil}
            onChange={(v) => filtrer(emplacement, v)}
            label="Sous le seuil seulement"
          />
        </div>
      </Bandeau>

      {erreur ? <EchecLecture erreur={erreur} repli="Impossible de lire les niveaux." /> : null}

      {rows === null ? (
        <Chargement texte="Chargement des niveaux…" />
      ) : rows.length === 0 ? (
        erreur ? null : (
          <CarteVide>
            {sousSeuil ? 'Aucun article sous son seuil ici.' : 'Aucun stock enregistré ici.'}
          </CarteVide>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          {rows.map((r) => {
            const alerte = alerteDe(r, alertes);
            const e = etatNiveau(r, alerte);
            return (
              <li
                key={`${r.itemId}-${r.locationId}`}
                className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-[var(--surface-muted)]"
              >
                <Link
                  href={lienArticle(r.itemId)}
                  className="min-w-0 flex-1 font-medium break-words after:absolute after:inset-0"
                >
                  {r.itemCode ? `${r.itemCode} — ` : ''}
                  {r.itemName}
                </Link>
                {!emplacement ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {r.locationName ?? 'Emplacement'}
                  </span>
                ) : null}
                {alerte !== null ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    seuil {formatQuantite(alerte.minQuantity)}
                  </span>
                ) : null}
                <span
                  className={`tabular-nums whitespace-nowrap font-semibold ${e.ton === 'danger' ? 'text-[var(--danger)]' : ''}`}
                >
                  {formatQuantite(r.quantity, r.unit)}
                </span>
                {e.libelle ? <Badge tone={e.ton}>{e.libelle}</Badge> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
