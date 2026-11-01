'use client';

// Projets d'états (ADR-0049 § 10, § 13) : bilan, compte de résultat, tableau des flux.
// Bandeau projet et réserves EN TÊTE, rubriques « à confirmer » marquées. Le tableau des
// flux reste « non disponible » tant que l'expert-comptable n'a pas précisé sa méthode.

import {
  ACCOUNTING_TO_CONFIRM_LABEL,
  type AccountingStatementKind,
} from '@lalanda/shared/accounting';
import { Badge } from '@lalanda/ui';
import { FileText, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { accountingApi } from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import { useAccesCompta } from './comptabilite-access';
import { formatJour, formatValeur } from './comptabilite-model';
import {
  AConfirmer,
  Bandeau,
  CarteVide,
  Chargement,
  EchecLecture,
  Panneau,
  Reserves,
  Terme,
} from './comptabilite-ui';
import { ONGLETS_ETATS, bandeauxEtat, etatNonDisponible, rubriquesAConfirmer } from './etats-model';
import { useLecture } from './use-lecture';

export function Etats(): React.ReactElement {
  const { mode } = useAccesCompta();
  const [kind, setKind] = useState<AccountingStatementKind>('income-statement');
  const [annee, setAnnee] = useState(() => new Date().getFullYear());
  const l = useLecture(
    () => accountingApi.getStatement(kind, annee),
    `${kind}-${annee}-${String(mode)}`,
  );
  const vue = l?.ok ? l.valeur : null;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={FileText}
        titre="États"
        sousTitre="Bilan, compte de résultat et tableau des flux, établis par Lalanda comme projets pour votre expert-comptable."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div role="tablist" aria-label="État" className="flex flex-wrap gap-2">
            {ONGLETS_ETATS.map((o) => (
              <button
                key={o.kind}
                type="button"
                role="tab"
                aria-selected={kind === o.kind}
                onClick={() => setKind(o.kind)}
                className={`rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium ${kind === o.kind ? 'border-[var(--module-run)] bg-[var(--surface)]' : 'border-[var(--border)]'}`}
              >
                {o.libelle}
              </button>
            ))}
          </div>
          <label htmlFor="compta-etat-annee" className="flex flex-col gap-1 text-sm font-medium">
            Exercice
            <input
              id="compta-etat-annee"
              type="number"
              min={2000}
              max={2999}
              className={`${CHAMP} w-28`}
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value) || annee)}
            />
          </label>
        </div>
      </Bandeau>

      {bandeauxEtat(vue).map((t) => (
        <div
          key={t}
          role="note"
          data-bandeau="etat"
          className="flex items-start gap-3 rounded-[var(--radius-md)] border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{t}</p>
        </div>
      ))}

      {l === null ? (
        <Chargement />
      ) : !l.ok ? (
        etatNonDisponible(l.erreur) ? (
          <CarteVide>
            Non disponible : la méthode de cet état est une question posée à votre expert-comptable.
            Lalanda préfère ne rien afficher plutôt que deviner.
          </CarteVide>
        ) : (
          <EchecLecture erreur={l.erreur} repli="Cet état est illisible." />
        )
      ) : (
        <>
          <Panneau
            titre={<Terme terme="reserve">Réserves</Terme>}
            icone={ShieldAlert}
            id="compta-etat-reserves"
          >
            <Reserves reserves={l.valeur.reserves} />
            {rubriquesAConfirmer(l.valeur) > 0 ? (
              <p className="text-sm">
                <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} /> {rubriquesAConfirmer(l.valeur)}{' '}
                rubrique(s) du modèle restent à confirmer.
              </p>
            ) : null}
          </Panneau>
          <Panneau
            titre={`${l.valeur.label} — du ${formatJour(l.valeur.from)} au ${formatJour(l.valeur.to)}`}
            icone={FileText}
            id="compta-etat"
          >
            {l.valeur.sections.length === 0 ? (
              <CarteVide>
                Le modèle de cet état n’est pas encore fourni par le plan comptable.
              </CarteVide>
            ) : (
              <div className="flex flex-col gap-4">
                {l.valeur.sections.map((s) => (
                  <div key={s.code} className="flex flex-col gap-1">
                    <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {s.label}
                      {s.toConfirm ? <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} /> : null}
                      <span className="ml-auto tabular-nums">
                        {formatValeur(s.total, l.valeur.bookCurrency)}
                      </span>
                    </h4>
                    <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                      {s.rubrics.map((r) => (
                        <li key={r.code} className="flex flex-wrap items-center gap-2 py-1.5 pl-3">
                          <span className="min-w-0 flex-1">{r.label}</span>
                          {r.toConfirm ? <Badge tone="warning">À confirmer</Badge> : null}
                          <span className="tabular-nums">
                            {formatValeur(r.amount, l.valeur.bookCurrency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {l.valeur.result !== null ? (
                  <p className="text-sm font-semibold">
                    Résultat (projet) : {formatValeur(l.valeur.result, l.valeur.bookCurrency)}
                  </p>
                ) : null}
              </div>
            )}
          </Panneau>
        </>
      )}
    </section>
  );
}
