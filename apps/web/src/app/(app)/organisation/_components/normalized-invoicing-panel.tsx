'use client';

// Facture normalisée DGI et points de vente e-MCF (S25b — ADR-0021 §3, §4).
//
// Ce que l'interface promet, et rien de plus :
// - l'activation n'est proposée que si le SERVEUR dit `canActivate` ; les
//   prérequis manquants sont listés en mots ;
// - une fois activée, aucune facture non normalisée ne peut être émise. La
//   désactivation reste possible : motif obligatoire, tracée, et les
//   propriétaires sont prévenus par e-mail. Rien ne la déclenche en silence ;
// - « Mode test » est écrit partout où l'environnement est le test. La
//   production n'est proposée que si la plateforme l'a ouverte ;
// - pour une erreur venant de la DGI, son code et son libellé sont montrés
//   tels quels.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  type EdefEnvironment,
  type EdefReferenceDataView,
  type NormalizedInvoicingView,
  type PointOfSaleView,
} from '@/lib/api';

import { FiscalProfilePanel } from './fiscal-profile-panel';
import {
  type ActionReprise,
  MOTIF_MAX,
  PHRASE_PRODUCTION_FERMEE,
  type TonEtat,
  alerteValidite,
  avecReauth,
  bandeauDesactivation,
  changementExigeMotif,
  erreurMotif,
  explicationEtat,
  jetonMasque,
  libelleEnvironnement,
  libelleEtat,
  libellePrerequis,
  libelleReprise,
  lireReprise,
  messageFiscal,
  pointsOrdonnes,
  prerequisManquants,
  prerequisManquantsDeErreur,
  tonEtat,
} from './fiscal-model';
import { estRefus, formatDate, formatDateHeure } from './organization-model';
import {
  ErreurFiscale,
  PointOfSaleCreateForm,
  PointOfSaleEditForm,
  PointOfSaleTokenForm,
} from './point-of-sale-form';
import { CLE_REPRISE, PARAM_RETOUR_GOOGLE, useReauthDialog } from './reauth-dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Composition de l'onglet
// ─────────────────────────────────────────────────────────────────────────────

/** L'onglet entier : fiche fiscale, puis facture normalisée. */
export function FiscaliteEspace(): React.ReactElement {
  const [version, setVersion] = useState(0);
  const [refuse, setRefuse] = useState(false);
  const surRefus = useCallback(() => setRefuse(true), []);
  const surEnregistre = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <div className="flex flex-col gap-10">
      <FiscalProfilePanel onEnregistre={surEnregistre} onRefus={surRefus} />
      {refuse ? null : <NormalizedInvoicingPanel version={version} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Éléments d'affichage
// ─────────────────────────────────────────────────────────────────────────────

const TONS: Record<TonEtat, string> = {
  neutre: 'border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-muted)]',
  attention: 'border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]',
  succes: 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]',
  echec: 'border-[var(--danger)]/30 bg-[var(--danger-bg)] text-[var(--danger)]',
};

/** Pastille : le texte porte l'information, la couleur la renforce (docs/04). */
function Pastille({ ton, children }: { ton: TonEtat; children: React.ReactNode }) {
  return (
    <span
      className={`font-mono inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.06em] ${TONS[ton]}`}
    >
      {children}
    </span>
  );
}

function PastilleEnvironnement({ env }: { env: EdefEnvironment }) {
  return env === 'test' ? (
    <Pastille ton="attention">Mode test</Pastille>
  ) : (
    <Pastille ton="succes">Production</Pastille>
  );
}

function Bandeau({ ton, children }: { ton: TonEtat; children: React.ReactNode }) {
  return (
    <div
      role={ton === 'echec' ? 'alert' : 'status'}
      className={`rounded-md border p-3 text-sm ${TONS[ton]}`}
    >
      {children}
    </div>
  );
}

const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';
const BOUTON_DANGER =
  'rounded-md border border-[var(--danger)]/60 px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-50';
const ZONE =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]';

