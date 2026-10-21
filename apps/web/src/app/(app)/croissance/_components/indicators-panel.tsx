'use client';

// Indicateurs investisseurs (ADR-0032 § 3) : chaque valeur porte sa source, sa
// période, sa méthode et ses hypothèses ; chaque indisponibilité dit pourquoi.
// En bas, les DÉCLARATIONS de l'utilisateur (hypothèses) dont certains
// indicateurs dépendent : projet de référence, solde de trésorerie, articles
// récurrents.

import { useCallback, useEffect, useState } from 'react';

import { api, type CatalogItemView } from '@/lib/api';
import {
  growApi,
  type GrowIndicator,
  type GrowIndicatorsView,
  type GrowProfileResponse,
} from '@/lib/grow-api';

import { useAccesCroissance } from './grow-chrome';
import {
  formatMontant,
  formatRatio,
  GROUPES_INDICATEURS,
  lireMontant,
  messageErreur,
  refusForfait,
  valeurIndicateur,
} from './grow-model';
import { Bloc, Chargement, Erreur, Hypotheses, Pastille, RefusForfait, Sources } from './grow-ui';

export function IndicatorsPanel(): React.ReactElement {
  const [vue, setVue] = useState<GrowIndicatorsView | null>(null);
  const [profil, setProfil] = useState<GrowProfileResponse | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      setProfil(await growApi.getProfile());
      setVue(await growApi.getIndicators());
      setRefus(null);
    } catch (err) {
      const r = refusForfait(err);
      if (r) setRefus(r);
      else setErreur(messageErreur(err, 'Impossible de charger les indicateurs.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement) return <Chargement />;
  if (refus) return <RefusForfait message={refus} />;
  if (erreur || !vue || !profil) {
    return (
      <Erreur message={erreur ?? 'Indicateurs indisponibles.'} onRetry={() => void charger()} />
    );
  }

  const f = vue.faits;
  const exclus = f.documentsExclus;
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-1 text-sm text-[var(--foreground-muted)]">
        <p>
          Calculés le {vue.asOf} depuis vos données réelles :{' '}
          {f.projet
            ? `réalisé clôturé du projet « ${f.projet.nom} » (${f.moisClotures} mois clôturés)`
            : 'aucun projet de référence'}
          {' · '}
          {f.devise
            ? `${f.documentsRetenus} document${f.documentsRetenus > 1 ? 's' : ''} de vente en ${f.devise}`
            : 'ventes non lues'}
          .
        </p>
        {exclus.acomptes + exclus.serieEssai + exclus.autreDevise > 0 ? (
          <p>
            Non pris en compte : {exclus.acomptes} acompte(s), {exclus.serieEssai} facture(s) de la
            série d’essai DGI, {exclus.autreDevise} document(s) dans une autre devise (aucun taux de
            change n’est appliqué).
          </p>
        ) : null}
        <p className="font-mono text-[0.65rem] opacity-70">Moteur GROW {vue.growVersion}</p>
      </section>

      {GROUPES_INDICATEURS.map((g) => (
        <Bloc key={g.titre} titre={g.titre}>
          <div className="grid gap-3 md:grid-cols-2">
            {g.codes.map((code) => (
              <Carte key={code} ind={vue.indicateurs[code]} />
            ))}
          </div>
        </Bloc>
      ))}

      <Declarations profil={profil} onSaved={() => void charger()} />
    </div>
  );
}

function Carte({ ind }: { ind: GrowIndicator }): React.ReactElement {
  return (
    <article className="doc-card flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{ind.libelle}</h3>
        {ind.disponible ? null : <Pastille ton="neutre">Indisponible</Pastille>}
      </div>
      {ind.disponible ? (
        <>
          <span className="fig text-2xl font-semibold">{valeurIndicateur(ind)}</span>
          <p className="text-xs text-[var(--foreground-muted)]">{ind.periode.libelle}</p>
          <p className="text-xs">{ind.methode}</p>
          {ind.premiersClients ? (
            <table className="w-full text-xs">
              <caption className="sr-only">Premiers clients</caption>
              <tbody>
                {ind.premiersClients.map((c) => (
                  <tr key={c.cle} className="border-t border-[var(--border)]">
                    <td className="py-1">{c.nom ?? `Client ${c.rang}`}</td>
                    <td className="fig py-1 text-right">{formatMontant(c.montant, null)}</td>
                    <td className="fig py-1 text-right">{formatRatio(c.part)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {ind.partTroisPremiers !== undefined ? (
            <p className="text-xs">Trois premiers clients : {formatRatio(ind.partTroisPremiers)}</p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">{ind.message}</p>
      )}
      <Sources sources={ind.sources} />
      <Hypotheses items={ind.hypotheses} />
    </article>
  );
}

// ─── Déclarations (hypothèses de l'utilisateur) ─────────────────────────────

function Declarations({
  profil,
  onSaved,
}: {
  profil: GrowProfileResponse;
  onSaved: () => void;
}): React.ReactElement {
  const acces = useAccesCroissance();
  const [projet, setProjet] = useState(profil.referenceProjectId ?? '');
  const [recurrents, setRecurrents] = useState<string[]>(profil.recurringCatalogItemIds);
  const [catalogue, setCatalogue] = useState<CatalogItemView[] | null>(null);
  const [montant, setMontant] = useState(profil.declaredCash?.amount.replace('.', ',') ?? '');
  const [devise, setDevise] = useState(
    profil.declaredCash?.currency ??
      profil.projects.find((p) => p.id === profil.referenceProjectId)?.currency ??
      profil.projects[0]?.currency ??
      'USD',
  );
  const [date, setDate] = useState(profil.declaredCash?.asOf ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    // Le catalogue exige `sales.read` : sans ce droit, la liste reste fermée.
    void api
      .listCatalogItems({ status: 'active', limit: 100 })
      .then((p) => setCatalogue(p.items))
      .catch(() => setCatalogue(null));
  }, []);

  async function enregistrerFiche(): Promise<void> {
    setEnvoi(true);
    setMessage(null);
    try {
      await growApi.putProfile({
        referenceProjectId: projet === '' ? null : projet,
        declaredStage: profil.declaredStage,
        recurringCatalogItemIds: recurrents,
      });
      onSaved();
    } catch (err) {
      setMessage(messageErreur(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function enregistrerSolde(): Promise<void> {
    const lu = lireMontant(montant);
    if (!lu.ok) {
      setMessage(lu.message);
      return;
    }
    setEnvoi(true);
    setMessage(null);
    try {
      await growApi.putDeclaredCash({ amount: lu.valeur, currency: devise, asOf: date });
      onSaved();
    } catch (err) {
      setMessage(messageErreur(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  const champ =
    'rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-60';
  const bouton =
    'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-60';

  return (
    <Bloc titre="Vos déclarations">
      <p className="text-sm text-[var(--foreground-muted)]">
        Ces informations sont des <strong>hypothèses</strong> que vous déclarez : elles ne modifient
        ni votre plan, ni votre réalisé, ni vos factures, et chaque indicateur qui en dépend le
        signale.
      </p>
      {message ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="doc-card flex flex-col gap-3 px-4 py-3">
          <h3 className="font-medium">Projet de référence et revenus récurrents</h3>
          <label className="flex flex-col gap-1 text-sm">
            Projet dont le réalisé représente l’entreprise
            <select
              className={champ}
              value={projet}
              disabled={!acces.declarer || envoi}
              onChange={(e) => setProjet(e.target.value)}
            >
              <option value="">
                {profil.projects.length === 1 ? 'Le seul projet (par défaut)' : 'Non choisi'}
              </option>
              {profil.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.currency})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1">
              Articles du catalogue facturés comme revenus récurrents
            </legend>
            {catalogue === null ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                Catalogue non consultable avec votre rôle.
              </p>
            ) : catalogue.length === 0 ? (
              <p className="text-xs text-[var(--foreground-muted)]">Aucun article actif.</p>
            ) : (
              catalogue.map((item) => (
                <label key={item.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!acces.declarer || envoi}
                    checked={recurrents.includes(item.id)}
                    onChange={(e) =>
                      setRecurrents((cur) =>
                        e.target.checked ? [...cur, item.id] : cur.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.name}
                </label>
              ))
            )}
          </fieldset>
          {acces.declarer ? (
            <button
              type="button"
              className={bouton}
              disabled={envoi}
              onClick={() => void enregistrerFiche()}
            >
              Enregistrer
            </button>
          ) : (
            <p className="text-xs text-[var(--foreground-muted)]">
              Votre rôle permet de consulter ces déclarations, pas de les modifier.
            </p>
          )}
        </div>

        <div className="doc-card flex flex-col gap-3 px-4 py-3">
          <h3 className="font-medium">Solde de trésorerie déclaré</h3>
          {profil.declaredCash ? (
            <p className="text-sm">
              Déclaré : {profil.declaredCash.amount} {profil.declaredCash.currency} au{' '}
              {profil.declaredCash.asOf}.
            </p>
          ) : (
            <p className="text-sm text-[var(--foreground-muted)]">Aucun solde déclaré.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Montant
              <input
                className={champ}
                inputMode="decimal"
                value={montant}
                disabled={!acces.declarerTresorerie || envoi}
                onChange={(e) => setMontant(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Devise
              <input
                className={`${champ} w-20 uppercase`}
                maxLength={3}
                value={devise}
                disabled={!acces.declarerTresorerie || envoi}
                onChange={(e) => setDevise(e.target.value.toUpperCase())}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Date du solde
              <input
                type="date"
                className={champ}
                value={date}
                disabled={!acces.declarerTresorerie || envoi}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          {acces.declarerTresorerie ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={bouton}
                disabled={envoi}
                onClick={() => void enregistrerSolde()}
              >
                Déclarer ce solde
              </button>
              {profil.declaredCash ? (
                <button
                  type="button"
                  className={bouton}
                  disabled={envoi}
                  onClick={() =>
                    void growApi
                      .deleteDeclaredCash()
                      .then(onSaved)
                      .catch((err: unknown) =>
                        setMessage(messageErreur(err, 'Suppression impossible.')),
                      )
                  }
                >
                  Retirer
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-[var(--foreground-muted)]">
              Déclarer un solde est réservé aux rôles qui saisissent le réalisé.
            </p>
          )}
        </div>
      </div>
    </Bloc>
  );
}
