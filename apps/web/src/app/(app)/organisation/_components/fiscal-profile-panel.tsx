'use client';

// Fiche fiscale de l'organisation (S25b — ADR-0021 §2) — `fiscal.manage`.
//
// Les mentions vendeur qu'une facture normalisée doit porter : dénomination,
// NIF, adresse du siège, téléphone, adresse e-mail. Écriture COMPLÈTE seulement
// (`PUT`) : une fiche enregistrée est toujours complète.
//
// Le contrôle du NIF est volontairement souple : son format exact n'est pas
// publié dans une source citable. La seule vérification qui fait foi est la
// concordance avec le NIF que la DGI renvoie au test d'un jeton. L'interface
// ne prétend donc pas valider un NIF.

import { useCallback, useEffect, useState } from 'react';

import { api, type FiscalLegalForm, type FiscalProfileView } from '@/lib/api';

import {
  corpsDepuisFormulaire,
  erreursFormulaire,
  type FormulaireFiscal,
  formulaireDepuisProfil,
  messageFiscal,
} from './fiscal-model';
import { codeErreur, estRefus, formatDateHeure } from './organization-model';

export function FiscalProfilePanel({
  version = 0,
  onEnregistre,
  onRefus,
}: {
  /** Prévenu après un enregistrement : les prérequis de la facture normalisée ont pu changer. */
  onEnregistre?: () => void;
  /** Prévenu sur un 403/404 : l'appelant masque le reste de l'onglet. */
  onRefus?: () => void;
  /** Change quand la facture normalisée change d'état : la fiche se relit (verrou du NIF). */
  version?: number;
}): React.ReactElement {
  const [vue, setVue] = useState<FiscalProfileView | null>(null);
  const [form, setForm] = useState<FormulaireFiscal>(() => formulaireDepuisProfil(null));
  const [chargement, setChargement] = useState(true);
  const [refuse, setRefuse] = useState(false);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [autres, setAutres] = useState<string[]>([]);
  const [champs, setChamps] = useState<Partial<Record<keyof FormulaireFiscal, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const appliquer = useCallback((v: FiscalProfileView): void => {
    setVue(v);
    setForm(formulaireDepuisProfil(v.profile));
  }, []);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreurChargement(null);
    try {
      appliquer(await api.getFiscalProfile());
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) {
        setRefuse(true);
        onRefus?.();
      } else {
        setErreurChargement(messageFiscal(err, 'Impossible de charger la fiche fiscale.'));
      }
    } finally {
      setChargement(false);
    }
  }, [appliquer, onRefus]);

  useEffect(() => {
    void charger();
  }, [charger, version]);

  function maj<K extends keyof FormulaireFiscal>(cle: K, valeur: FormulaireFiscal[K]): void {
    setForm((f) => ({ ...f, [cle]: valeur }));
    // L'erreur d'un champ disparaît dès qu'on le corrige.
    setChamps((c) => (c[cle] ? { ...c, [cle]: undefined } : c));
  }

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setOccupe(true);
    setErreur(null);
    setAutres([]);
    setChamps({});
    setNotice(null);
    try {
      appliquer(await api.putFiscalProfile(corpsDepuisFormulaire(form)));
      setNotice('Fiche fiscale enregistrée.');
      onEnregistre?.();
    } catch (err) {
      const parChamp = erreursFormulaire(err);
      setChamps(parChamp.champs);
      setAutres(parChamp.autres);
      setErreur(messageFiscal(err, 'Enregistrement impossible.'));
      if (codeErreur(err) === 'FISCAL_IDENTITY_LOCKED') void charger();
    } finally {
      setOccupe(false);
    }
  }

  if (chargement && vue === null) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement de la fiche fiscale…
      </p>
    );
  }

  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Section réservée à l’autorité financière</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          L’identité fiscale et la facture normalisée engagent l’organisation devant la DGI : elles
          sont gérées par un Propriétaire ou un Directeur financier. Votre rôle vous donne accès au
          tableau de bord et à vos initiatives.
        </p>
      </div>
    );
  }

  if (erreurChargement && vue === null) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]"
      >
        <p>{erreurChargement}</p>
        <button
          type="button"
          onClick={() => void charger()}
          className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm text-[var(--foreground)]"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const nifVerrouille = vue?.locks.nif === true;
  const formes = vue?.options.legalForms ?? [];

  return (
    <section aria-labelledby="fiche-titre" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="fiche-titre" className="font-display text-lg font-bold tracking-tight">
          Fiche fiscale
        </h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Les informations qui figureront sur vos factures normalisées. Le NIF sert aussi à vérifier
          chaque jeton e-MCF : la DGI doit renvoyer le même.
        </p>
        {vue && vue.profile === null ? (
          <p className="text-sm">
            Aucune fiche enregistrée pour l’instant. Elle est nécessaire avant d’ajouter un point de
            vente.
          </p>
        ) : null}
      </header>

      <form
        onSubmit={(e) => void enregistrer(e)}
        noValidate
        className="flex max-w-3xl flex-col gap-5"
      >
        {erreur ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
          >
            <p>{erreur}</p>
            {autres.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {autres.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Identité</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ id="fp-legalName" label="Dénomination" requis erreur={champs.legalName}>
              <input
                id="fp-legalName"
                value={form.legalName}
                onChange={(e) => maj('legalName', e.target.value)}
                maxLength={200}
                required
                className={CHAMP}
                {...aria('fp-legalName', champs.legalName)}
              />
            </Champ>
            <Champ
              id="fp-tradeName"
              label="Enseigne"
              aide="Facultatif. Le nom commercial, s’il diffère de la dénomination."
              erreur={champs.tradeName}
            >
              <input
                id="fp-tradeName"
                value={form.tradeName}
                onChange={(e) => maj('tradeName', e.target.value)}
                maxLength={200}
                className={CHAMP}
                {...aria('fp-tradeName', champs.tradeName, true)}
              />
            </Champ>
            <Champ
              id="fp-legalForm"
              label="Forme juridique"
              aide="Facultatif."
              erreur={champs.legalForm}
            >
              <select
                id="fp-legalForm"
                value={form.legalForm}
                onChange={(e) => maj('legalForm', e.target.value as FiscalLegalForm | '')}
                className={CHAMP}
                {...aria('fp-legalForm', champs.legalForm, true)}
              >
                <option value="">Non précisée</option>
                {/* Liste servie par l'API — l'interface ne la code pas en dur. */}
                {formes.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Champ>
            {form.legalForm === 'autre' ? (
              <Champ
                id="fp-legalFormOther"
                label="Précisez la forme juridique"
                requis
                erreur={champs.legalFormOther}
              >
                <input
                  id="fp-legalFormOther"
                  value={form.legalFormOther}
                  onChange={(e) => maj('legalFormOther', e.target.value)}
                  maxLength={100}
                  required
                  className={CHAMP}
                  {...aria('fp-legalFormOther', champs.legalFormOther)}
                />
              </Champ>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Identifiants</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              id="fp-nif"
              label="NIF"
              requis
              aide={
                nifVerrouille
                  ? 'Verrouillé tant que la facture normalisée est activée. Désactivez-la pour le modifier.'
                  : 'Numéro d’identification fiscale. Les espaces et tirets sont retirés à l’enregistrement.'
              }
              erreur={champs.nif}
            >
              <input
                id="fp-nif"
                value={form.nif}
                onChange={(e) => maj('nif', e.target.value)}
                readOnly={nifVerrouille}
                aria-readonly={nifVerrouille}
                maxLength={40}
                required
                autoComplete="off"
                spellCheck={false}
                className={`${CHAMP} font-mono uppercase ${nifVerrouille ? 'opacity-70' : ''}`}
                {...aria('fp-nif', champs.nif, true)}
              />
            </Champ>
            <Champ id="fp-rccm" label="RCCM" aide="Facultatif." erreur={champs.rccm}>
              <input
                id="fp-rccm"
                value={form.rccm}
                onChange={(e) => maj('rccm', e.target.value)}
                maxLength={64}
                className={CHAMP}
                {...aria('fp-rccm', champs.rccm, true)}
              />
            </Champ>
            <Champ
              id="fp-nationalId"
              label="Identification nationale"
              aide="Facultatif."
              erreur={champs.nationalId}
            >
              <input
                id="fp-nationalId"
                value={form.nationalId}
                onChange={(e) => maj('nationalId', e.target.value)}
                maxLength={64}
                className={CHAMP}
                {...aria('fp-nationalId', champs.nationalId, true)}
              />
            </Champ>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Assujettie à la TVA</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.vatRegistered}
                  onChange={(e) => maj('vatRegistered', e.target.checked)}
                  className="h-4 w-4"
                />
                Oui, l’organisation est assujettie à la TVA
              </label>
              {champs.vatRegistered ? (
                <p className="text-xs text-[var(--danger)]">{champs.vatRegistered}</p>
              ) : null}
            </div>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Siège</legend>
          <p className="-mt-2 text-xs text-[var(--foreground-muted)]">
            L’adresse du siège. Celle de chaque lieu de vente est celle que la DGI associe à son
            e-MCF.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ id="fp-line1" label="Adresse" requis erreur={champs.line1}>
              <input
                id="fp-line1"
                value={form.line1}
                onChange={(e) => maj('line1', e.target.value)}
                maxLength={200}
                required
                autoComplete="address-line1"
                className={CHAMP}
                {...aria('fp-line1', champs.line1)}
              />
            </Champ>
            <Champ id="fp-line2" label="Complément" aide="Facultatif." erreur={champs.line2}>
              <input
                id="fp-line2"
                value={form.line2}
                onChange={(e) => maj('line2', e.target.value)}
                maxLength={200}
                autoComplete="address-line2"
                className={CHAMP}
                {...aria('fp-line2', champs.line2, true)}
              />
            </Champ>
            <Champ id="fp-commune" label="Commune" aide="Facultatif." erreur={champs.commune}>
              <input
                id="fp-commune"
                value={form.commune}
                onChange={(e) => maj('commune', e.target.value)}
                maxLength={100}
                className={CHAMP}
                {...aria('fp-commune', champs.commune, true)}
              />
            </Champ>
            <Champ id="fp-city" label="Ville" requis erreur={champs.city}>
              <input
                id="fp-city"
                value={form.city}
                onChange={(e) => maj('city', e.target.value)}
                maxLength={100}
                required
                autoComplete="address-level2"
                className={CHAMP}
                {...aria('fp-city', champs.city)}
              />
            </Champ>
            <Champ id="fp-province" label="Province" aide="Facultatif." erreur={champs.province}>
              <input
                id="fp-province"
                value={form.province}
                onChange={(e) => maj('province', e.target.value)}
                maxLength={100}
                className={CHAMP}
                {...aria('fp-province', champs.province, true)}
              />
            </Champ>
            <Champ
              id="fp-country"
              label="Pays"
              requis
              aide="Code ISO à deux lettres (CD pour la RDC). La facture normalisée exige un siège en RDC."
              erreur={champs.country}
            >
              <input
                id="fp-country"
                value={form.country}
                onChange={(e) => maj('country', e.target.value.toUpperCase())}
                maxLength={2}
                required
                className={`${CHAMP} uppercase`}
                {...aria('fp-country', champs.country, true)}
              />
            </Champ>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Contact</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ id="fp-phone" label="Téléphone" requis erreur={champs.phone}>
              <input
                id="fp-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => maj('phone', e.target.value)}
                maxLength={20}
                required
                autoComplete="tel"
                placeholder="+243 …"
                className={CHAMP}
                {...aria('fp-phone', champs.phone)}
              />
            </Champ>
            <Champ id="fp-email" label="Adresse e-mail" requis erreur={champs.email}>
              <input
                id="fp-email"
                type="email"
                value={form.email}
                onChange={(e) => maj('email', e.target.value)}
                maxLength={254}
                required
                autoComplete="email"
                className={CHAMP}
                {...aria('fp-email', champs.email)}
              />
            </Champ>
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="submit"
            disabled={occupe}
            className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
          >
            {occupe ? 'Enregistrement…' : 'Enregistrer la fiche'}
          </button>
          <span className="fig text-xs text-[var(--foreground-muted)]">
            {vue?.profile?.updatedAt
              ? `Dernière modification : ${formatDateHeure(vue.profile.updatedAt)}`
              : 'Jamais enregistrée'}
          </span>
          <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
            {notice ?? ''}
          </span>
        </div>
      </form>
    </section>
  );
}

const CHAMP =
  'w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)] disabled:opacity-50';

/** `aria-invalid` et `aria-describedby` reliant l'aide et l'erreur du champ. */
function aria(
  id: string,
  erreur: string | undefined,
  avecAide = false,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const ids = [avecAide ? `${id}-aide` : null, erreur ? `${id}-erreur` : null].filter(Boolean);
  return {
    ...(erreur ? { 'aria-invalid': true as const } : {}),
    ...(ids.length > 0 ? { 'aria-describedby': ids.join(' ') } : {}),
  };
}

function Champ({
  id,
  label,
  aide,
  requis = false,
  erreur,
  children,
}: {
  id: string;
  label: string;
  aide?: string;
  requis?: boolean;
  erreur?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {requis ? (
          <span className="text-[var(--foreground-muted)]" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {requis ? <span className="sr-only"> (obligatoire)</span> : null}
      </label>
      {children}
      {aide ? (
        <p id={`${id}-aide`} className="text-xs text-[var(--foreground-muted)]">
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p id={`${id}-erreur`} className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
