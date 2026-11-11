'use client';

// Création d'un fournisseur (ADR-0044 § 2.1), dans le `Modal` de `@lalanda/ui`
// (docs/04 « Fenêtres modales »). Vérification de forme ici ; l'API tranche
// (NIF unique, homonymes signalés sans refus).
//
// ADR-0074 : composants de formulaire de `@lalanda/ui`, largeurs sémantiques,
// validation à la sortie du champ (mêmes règles que l'envoi, `preparerFournisseur`).
// Sert aussi de fenêtre de création rapide depuis un bon de commande ou une
// facture fournisseur (`ChoixFournisseur`) : `nomInitial` reprend le texte tapé
// et `onCree` rend la fiche créée, choisie d'office.

import {
  Button,
  ErrorSummary,
  Field,
  Form,
  FormGrid,
  FormSection,
  PhoneInput,
  SegmentedControl,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
  resumerErreurs,
  useBlurValidation,
} from '@lalanda/ui';
import Link from 'next/link';
import { useState } from 'react';

import { purchasesApi, type SupplierView } from '@/lib/api-purchases';

import { Alerte } from '../../ventes/_components/form-ui';

import { identifiantExistant, lienFournisseur, messageAchats } from './achats-model';
import {
  formulaireFournisseur,
  phrasesAvertissements,
  preparerFournisseur,
  type FormulaireFournisseur,
} from './fournisseurs-model';

/** Ordre et libellés du résumé d'erreurs (identifiants des contrôles). */
const RESUME: { cle: string; id: string; libelle: string }[] = [
  { cle: 'name', id: 'fo-nom', libelle: 'Nom' },
  { cle: 'nif', id: 'fo-nif', libelle: 'NIF' },
  { cle: 'phone', id: 'fo-tel', libelle: 'Téléphone' },
  { cle: 'email', id: 'fo-email', libelle: 'E-mail' },
  { cle: 'termsDays', id: 'fo-jours', libelle: 'Nombre de jours' },
  { cle: 'contactName', id: 'fo-contact', libelle: 'Nom du contact' },
  { cle: 'contactEmail', id: 'fo-contact-email', libelle: 'E-mail du contact' },
  { cle: 'contactPhone', id: 'fo-contact-tel', libelle: 'Téléphone du contact' },
];

