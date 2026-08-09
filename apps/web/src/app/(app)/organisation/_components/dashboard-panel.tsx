'use client';

// Tableau de bord de l'organisation (S21a) — UNE page, des blocs conditionnés.
//
// ── Le principe qui structure ce fichier ─────────────────────────────────────
//
// Il n'y a pas quatre pages par rôle : il y a une page et un endpoint qui ne
// renvoie que ce que le rôle a le droit de voir. Un bloc vaut `null` quand le
// serveur ne l'a pas chargé — l'interface ne le calcule pas, elle le constate.
//
// Un bloc absent n'est PAS une erreur (docs/12, pattern retenu sur /members en
// S20a) : il est listé sobrement en bas de page, avec la raison renvoyée par le
// serveur. Un Lecteur doit trouver ici un espace utile, jamais un mur de rouge.
//
// Accessibilité (docs/04) : chaque statut est porté par du TEXTE. Les pastilles
// et les points colorés ne sont qu'un renfort — « au rouge » est écrit, pas
// seulement peint.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, type OrganizationDashboardView } from '@/lib/api';

import {
  accroche,
  estRefus,
  formatDate,
  formatEcartPct,
  formatNombre,
  libelleLimite,
  libelleMois,
  libellePlan,
  libelleRaisonAttente,
  libelleSeuil,
  limiteAtteinte,
  masqueOrdonne,
  messageErreur,
  resumeConsommation,
} from './organization-model';

