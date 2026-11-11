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

import {
  Field,
  FormSection,
  PhoneInput,
  Select,
  SubmitButton,
  Switch,
  TextInput,
} from '@lalanda/ui';
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

        <FormSection title="Identité">
          <Field id="fp-legalName" label="Dénomination" required size="lg" error={champs.legalName}>
            <TextInput
              value={form.legalName}
              onChange={(e) => maj('legalName', e.target.value)}
              maxLength={200}
              required
            />
          </Field>
          <Field
            id="fp-tradeName"
            label="Enseigne"
            optional
            size="lg"
            newRow
            hint="Le nom commercial, s’il diffère de la dénomination."
            error={champs.tradeName}
          >
            <TextInput
              value={form.tradeName}
              onChange={(e) => maj('tradeName', e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field
            id="fp-legalForm"
            label="Forme juridique"
            optional
            size="md"
            newRow
            error={champs.legalForm}
          >
            {/* Liste servie par l'API — l'interface ne la code pas en dur. */}
            <Select<FiscalLegalForm | ''>
              value={form.legalForm}
              onChange={(v) => maj('legalForm', v)}
              options={[
                { value: '', label: 'Non précisée' },
                ...formes.map((f) => ({ value: f.value, label: f.label })),
              ]}
            />
          </Field>
          {form.legalForm === 'autre' ? (
            <Field
              id="fp-legalFormOther"
              label="Précisez la forme juridique"
              required
              size="md"
              error={champs.legalFormOther}
            >
              <TextInput
                value={form.legalFormOther}
                onChange={(e) => maj('legalFormOther', e.target.value)}
                maxLength={100}
                required
              />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Identifiants">
          <Field
            id="fp-nif"
            label="NIF"
            required
            size="sm"
            hint={
              nifVerrouille
                ? 'Verrouillé tant que la facture normalisée est activée. Désactivez-la pour le modifier.'
                : 'Numéro d’identification fiscale. Les espaces et tirets sont retirés à l’enregistrement.'
            }
            error={champs.nif}
          >
            <TextInput
              value={form.nif}
              onChange={(e) => maj('nif', e.target.value)}
              readOnly={nifVerrouille}
              aria-readonly={nifVerrouille}
              maxLength={40}
              required
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase"
            />
          </Field>
          <Field id="fp-rccm" label="RCCM" optional size="md" error={champs.rccm}>
            <TextInput
              value={form.rccm}
              onChange={(e) => maj('rccm', e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field
            id="fp-nationalId"
            label="Identification nationale"
            optional
            size="md"
            error={champs.nationalId}
          >
            <TextInput
              value={form.nationalId}
              onChange={(e) => maj('nationalId', e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field
            id="fp-vat"
            label="Assujettie à la TVA"
            size="full"
            newRow
            error={champs.vatRegistered}
          >
            <Switch
              checked={form.vatRegistered}
              onChange={(v) => maj('vatRegistered', v)}
              label="Oui, l’organisation est assujettie à la TVA"
            />
          </Field>
        </FormSection>

        <FormSection
          title="Siège"
          description="L’adresse du siège. Celle de chaque lieu de vente est celle que la DGI associe à son e-MCF."
        >
          <Field id="fp-line1" label="Adresse" required size="full" error={champs.line1}>
            <TextInput
              value={form.line1}
              onChange={(e) => maj('line1', e.target.value)}
              maxLength={200}
              required
              autoComplete="address-line1"
            />
          </Field>
          <Field id="fp-line2" label="Complément" optional size="full" error={champs.line2}>
            <TextInput
              value={form.line2}
              onChange={(e) => maj('line2', e.target.value)}
              maxLength={200}
              autoComplete="address-line2"
            />
          </Field>
          <Field id="fp-commune" label="Commune" optional size="md" error={champs.commune}>
            <TextInput
              value={form.commune}
              onChange={(e) => maj('commune', e.target.value)}
              maxLength={100}
            />
          </Field>
          <Field id="fp-city" label="Ville" required size="md" error={champs.city}>
            <TextInput
              value={form.city}
              onChange={(e) => maj('city', e.target.value)}
              maxLength={100}
              required
              autoComplete="address-level2"
            />
          </Field>
          <Field id="fp-province" label="Province" optional size="md" error={champs.province}>
            <TextInput
              value={form.province}
              onChange={(e) => maj('province', e.target.value)}
              maxLength={100}
            />
          </Field>
          <Field
            id="fp-country"
            label="Pays"
            required
            size="xs"
            hint="Code ISO à deux lettres (CD pour la RDC). La facture normalisée exige un siège en RDC."
            error={champs.country}
          >
            <TextInput
              value={form.country}
              onChange={(e) => maj('country', e.target.value.toUpperCase())}
              maxLength={2}
              required
              className="uppercase"
            />
          </Field>
        </FormSection>

        <FormSection title="Contact">
          <Field id="fp-phone" label="Téléphone" required size="md" error={champs.phone}>
            <PhoneInput
              value={form.phone}
              onChange={(v) => maj('phone', v)}
              maxLength={20}
              required
            />
          </Field>
          <Field id="fp-email" label="Adresse e-mail" required size="md" error={champs.email}>
            <TextInput
              type="email"
              value={form.email}
              onChange={(e) => maj('email', e.target.value)}
              maxLength={254}
              required
              autoComplete="email"
            />
          </Field>
        </FormSection>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SubmitButton
            variant="secondary"
            showShortcut={false}
            busy={occupe}
            busyLabel="Enregistrement…"
            className="max-sm:h-11 max-sm:w-full"
          >
            Enregistrer la fiche
          </SubmitButton>
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