/** Motif de 20 à 500 caractères, avec compteur annoncé. */
function ChampMotif({
  id,
  valeur,
  onChange,
  libelle,
  facultatif = false,
}: {
  id: string;
  valeur: string;
  onChange: (v: string) => void;
  libelle: string;
  facultatif?: boolean;
}) {
  const erreur = facultatif && valeur.trim() === '' ? null : erreurMotif(valeur);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {libelle}
      </label>
      <textarea
        id={id}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={MOTIF_MAX}
        aria-describedby={`${id}-aide`}
        className={ZONE}
      />
      <p id={`${id}-aide`} className="text-xs text-[var(--foreground-muted)]">
        {facultatif ? 'Facultatif. ' : ''}De 20 à 500 caractères — {valeur.trim().length} saisi
        {valeur.trim().length > 1 ? 's' : ''}.{valeur.trim() !== '' && erreur ? ` ${erreur}` : ''}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panneau
// ─────────────────────────────────────────────────────────────────────────────

type Formulaire =
  | { type: 'aucun' }
  | { type: 'activer' }
  | { type: 'desactiver' }
  | { type: 'environnement'; cible: EdefEnvironment }
  | { type: 'ajout' };

export function NormalizedInvoicingPanel({ version = 0 }: { version?: number }) {
  const [vue, setVue] = useState<NormalizedInvoicingView | null>(null);
  const [chargement, setChargement] = useState(true);
  const [refuse, setRefuse] = useState(false);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<unknown>(null);
  const [manquantsServeur, setManquantsServeur] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState<Formulaire>({ type: 'aucun' });
  const [motif, setMotif] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [reprise, setReprise] = useState<ActionReprise | null>(null);
  const [erreurRetourGoogle, setErreurRetourGoogle] = useState<string | null>(null);
  const reauth = useReauthDialog();

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreurChargement(null);
    try {
      setVue(await api.getNormalizedInvoicing());
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) setRefuse(true);
      else setErreurChargement(messageFiscal(err, 'Impossible de charger la facture normalisée.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger, version]);

  // ── Retour de la connexion Google (ré-authentification) ──
  const retourTraite = useRef(false);
  useEffect(() => {
    if (retourTraite.current) return;
    retourTraite.current = true;
    const params = new URLSearchParams(window.location.search);
    const retour = params.get(PARAM_RETOUR_GOOGLE);
    if (!retour) return;
    // L'URL est nettoyée tout de suite : un rechargement ne doit rien rejouer.
    params.delete(PARAM_RETOUR_GOOGLE);
    const reste = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${reste ? `?${reste}` : ''}`);
    let brut: string | null = null;
    try {
      brut = window.sessionStorage.getItem(CLE_REPRISE);
      window.sessionStorage.removeItem(CLE_REPRISE);
    } catch {
      brut = null;
    }
    if (retour !== 'google') {
      setErreurRetourGoogle(
        'La connexion Google n’a pas abouti. Aucune modification n’a été faite.',
      );
      return;
    }
    void api
      .confirmMeReauth()
      .then(() => setReprise(lireReprise(brut)))
      .catch((err: unknown) =>
        setErreurRetourGoogle(
          messageFiscal(err, 'La confirmation d’identité par Google a échoué.'),
        ),
      );
  }, []);

  /**
   * Exécute une écriture : ré-authentification et nouvelle tentative unique en
   * cas de `401 REAUTH_REQUIRED`, puis rechargement de la vue.
   */
  async function executer(
    operation: () => Promise<unknown>,
    succes: string,
    repriseSiGoogle: ActionReprise | null = null,
  ): Promise<boolean> {
    setOccupe(true);
    setErreurAction(null);
    setManquantsServeur(null);
    setNotice(null);
    try {
      await avecReauth(operation, (mode) => reauth.demander(mode, repriseSiGoogle));
      setNotice(succes);
      setFormulaire({ type: 'aucun' });
      setMotif('');
      await charger();
      return true;
    } catch (err) {
      setErreurAction(err);
      setManquantsServeur(prerequisManquantsDeErreur(err));
      return false;
    } finally {
      setOccupe(false);
    }
  }

  function activer(environment: EdefEnvironment): Promise<boolean> {
    return executer(
      () => api.activateNormalizedInvoicing(environment),
      'Facture normalisée activée.',
      { type: 'activate', environment },
    );
  }

  function desactiver(reason: string): Promise<boolean> {
    return executer(
      () => api.deactivateNormalizedInvoicing(reason),
      'Facture normalisée désactivée. Les propriétaires de l’organisation en sont prévenus par e-mail.',
      { type: 'deactivate', reason },
    );
  }

  function changerEnvironnement(cible: EdefEnvironment, reason: string | null): Promise<boolean> {
    return executer(
      () => api.changeNormalizedInvoicingEnvironment(cible, reason ?? undefined),
      `Environnement : ${libelleEnvironnement(cible)}.`,
      { type: 'environment', environment: cible, reason },
    );
  }

  function retirer(
    p: Pick<PointOfSaleView, 'id' | 'label'>,
    reason: string | null,
  ): Promise<boolean> {
    return executer(
      () => api.disablePointOfSale(p.id, reason ?? undefined),
      `Point de vente « ${p.label} » retiré. Son jeton a été détruit.`,
      { type: 'disable_pos', posId: p.id, label: p.label, reason },
    );
  }

  async function reprendre(action: ActionReprise): Promise<void> {
    setReprise(null);
    switch (action.type) {
      case 'activate':
        await activer(action.environment);
        return;
      case 'deactivate':
        await desactiver(action.reason);
        return;
      case 'environment':
        await changerEnvironnement(action.environment, action.reason);
        return;
      case 'disable_pos':
        await retirer({ id: action.posId, label: action.label }, action.reason);
        return;
    }
  }

  if (chargement && vue === null) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement de la facture normalisée…
      </p>
    );
  }
  if (refuse) return <></>;
  if (erreurChargement && vue === null) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]"
      >
        <p>{erreurChargement}</p>
        <button type="button" onClick={() => void charger()} className={BOUTON}>
          Réessayer
        </button>
      </div>
    );
  }
  if (!vue) return <></>;

  const activee = vue.state === 'enabled';
  const manquants =
    manquantsServeur && manquantsServeur.length > 0 ? manquantsServeur : prerequisManquants(vue);
  const bandeau = bandeauDesactivation(vue);
  const autreEnvironnement: EdefEnvironment = vue.environment === 'test' ? 'production' : 'test';
  const productionFermee = !vue.prerequisites.productionAvailable;

  return (
    <section aria-labelledby="fn-titre" className="flex flex-col gap-5">
      {reauth.element}

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="fn-titre" className="font-display text-lg font-bold tracking-tight">
            Facture normalisée DGI
          </h2>
          <Pastille ton={activee ? 'succes' : 'neutre'}>
            {activee ? 'Activée' : 'Désactivée'}
          </Pastille>
          <PastilleEnvironnement env={vue.environment} />
        </div>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Utiliser ou non la facture normalisée est le choix de votre organisation. Si vous
          l’activez, chaque facture sera certifiée par la DGI au moyen du jeton e-MCF de l’un de vos
          points de vente.
        </p>
      </header>

      {erreurRetourGoogle ? <Bandeau ton="echec">{erreurRetourGoogle}</Bandeau> : null}

      {reprise ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-md border border-[var(--accent)]/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            Identité confirmée. Action interrompue : <strong>{libelleReprise(reprise)}</strong>.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setReprise(null)} className={BOUTON}>
              Abandonner
            </button>
            <button
              type="button"
              disabled={occupe}
              onClick={() => void reprendre(reprise)}
              className={BOUTON}
            >
              Reprendre
            </button>
          </div>
        </div>
      ) : null}

      {bandeau ? <Bandeau ton="attention">{bandeau}</Bandeau> : null}

      <span aria-live="polite" className="text-sm text-[var(--ok)]">
        {notice ?? ''}
      </span>
      {erreurAction ? <ErreurFiscale erreur={erreurAction} /> : null}

      {/* ── État et bascule ── */}
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        {activee ? (
          <>
            <p className="text-sm">
              Activée {vue.activatedAt ? `depuis le ${formatDate(vue.activatedAt)} ` : ''}
              en <strong>{libelleEnvironnement(vue.environment)}</strong>. Tant qu’elle est active,{' '}
              <strong>aucune facture non normalisée ne peut être émise</strong>.
            </p>
            {formulaire.type === 'desactiver' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void desactiver(motif.trim());
                }}
                className="flex flex-col gap-3 rounded-md border border-[var(--danger)]/30 p-3"
              >
                <p className="text-sm">
                  Désactiver la facture normalisée : vos factures suivantes n’auront plus de valeur
                  fiscale auprès de la DGI. La désactivation est <strong>tracée</strong> dans le
                  journal de l’organisation, reste affichée sur cette page, et{' '}
                  <strong>les propriétaires sont prévenus par e-mail</strong>.
                </p>
                <ChampMotif
                  id="fn-motif"
                  libelle="Motif de la désactivation"
                  valeur={motif}
                  onChange={setMotif}
                />
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setFormulaire({ type: 'aucun' })}
                    className={BOUTON}
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={occupe || erreurMotif(motif) !== null}
                    className={BOUTON_DANGER}
                  >
                    {occupe ? 'Désactivation…' : 'Confirmer la désactivation'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setMotif('');
                    setFormulaire({ type: 'desactiver' });
                  }}
                  className={BOUTON_DANGER}
                >
                  Désactiver la facture normalisée…
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {manquants.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Avant de pouvoir l’activer :</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {manquants.map((m) => (
                    <li key={m}>{libellePrerequis(m)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm">Toutes les conditions sont réunies pour l’activer.</p>
            )}
            {formulaire.type === 'activer' ? (
              <div className="flex flex-col gap-3 rounded-md border border-[var(--warn)]/40 p-3">
                <p className="text-sm">
                  Une fois activée, <strong>aucune facture non normalisée</strong> ne pourra plus
                  être émise par votre organisation. Vous pourrez la désactiver, mais ce sera tracé
                  et les propriétaires en seront prévenus.
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setFormulaire({ type: 'aucun' })}
                    className={BOUTON}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={occupe || !vue.canActivate}
                    onClick={() => void activer(vue.environment)}
                    className={BOUTON}
                  >
                    {occupe ? 'Activation…' : 'Confirmer l’activation'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div>
                  <button
                    type="button"
                    disabled={!vue.canActivate}
                    aria-describedby={vue.canActivate ? undefined : 'fn-activer-aide'}
                    onClick={() => setFormulaire({ type: 'activer' })}
                    className={BOUTON}
                  >
                    Activer la facture normalisée ({libelleEnvironnement(vue.environment)})
                  </button>
                </div>
                {vue.canActivate ? null : (
                  <p id="fn-activer-aide" className="text-xs text-[var(--foreground-muted)]">
                    Le bouton s’ouvrira quand les conditions ci-dessus seront remplies.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Environnement ── */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Environnement DGI</h3>
        <p className="text-sm">
          Environnement actuel : <PastilleEnvironnement env={vue.environment} />
        </p>
        {autreEnvironnement === 'production' && productionFermee ? (
          <p className="text-sm text-[var(--foreground-muted)]">{PHRASE_PRODUCTION_FERMEE}</p>
        ) : formulaire.type === 'environnement' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void changerEnvironnement(
                formulaire.cible,
                motif.trim() === '' ? null : motif.trim(),
              );
            }}
            className="flex flex-col gap-3"
          >
            {changementExigeMotif(vue, formulaire.cible) ? (
              <>
                <p className="text-sm">
                  Revenir en mode test pendant l’activation équivaut à une désactivation : les
                  factures suivantes n’auraient plus de valeur fiscale. C’est tracé et les
                  propriétaires sont prévenus.
                </p>
                <ChampMotif id="fn-env-motif" libelle="Motif" valeur={motif} onChange={setMotif} />
              </>
            ) : (
              <p className="text-sm">
                Passer en {libelleEnvironnement(formulaire.cible)} : il faut au moins un point de
                vente actif dans cet environnement.
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setFormulaire({ type: 'aucun' })}
                className={BOUTON}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={
                  occupe ||
                  (changementExigeMotif(vue, formulaire.cible) && erreurMotif(motif) !== null)
                }
                className={BOUTON}
              >
                {occupe ? 'Changement…' : `Confirmer : ${libelleEnvironnement(formulaire.cible)}`}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => {
                setMotif('');
                setFormulaire({ type: 'environnement', cible: autreEnvironnement });
              }}
              className={BOUTON}
            >
              Passer en {libelleEnvironnement(autreEnvironnement)}…
            </button>
          </div>
        )}
      </div>

      {/* ── Points de vente ── */}
      <section aria-labelledby="pdv-titre" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="pdv-titre" className="text-base font-semibold">
            Points de vente e-MCF
          </h3>
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
            Un jeton par point de vente : la DGI attribue un jeton à chaque e-MCF, pas à
            l’entreprise.
          </p>
        </div>

        {vue.pointsOfSale.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucun point de vente pour l’instant. Ajoutez-en un avec le jeton e-MCF que la DGI vous a
            remis.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pointsOrdonnes(vue.pointsOfSale).map((p) => (
              <li key={p.id}>
                <CartePointDeVente
                  point={p}
                  occupe={occupe}
                  onRetirer={(reason) => retirer(p, reason)}
                  onRemplacer={async (token) => {
                    // Pas de reprise après Google : une action qui porte un
                    // jeton ne se range jamais dans le navigateur.
                    await avecReauth(
                      () => api.replacePointOfSaleToken(p.id, token),
                      (mode) => reauth.demander(mode, null),
                    );
                    setNotice(
                      p.enabled
                        ? `Jeton de « ${p.label} » remplacé : la DGI l’a accepté.`
                        : `Point de vente « ${p.label} » réactivé : la DGI a accepté le jeton.`,
                    );
                    await charger();
                  }}
                  onModifier={async (valeurs) => {
                    await api.updatePointOfSale(p.id, valeurs);
                    setNotice(`Point de vente « ${valeurs.label} » modifié.`);
                    await charger();
                  }}
                  onTester={async () => {
                    await api.testPointOfSale(p.id);
                    await charger();
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {formulaire.type === 'ajout' ? (
          <PointOfSaleCreateForm
            environnementParDefaut={vue.environment}
            productionDisponible={vue.prerequisites.productionAvailable}
            onAnnuler={() => setFormulaire({ type: 'aucun' })}
            onEnvoyer={async (valeurs) => {
              setErreurAction(null);
              await avecReauth(
                () => api.createPointOfSale(valeurs),
                (mode) => reauth.demander(mode, null),
              );
              setFormulaire({ type: 'aucun' });
              setNotice(`Point de vente « ${valeurs.label} » ajouté : la DGI a accepté le jeton.`);
              await charger();
            }}
          />
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setFormulaire({ type: 'ajout' })}
              className={BOUTON}
            >
              Ajouter un point de vente
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Carte d'un point de vente
// ─────────────────────────────────────────────────────────────────────────────

type Volet = 'aucun' | 'jeton' | 'modifier' | 'retirer' | 'listes';

function CartePointDeVente({
  point,
  occupe,
  onRetirer,
  onRemplacer,
  onModifier,
  onTester,
}: {
  point: PointOfSaleView;
  occupe: boolean;
  onRetirer: (reason: string | null) => Promise<boolean>;
  onRemplacer: (token: string) => Promise<void>;
  onModifier: (valeurs: { label: string; expectedNim: string | null }) => Promise<void>;
  onTester: () => Promise<void>;
}) {
  const [volet, setVolet] = useState<Volet>('aucun');
  const [motif, setMotif] = useState('');
  const [test, setTest] = useState<'aucun' | 'encours'>('aucun');
  const [erreurTest, setErreurTest] = useState<unknown>(null);
  const alerte = alerteValidite(point.dgi?.tokenValidUntil ?? null);
  const titreId = `pdv-${point.id}-titre`;

  async function tester(): Promise<void> {
    setTest('encours');
    setErreurTest(null);
    try {
      await onTester();
    } catch (err) {
      setErreurTest(err);
    } finally {
      setTest('aucun');
    }
  }

  return (
    <article
      aria-labelledby={titreId}
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={titreId} className="text-sm font-semibold">
          {point.label}
        </h4>
        <Pastille ton={tonEtat(point.status)}>{libelleEtat(point.status)}</Pastille>
        <PastilleEnvironnement env={point.environment} />
      </div>
      <p className="text-sm text-[var(--foreground-muted)]">{explicationEtat(point.status)}</p>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--foreground-muted)]">Jeton</dt>
          <dd className="font-mono">{jetonMasque(point.token)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--foreground-muted)]">Fin de validité du jeton</dt>
          <dd className="fig">{formatDate(point.dgi?.tokenValidUntil ?? null)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--foreground-muted)]">NIM (numéro de l’e-MCF)</dt>
          <dd className="font-mono">{point.dgi?.nim ?? '—'}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--foreground-muted)]">NIF renvoyé par la DGI</dt>
          <dd className="font-mono">{point.dgi?.nif ?? '—'}</dd>
        </div>
        {point.expectedNim ? (
          <div className="flex flex-col">
            <dt className="text-xs text-[var(--foreground-muted)]">NIM attendu</dt>
            <dd className="font-mono">{point.expectedNim}</dd>
          </div>
        ) : null}
        {point.dgi?.shopName || (point.dgi?.address.length ?? 0) > 0 ? (
          <div className="flex flex-col sm:col-span-2">
            <dt className="text-xs text-[var(--foreground-muted)]">Lieu de vente selon la DGI</dt>
            <dd>
              {[point.dgi?.shopName, ...(point.dgi?.address ?? [])].filter(Boolean).join(' · ')}
            </dd>
          </div>
        ) : null}
      </dl>

      {alerte ? (
        <Bandeau ton={alerte.niveau === 'expire' ? 'echec' : 'attention'}>{alerte.texte}</Bandeau>
      ) : null}

      {point.lastTest ? (
        <div
          className={`rounded-md border p-3 text-sm ${TONS[point.lastTest.ok ? 'succes' : 'echec']}`}
        >
          <p>
            Dernier test, le {formatDateHeure(point.lastTest.at)} :{' '}
            {point.lastTest.ok ? 'réussi' : 'en échec'}.
          </p>
          {/* Réponse DGI affichée telle quelle (exigence DGI). */}
          <p className="mt-1 font-mono text-xs">
            Réponse : {point.lastTest.code ? `code ${point.lastTest.code} · ` : ''}
            {point.lastTest.message}
          </p>
        </div>
      ) : (
        <p className="text-xs text-[var(--foreground-muted)]">Aucun test enregistré.</p>
      )}
      {erreurTest ? <ErreurFiscale erreur={erreurTest} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {point.enabled ? (
          <>
            <button
              type="button"
              disabled={test === 'encours' || !point.token.configured}
              onClick={() => void tester()}
              className={BOUTON}
            >
              {test === 'encours' ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            <button type="button" onClick={() => setVolet('jeton')} className={BOUTON}>
              Remplacer le jeton
            </button>
            <button type="button" onClick={() => setVolet('modifier')} className={BOUTON}>
              Modifier
            </button>
            {point.status === 'active' ? (
              <button type="button" onClick={() => setVolet('listes')} className={BOUTON}>
                Listes de référence DGI
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMotif('');
                setVolet('retirer');
              }}
              className={BOUTON_DANGER}
            >
              Retirer…
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setVolet('jeton')} className={BOUTON}>
            Réactiver avec un nouveau jeton
          </button>
        )}
      </div>

      {volet === 'jeton' ? (
        <PointOfSaleTokenForm
          point={point}
          onAnnuler={() => setVolet('aucun')}
          onEnvoyer={async (token) => {
            await onRemplacer(token);
            setVolet('aucun');
          }}
        />
      ) : null}
      {volet === 'modifier' ? (
        <PointOfSaleEditForm
          point={point}
          onAnnuler={() => setVolet('aucun')}
          onEnvoyer={async (valeurs) => {
            await onModifier(valeurs);
            setVolet('aucun');
          }}
        />
      ) : null}
      {volet === 'retirer' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onRetirer(motif.trim() === '' ? null : motif.trim()).then((ok) => {
              if (ok) setVolet('aucun');
            });
          }}
          className="flex flex-col gap-3 rounded-md border border-[var(--danger)]/30 p-3"
        >
          <p className="text-sm">
            Retirer ce point de vente <strong>détruit son jeton</strong>. Le point de vente reste
            dans l’historique ; pour le réactiver, il faudra un nouveau jeton. Le dernier point de
            vente actif ne peut pas être retiré tant que la facture normalisée est activée.
          </p>
          <ChampMotif
            id={`pdv-motif-${point.id}`}
            libelle="Motif"
            valeur={motif}
            onChange={setMotif}
            facultatif
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => setVolet('aucun')} className={BOUTON}>
              Annuler
            </button>
            <button
              type="submit"
              disabled={occupe || (motif.trim() !== '' && erreurMotif(motif) !== null)}
              className={BOUTON_DANGER}
            >
              {occupe ? 'Retrait…' : 'Confirmer le retrait'}
            </button>
          </div>
        </form>
      ) : null}
      {volet === 'listes' ? (
        <ListesReference posId={point.id} onFermer={() => setVolet('aucun')} />
      ) : null}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Listes de référence DGI (lecture seule)
// ─────────────────────────────────────────────────────────────────────────────

const NOMS_LISTES: Record<string, string> = {
  taxGroups: 'Groupes de taxation',
  invoiceTypes: 'Types de facture',
  paymentTypes: 'Modes de paiement',
  clientTypes: 'Types de client',
  referenceTypes: 'Types de référence',
  itemTypes: 'Types d’article',
  currencyRates: 'Taux de change',
};

function ListesReference({ posId, onFermer }: { posId: string; onFermer: () => void }) {
  const [donnees, setDonnees] = useState<EdefReferenceDataView | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);

  useEffect(() => {
    let annule = false;
    api
      .getPointOfSaleReferenceData(posId)
      .then((d) => {
        if (!annule) setDonnees(d);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(err);
      });
    return () => {
      annule = true;
    };
  }, [posId]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Listes de référence DGI</p>
        <button type="button" onClick={onFermer} className="text-xs underline">
          Fermer
        </button>
      </div>
      {erreur ? <ErreurFiscale erreur={erreur} /> : null}
      {!donnees && !erreur ? (
        <p className="text-[var(--foreground-muted)]" aria-live="polite">
          Lecture auprès de la DGI…
        </p>
      ) : null}
      {donnees ? (
        <>
          <p className="text-xs text-[var(--foreground-muted)]">
            Lues le {formatDateHeure(donnees.fetchedAt)} ·{' '}
            {donnees.environment === 'test' ? 'Mode test' : 'Production'}
          </p>
          {donnees.lists.taxGroups ? (
            <div className="overflow-x-auto">
              <table className="text-left text-sm">
                <caption className="sr-only">
                  Groupes de taxation et taux renvoyés par la DGI
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-6 font-medium">
                      Groupe
                    </th>
                    <th scope="col" className="font-medium">
                      Taux DGI
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(donnees.lists.taxGroups).map(([g, taux]) => (
                    <tr key={g}>
                      <td className="pr-6 font-mono uppercase">{g}</td>
                      <td className="fig">{String(taux).replace('.', ',')} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <ul className="flex flex-col gap-1">
            {Object.entries(NOMS_LISTES)
              .filter(([cle]) => cle !== 'taxGroups')
              .map(([cle, nom]) => {
                const liste = donnees.lists[cle as keyof EdefReferenceDataView['lists']];
                const echec = donnees.failures[cle as keyof EdefReferenceDataView['failures']];
                return (
                  <li key={cle}>
                    {nom} :{' '}
                    {echec
                      ? `non obtenue (${echec.message})`
                      : Array.isArray(liste)
                        ? `${liste.length} entrée${liste.length > 1 ? 's' : ''}`
                        : '—'}
                  </li>
                );
              })}
          </ul>
          {donnees.failures.taxGroups ? (
            <p>Groupes de taxation : non obtenus ({donnees.failures.taxGroups.message})</p>
          ) : null}
          {donnees.warnings.map((w) => (
            <Bandeau key={`${w.code}-${w.group}`} ton="attention">
              Le taux du groupe {w.group.toUpperCase()} renvoyé par la DGI ({w.dgi} %) diffère du
              paramètre du pack pays ({w.pack} %). Le taux de la DGI fait foi pour la facturation.
            </Bandeau>
          ))}
        </>
      ) : null}
    </div>
  );
}