export function DashboardPanel(): React.ReactElement {
  const [vue, setVue] = useState<OrganizationDashboardView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [sansOrganisation, setSansOrganisation] = useState(false);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      setVue(await api.getOrganizationDashboard());
      setSansOrganisation(false);
    } catch (err) {
      // Un refus ici ne peut venir que de l'absence d'organisation active : la
      // route est gardée par `analytics.read`, que les huit rôles détiennent.
      if (estRefus(err)) {
        setSansOrganisation(true);
        setVue(null);
      } else {
        setErreur(messageErreur(err, 'Impossible de charger le tableau de bord.'));
      }
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }

  if (sansOrganisation) {
    return (
      <EtatVide titre="Aucune organisation active">
        Créez une organisation ou acceptez une invitation pour ouvrir cet espace.{' '}
        <Link href="/projects" className="underline hover:text-[var(--accent)]">
          Retour aux projets
        </Link>
      </EtatVide>
    );
  }

  if (erreur || !vue) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div
          role="alert"
          className="w-full rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur ?? 'Tableau de bord indisponible.'}
        </div>
        <button
          type="button"
          onClick={() => void charger()}
          className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const { organization, sections, masque } = vue;
  const phrase = accroche({
    lectureSeule: vue.lectureSeule,
    gouvernance: sections.gouvernance !== null,
    validation: sections.validation !== null,
    comptabilite: sections.comptabilite !== null,
  });

  return (
    <div className="flex flex-col gap-8">
      {/* ── Identité de l'organisation ─────────────────────────────────── */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {organization.logoUrl ? (
            // Logo par URL seulement (aucun stockage de fichiers branché) :
            // `<img>` brut et non `next/image`, qui exigerait de déclarer chaque
            // domaine distant dans la configuration.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={organization.logoUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-md border border-[var(--border)] object-contain"
            />
          ) : null}
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {organization.name}
            </h2>
            <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">{phrase}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <Pastille ton="accent">{vue.roleLabel}</Pastille>
          <span className="fig text-xs text-[var(--foreground-muted)]">
            {organization.pays} · {organization.deviseAffichage}
            {vue.lectureSeule ? ' · consultation seule' : ''}
          </span>
        </div>
      </section>

      {/* ── Pilotage — `organization.manage` ────────────────────────────── */}
      {sections.gouvernance ? (
        <Bloc titre="Pilotage de l’organisation">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tuile libelle="Projets" valeur={formatNombre(sections.gouvernance.projets)} />
            <Tuile
              libelle="Plans validés ce mois"
              valeur={formatNombre(sections.gouvernance.plansValidesCeMois)}
            />
            <Tuile
              libelle="Membres actifs"
              valeur={formatNombre(sections.gouvernance.membresActifs)}
            />
            <Tuile
              libelle={`Offre ${libellePlan(sections.gouvernance.consommation.plan)}`}
              valeur={libelleLimite(
                sections.gouvernance.consommation.projets.utilise,
                sections.gouvernance.consommation.projets.limite,
              )}
              detail={resumeConsommation(sections.gouvernance.consommation)}
              alerte={limiteAtteinte(
                sections.gouvernance.consommation.projets.utilise,
                sections.gouvernance.consommation.projets.limite,
              )}
            />
          </div>
        </Bloc>
      ) : null}

      {/* ── Validation financière — `plan.approve` ──────────────────────── */}
      {sections.validation ? (
        <Bloc titre="Validation financière">
          <div className="grid gap-4 lg:grid-cols-3">
            <Colonne
              titre="Ratios au rouge"
              vide="Aucun ratio au rouge dans les plans validés."
              nombre={sections.validation.ratiosRouges.length}
            >
              {sections.validation.ratiosRouges.map((r) => (
                <Ligne
                  key={`${r.projectId}-${r.lineId}`}
                  href={`/projects/${r.projectId}`}
                  titre={r.label}
                  // Le point rouge ne porte AUCUNE information seul : le seuil
                  // attendu est écrit juste en dessous (docs/04 § Accessibilité).
                  puce="ko"
                  detail={`${r.projectName} · v${r.planVersion} · ${formatNombre(r.valeur)} — ${libelleSeuil(r)}`}
                />
              ))}
            </Colonne>

            <Colonne
              titre="Plans en attente"
              vide="Tous les projets ont un plan validé à jour."
              nombre={sections.validation.plansEnAttente.length}
            >
              {sections.validation.plansEnAttente.map((p) => (
                <Ligne
                  key={p.projectId}
                  href={`/projects/${p.projectId}`}
                  titre={p.projectName}
                  puce="warn"
                  detail={`${libelleRaisonAttente(p)} ${
                    p.derniereVersion === null ? '' : `Dernière version : v${p.derniereVersion}.`
                  } Modifié le ${formatDate(p.modifieLe)}.`}
                />
              ))}
            </Colonne>

            <Colonne
              titre="Écarts du réalisé"
              vide="Aucun écart défavorable sur les périodes saisies."
              nombre={sections.validation.ecartsDefavorables.length}
            >
              {sections.validation.ecartsDefavorables.map((e) => (
                <Ligne
                  key={e.projectId}
                  href={`/projects/${e.projectId}/realise`}
                  titre={e.projectName}
                  puce="warn"
                  detail={
                    e.pireEcart
                      ? `${e.lignesDefavorables} ligne(s) défavorable(s) · pire : ${e.pireEcart.label} ${formatEcartPct(e.pireEcart.ecartPct)}`
                      : `${e.lignesDefavorables} ligne(s) défavorable(s) · écart non chiffrable`
                  }
                />
              ))}
            </Colonne>
          </div>
        </Bloc>
      ) : null}

      {/* ── Saisie du réalisé — `actuals.import` ────────────────────────── */}
      {sections.comptabilite ? (
        <Bloc titre="Saisie du réalisé">
          {!sections.comptabilite.peutCloturer ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Le droit de clôture ne vous a pas été accordé : vous pouvez saisir les périodes, un
              Propriétaire ou un Administrateur décide de la clôture.
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <Colonne
              titre="Périodes à saisir"
              vide="Rien à saisir : les exercices suivis sont à jour."
              nombre={sections.comptabilite.periodesASaisir.length}
            >
              {sections.comptabilite.periodesASaisir.map((p) => (
                <Ligne
                  key={`${p.projectId}-${p.year}-${p.month}`}
                  href={`/projects/${p.projectId}/realise`}
                  titre={p.projectName}
                  detail={libelleMois(p.year, p.month)}
                />
              ))}
            </Colonne>

            <Colonne
              titre={
                sections.comptabilite.peutCloturer ? 'Périodes à clôturer' : 'Périodes saisies'
              }
              vide="Aucune période saisie en attente."
              nombre={sections.comptabilite.periodesACloturer.length}
            >
              {sections.comptabilite.periodesACloturer.map((p) => (
                <Ligne
                  key={`${p.projectId}-${p.year}-${p.month}`}
                  href={`/projects/${p.projectId}/realise`}
                  titre={p.projectName}
                  detail={libelleMois(p.year, p.month)}
                />
              ))}
            </Colonne>

            <Colonne
              titre="Anomalies signalées"
              vide="Aucune incohérence détectée sur les soldes saisis."
              nombre={sections.comptabilite.anomalies.length}
            >
              {sections.comptabilite.anomalies.map((a) => (
                <Ligne
                  key={`${a.projectId}-${a.lineId}`}
                  href={`/projects/${a.projectId}/realise`}
                  titre={`${a.projectName} · ${a.label}`}
                  puce="warn"
                  // Le message vient du calcul d'écarts, qui SIGNALE sans jamais
                  // corriger d'office (docs/08).
                  detail={`${a.message} Mois : ${a.months.join(', ')}.`}
                />
              ))}
            </Colonne>
          </div>
        </Bloc>
      ) : null}

      {/* ── Projets — `project.read`, donc tout le monde ────────────────── */}
      {sections.projets ? (
        <Bloc titre="Projets">
          {sections.projets.projets.length === 0 ? (
            <EtatVide titre="Aucun projet pour l’instant">
              Les projets de l’organisation apparaîtront ici dès leur création.
            </EtatVide>
          ) : (
            <ul className="flex flex-col gap-2">
              {sections.projets.projets.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
                >
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-medium hover:text-[var(--accent)]"
                  >
                    {p.name}
                  </Link>
                  <span className="fig text-xs text-[var(--foreground-muted)]">
                    {p.dernierPlan
                      ? `v${p.dernierPlan.version} validée le ${formatDate(p.dernierPlan.approvedAt)}`
                      : 'Aucun plan validé'}
                    {p.dernierPlan?.soleApprover ? ' · validé sans second approbateur' : ''}
                    {` · ${p.deviseAffichage}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {sections.projets.dernieresValidations.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
                Dernières validations
              </h4>
              <ul className="flex flex-col gap-1 text-sm">
                {sections.projets.dernieresValidations.map((v) => (
                  <li key={`${v.projectId}-${v.version}`} className="ledger-row">
                    <span>
                      {v.projectName} · v{v.version}
                    </span>
                    <span className="leader" aria-hidden="true" />
                    <span className="fig text-xs text-[var(--foreground-muted)]">
                      {formatDate(v.approvedAt)}
                      {/* Information de bancabilité, pas un détail technique
                          (ADR-0012 §6 R2) : un plan auto-approuvé le dit. */}
                      {v.soleApprover ? ' · sans séparation des tâches' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Bloc>
      ) : null}

      {/* ── Ce que le rôle ne permet pas ────────────────────────────────── */}
      {masque.length > 0 ? (
        <section
          aria-labelledby="masque-titre"
          className="flex flex-col gap-2 rounded-xl border border-dashed border-[var(--border)] p-4"
        >
          <h3
            id="masque-titre"
            className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-muted)]"
          >
            Non accessible avec le rôle {vue.roleLabel}
          </h3>
          <ul className="flex flex-col gap-2 text-sm">
            {masqueOrdonne(masque).map((bloc) => (
              <li key={bloc.section} className="flex flex-col">
                <span className="font-medium">{bloc.titre}</span>
                <span className="text-[var(--foreground-muted)]">{bloc.raison}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Briques de rendu
// ─────────────────────────────────────────────────────────────────────────────

function Bloc({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  const id = `bloc-${titre.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="font-display text-lg font-semibold tracking-tight">
        {titre}
      </h3>
      {children}
    </section>
  );
}

/** Tuile de chiffre. `.fig` = chiffres tabulaires, alignés d'une ligne à l'autre. */
function Tuile({
  libelle,
  valeur,
  detail,
  alerte = false,
}: {
  libelle: string;
  valeur: string;
  detail?: string;
  alerte?: boolean;
}): React.ReactElement {
  return (
    <div className="doc-card flex flex-col gap-1 px-4 py-3">
      <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.1em] opacity-70">
        {libelle}
      </span>
      <span className="fig text-2xl font-semibold">{valeur}</span>
      {detail ? <span className="fig text-xs opacity-70">{detail}</span> : null}
      {/* Le dépassement est ÉCRIT, jamais seulement coloré. */}
      {alerte ? (
        <span className="text-xs font-medium text-[var(--ko)]">Limite du plan atteinte</span>
      ) : null}
    </div>
  );
}

function Colonne({
  titre,
  vide,
  nombre,
  children,
}: {
  titre: string;
  vide: string;
  nombre: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <h4 className="flex items-baseline justify-between gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
        <span>{titre}</span>
        <span className="fig">{nombre}</span>
      </h4>
      {nombre === 0 ? (
        <p className="text-xs italic text-[var(--foreground-muted)]">{vide}</p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </div>
  );
}

function Ligne({
  href,
  titre,
  detail,
  puce,
}: {
  href: string;
  titre: string;
  detail: string;
  puce?: 'ko' | 'warn';
}): React.ReactElement {
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <span className="flex items-center gap-2">
        {puce ? <span className={`dot dot-${puce}`} aria-hidden="true" /> : null}
        <Link href={href} className="font-medium hover:text-[var(--accent)]">
          {titre}
        </Link>
      </span>
      <span className="fig text-xs text-[var(--foreground-muted)]">{detail}</span>
    </li>
  );
}

function EtatVide({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
      <p className="text-sm font-medium">{titre}</p>
      <p className="mt-1 text-sm text-[var(--foreground-muted)]">{children}</p>
    </div>
  );
}

function Pastille({
  ton,
  children,
}: {
  ton: 'accent' | 'neutre';
  children: React.ReactNode;
}): React.ReactElement {
  const styles =
    ton === 'accent'
      ? 'border-[var(--accent)] text-[var(--accent)]'
      : 'border-[var(--border-strong)] text-[var(--foreground-muted)]';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] ${styles}`}
    >
      {children}
    </span>
  );
}