export function NouveauFournisseur({
  onCree,
  onAnnuler,
  nomInitial = '',
  enModal = false,
}: {
  /** Fiche créée : son identifiant, et la fiche rendue par l'API. */
  onCree: (id: string, fournisseur: SupplierView) => void;
  /** Bouton « Annuler » (création rapide) ; absent sinon. */
  onAnnuler?: () => void;
  /** Texte tapé dans le sélecteur : nom proposé. */
  nomInitial?: string;
  /** Création rapide depuis un document : « Choisir ce fournisseur » au lieu d'« Ouvrir la fiche ». */
  enModal?: boolean;
}): React.ReactElement {
  const [f, setF] = useState<FormulaireFournisseur>(() => ({
    ...formulaireFournisseur(),
    name: nomInitial,
  }));
  const [erreur, setErreur] = useState<string | null>(null);
  const [existant, setExistant] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<{
    fiche: SupplierView;
    phrases: string[];
  } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Validation à la sortie du champ (ADR-0074 § 9) : mêmes règles que l'envoi.
  const { errors, touch, validateAll, submitCount } = useBlurValidation<string>(() => {
    const p = preparerFournisseur(f);
    return p.ok ? {} : p.champs;
  });
  // Les erreurs de champ sont celles de `preparerFournisseur` (l'API ne renvoie
  // qu'un message global) : montrées à la sortie du champ, ou toutes après un essai.
  const affiches: Record<string, string | undefined> = errors;

  function maj<K extends keyof FormulaireFournisseur>(k: K, v: FormulaireFournisseur[K]): void {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    setExistant(null);
    validateAll();
    const p = preparerFournisseur(f);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const r = await purchasesApi.createSupplier(p.corps);
      const phrases = phrasesAvertissements(r.warnings);
      if (phrases.length > 0) setAvertissements({ fiche: r.supplier, phrases });
      else onCree(r.supplier.id, r.supplier);
    } catch (err) {
      setErreur(messageAchats(err, 'Création impossible.'));
      setExistant(identifiantExistant(err));
    } finally {
      setEnvoi(false);
    }
  }

  if (avertissements) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-sm font-medium">
          Fournisseur créé.
        </p>
        {avertissements.phrases.map((ph) => (
          <Alerte key={ph}>
            <p>{ph}</p>
          </Alerte>
        ))}
        <button
          type="button"
          className={buttonClasses('primary', 'md', 'self-start max-sm:h-11')}
          onClick={() => onCree(avertissements.fiche.id, avertissements.fiche)}
        >
          {enModal ? 'Choisir ce fournisseur' : 'Ouvrir la fiche'}
        </button>
      </div>
    );
  }

  const texte = (
    id: string,
    cle: keyof FormulaireFournisseur,
    label: string,
    options: {
      requis?: boolean;
      type?: string;
      aide?: string;
      max?: number;
      taille?: 'xs' | 'sm' | 'md' | 'lg' | 'full';
      nouvelleLigne?: boolean;
      mono?: boolean;
    } = {},
  ): React.ReactElement => (
    <Field
      id={id}
      label={label}
      required={options.requis ?? false}
      hint={options.aide}
      error={affiches[cle]}
      size={options.taille ?? 'md'}
      newRow={options.nouvelleLigne ?? false}
    >
      <TextInput
        type={options.type ?? 'text'}
        {...(options.type === 'email' ? { inputMode: 'email' as const } : {})}
        value={f[cle]}
        maxLength={options.max ?? 255}
        onChange={(e) => maj(cle, e.target.value as never)}
        onBlur={() => touch(cle)}
        {...(options.mono ? { className: 'font-mono uppercase', spellCheck: false } : {})}
      />
    </Field>
  );

  const telephone = (
    id: string,
    cle: 'phone' | 'contactPhone',
    label: string,
  ): React.ReactElement => (
    <Field id={id} label={label} size="md" error={affiches[cle]}>
      <PhoneInput
        value={f[cle]}
        onChange={(v) => maj(cle, v)}
        onBlur={() => touch(cle)}
        maxLength={30}
      />
    </Field>
  );

  return (
    <Form onSubmit={(e) => void creer(e)} className="flex min-w-0 flex-col gap-5">
      <ErrorSummary errors={resumerErreurs(affiches, RESUME)} submitCount={submitCount} />
      <fieldset disabled={envoi} className="flex min-w-0 flex-col gap-5">
        <FormSection title="Identité">
          {texte('fo-nom', 'name', 'Nom', { requis: true, max: 200, taille: 'lg' })}
          <Field id="fo-nature" label="Nature" group size="md" newRow>
            <SegmentedControl<FormulaireFournisseur['kind']>
              value={f.kind}
              onChange={(v) => maj('kind', v)}
              options={[
                { value: 'company', label: 'Entreprise' },
                { value: 'individual', label: 'Particulier' },
              ]}
            />
          </Field>
          {texte('fo-nif', 'nif', 'NIF', {
            aide: 'Facultatif. Lettres et chiffres, sans contrôle auprès de la DGI.',
            max: 40,
            taille: 'sm',
            mono: true,
          })}
        </FormSection>

        <FormSection title="Coordonnées">
          {telephone('fo-tel', 'phone', 'Téléphone')}
          {texte('fo-email', 'email', 'E-mail', { type: 'email', max: 254 })}
          {texte('fo-adresse', 'address', 'Adresse', { taille: 'full' })}
        </FormSection>

        <FormSection title="Achat et paiement">
          <Field
            id="fo-devise"
            label="Devise habituelle"
            size="sm"
            hint="Proposée à la saisie, jamais imposée."
          >
            <Select<FormulaireFournisseur['defaultCurrency']>
              value={f.defaultCurrency}
              onChange={(v) => maj('defaultCurrency', v)}
              options={[
                { value: '', label: 'Aucune' },
                { value: 'USD', label: 'USD' },
                { value: 'CDF', label: 'CDF' },
              ]}
            />
          </Field>
          <Field id="fo-conditions" label="Conditions de paiement" size="md">
            <Select<FormulaireFournisseur['termsKind']>
              value={f.termsKind}
              onChange={(v) => maj('termsKind', v)}
              options={[
                { value: 'immediate', label: 'Paiement immédiat' },
                { value: 'net', label: 'À un nombre de jours (net)' },
                { value: 'end_of_month', label: 'Fin de mois, plus des jours' },
              ]}
            />
          </Field>
          {f.termsKind === 'immediate'
            ? null
            : texte('fo-jours', 'termsDays', 'Nombre de jours', {
                aide: 'L’échéance de chaque facture en est déduite par Lalanda.',
                max: 3,
                taille: 'xs',
              })}
        </FormSection>

        <FormSection
          title="Contact principal"
          description="Facultatif. Son adresse préremplit l’envoi des bons de commande."
        >
          {texte('fo-contact', 'contactName', 'Nom', { max: 120 })}
          {texte('fo-contact-email', 'contactEmail', 'E-mail', { type: 'email', max: 254 })}
          {telephone('fo-contact-tel', 'contactPhone', 'Téléphone')}
        </FormSection>
      </fieldset>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
          {existant ? (
            <p>
              <Link href={lienFournisseur(existant)} className="underline">
                Ouvrir la fiche existante
              </Link>
            </p>
          ) : null}
        </Alerte>
      ) : null}
      <FormGrid>
        <div className="col-span-full flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onAnnuler ? (
            <Button onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
              Annuler
            </Button>
          ) : null}
          <SubmitButton busy={envoi} busyLabel="Création…" className="max-sm:h-11">
            Créer le fournisseur
          </SubmitButton>
        </div>
      </FormGrid>
    </Form>
  );
}
