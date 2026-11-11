'use client';

// Fiche client : création, modification, consultation (ADR-0022 § S25c.2).
//
// Le formulaire suit le TYPE choisi : les champs exigés par la DGI changent
// d'un type à l'autre (`requiredFieldsFor`, sales-model.ts), la référence
// d'exonération n'existe que pour une ambassade ou une organisation
// internationale, et le nom devient « Dénomination » pour une personne morale.
//
// Modification : corps COMPLET avec la révision lue à l'ouverture. Si
// quelqu'un d'autre a écrit entre-temps (`409 STALE_REVISION`), on le dit et on
// propose de recharger — jamais d'écrasement silencieux.

import {
  Button,
  ChoiceCards,
  ErrorSummary,
  Field,
  Form,
  FormSection,
  PhoneInput,
  SubmitButton,
  TextArea,
  TextInput,
  resumerErreurs,
  useBlurValidation,
} from '@lalanda/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EntityDocumentsPanel } from '@/components/entity-documents-panel';
import { api, type CustomerView } from '@/lib/api';

import { Alerte, BOUTON, Pastille } from './form-ui';
import {
  type ChampClient,
  CUSTOMER_TYPES,
  erreursFormulaire,
  estRevisionPerimee,
  type FicheOuverte,
  ficheExistante,
  formatDate,
  type FormulaireClient,
  formulaireClient,
  libelleNom,
  libelleTypeClient,
  messageVentes,
  preparerClient,
  referenceExonerationAdmise,
  requiredFieldsFor,
} from './sales-model';

/** Ordre et libellés du résumé d'erreurs (ADR-0074 § 9). */
function RESUME_CHAMPS(
  type: FormulaireClient['type'],
): { cle: ChampClient; id: string; libelle: string }[] {
  return [
    { cle: 'type', id: 'cl-type', libelle: 'Type de client' },
    { cle: 'name', id: 'cl-name', libelle: type === '' ? 'Nom' : libelleNom(type) },
    { cle: 'nif', id: 'cl-nif', libelle: 'NIF' },
    {
      cle: 'exemptionReference',
      id: 'cl-exemption',
      libelle: 'Référence du document d’exonération',
    },
    { cle: 'phone', id: 'cl-phone', libelle: 'Téléphone' },
    { cle: 'email', id: 'cl-email', libelle: 'Adresse e-mail' },
    { cle: 'address', id: 'cl-address', libelle: 'Adresse' },
  ];
}

const CHAMPS: readonly ChampClient[] = [
  'type',
  'name',
  'nif',
  'exemptionReference',
  'phone',
  'email',
  'address',
];

export function CustomerForm({
  fiche,
  gerer,
  base,
  onFermer,
  enModal = false,
  nomInitial = '',
}: {
  fiche: Exclude<FicheOuverte, null>;
  /** `sales.manage` confirmé par le serveur. Sans lui, la fiche est en lecture seule. */
  gerer: boolean;
  /** Chemin de la liste, pour les liens vers une autre fiche. */
  base: string;
  /** Retour à la liste ; `enregistre` est la fiche écrite, s'il y en a une. */
  onFermer: (enregistre?: CustomerView) => void;
  /** Création dans la fenêtre modale : son en-tête porte le titre et la fermeture. */
  enModal?: boolean;
  /** Création rapide (ADR-0074 § 4) : nom repris du texte tapé dans le sélecteur. */
  nomInitial?: string;
}): React.ReactElement {
  const id = fiche.mode === 'edition' ? fiche.id : null;
  const [vue, setVue] = useState<CustomerView | null>(null);
  const [form, setForm] = useState<FormulaireClient>(() => ({
    ...formulaireClient(null),
    name: nomInitial,
  }));
  const [reference, setReference] = useState<string | null>(null);
  const [chargement, setChargement] = useState(id !== null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [autres, setAutres] = useState<string[]>([]);
  const [champs, setChamps] = useState<Partial<Record<ChampClient, string>>>({});
  const [perimee, setPerimee] = useState(false);
  const [existant, setExistant] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const lectureSeule = !gerer;
  const modifie =
    !lectureSeule &&
    (reference === null
      ? JSON.stringify(form) !== JSON.stringify({ ...formulaireClient(null), name: nomInitial })
      : JSON.stringify(form) !== reference);
  // Validation à la sortie du champ (ADR-0074 § 9) : mêmes règles que l'envoi.
  const {
    errors: erreursSaisie,
    touch,
    validateAll,
    submitCount: soumissions,
  } = useBlurValidation<ChampClient>(() => {
    const p = preparerClient(form);
    return p.ok ? {} : p.champs;
  });
  // Erreur du serveur d'abord, sinon celle de la saisie.
  const champsAffiches: Partial<Record<ChampClient, string>> = { ...erreursSaisie, ...champs };

  const charger = useCallback(async (): Promise<void> => {
    if (id === null) return;
    setChargement(true);
    setErreurChargement(null);
    try {
      const v = await api.getCustomer(id);
      setVue(v);
      setForm(formulaireClient(v));
      setReference(JSON.stringify(formulaireClient(v)));
      setChamps({});
      setErreur(null);
      setAutres([]);
      setPerimee(false);
    } catch (err) {
      // 404 : `CUSTOMER_NOT_FOUND` (supprimé, ou d'une autre organisation — le
      // serveur ne distingue pas) ; 403 : le rôle. Les deux ont leur phrase.
      setErreurChargement(messageVentes(err, 'Impossible de charger ce client.'));
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  function maj<K extends ChampClient>(cle: K, valeur: FormulaireClient[K]): void {
    setForm((f) => ({ ...f, [cle]: valeur }));
    // L'erreur d'un champ disparaît dès qu'on le corrige.
    setChamps((c) => (c[cle] ? { ...c, [cle]: undefined } : c));
  }

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (lectureSeule) return;
    setErreur(null);
    setAutres([]);
    setPerimee(false);
    setExistant(null);
    validateAll();
    const prep = preparerClient(form);
    if (!prep.ok) {
      // Le résumé cliquable (ErrorSummary) liste les champs à compléter.
      setChamps(prep.champs);
      return;
    }
    setChamps({});
    setOccupe(true);
    try {
      const ecrit =
        vue === null
          ? await api.createCustomer(prep.corps)
          : await api.updateCustomer(vue.id, { ...prep.corps, expectedRevision: vue.revision });
      onFermer(ecrit);
    } catch (err) {
      const parChamp = erreursFormulaire(err, CHAMPS);
      setChamps(parChamp.champs);
      setAutres(parChamp.autres);
      setErreur(messageVentes(err, 'Enregistrement impossible.'));
      setPerimee(estRevisionPerimee(err));
      setExistant(ficheExistante(err));
    } finally {
      setOccupe(false);
    }
  }

  const titre = fiche.mode === 'creation' ? 'Nouveau client' : vue ? vue.name : 'Fiche client';

  if (chargement && vue === null) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement de la fiche…
      </p>
    );
  }

  if (erreurChargement && vue === null) {
    return (
      <div className="flex flex-col gap-4">
        <Alerte
          action={
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void charger()} className={BOUTON}>
                Réessayer
              </button>
              <button type="button" onClick={() => onFermer()} className={BOUTON}>
                Retour à la liste
              </button>
            </div>
          }
        >
          <p>{erreurChargement}</p>
        </Alerte>
      </div>
    );
  }

  const type = form.type;
  const requis = type === '' ? null : requiredFieldsFor(type);
  const typeChoisi = CUSTOMER_TYPES.find((t) => t.value === type);

  return (
    <section
      aria-labelledby={enModal ? undefined : 'fiche-client-titre'}
      aria-label={enModal ? titre : undefined}
      className="flex flex-col gap-5"
    >
      <div className={enModal ? 'flex flex-col gap-2 empty:hidden' : 'flex flex-col gap-2'}>
        {enModal ? null : (
          <>
            <button
              type="button"
              onClick={() => onFermer()}
              className="self-start text-sm text-[var(--foreground-muted)] underline-offset-4 hover:underline"
            >
              ← Retour à la liste des clients
            </button>
            <h2 id="fiche-client-titre" className="font-display text-lg font-bold tracking-tight">
              {titre}
            </h2>
          </>
        )}
        {vue ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--foreground-muted)]">
            <span>{libelleTypeClient(vue.type)}</span>
            {!vue.active ? (
              <Pastille ton="attention">Désactivé le {formatDate(vue.deactivatedAt)}</Pastille>
            ) : null}
            {vue.invoiced ? <Pastille ton="neutre">Déjà facturé</Pastille> : null}
          </div>
        ) : null}
        {lectureSeule ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Consultation seule : votre rôle permet de voir les clients, pas de les modifier.
          </p>
        ) : null}
      </div>

      <Form
        onSubmit={(e) => void enregistrer(e)}
        dirty={modifie}
        autoFocusFirst={vue === null}
        className="flex max-w-3xl flex-col gap-5"
      >
        {erreur ? (
          <Alerte
            action={
              perimee || existant ? (
                <div className="flex flex-wrap gap-2">
                  {perimee ? (
                    <button
                      type="button"
                      onClick={() => void charger()}
                      className={`${BOUTON} text-[var(--foreground)]`}
                    >
                      Recharger la fiche (vos modifications seront perdues)
                    </button>
                  ) : null}
                  {existant ? (
                    <Link
                      href={`${base}?fiche=${encodeURIComponent(existant)}`}
                      className={`${BOUTON} text-[var(--foreground)]`}
                    >
                      Ouvrir la fiche existante
                    </Link>
                  ) : null}
                </div>
              ) : undefined
            }
          >
            <p>{erreur}</p>
            {autres.length > 0 ? (
              <ul className="list-disc pl-5">
                {autres.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </Alerte>
        ) : null}

        <ErrorSummary
          errors={resumerErreurs(champsAffiches, RESUME_CHAMPS(type))}
          submitCount={soumissions}
        />

        <fieldset disabled={lectureSeule || occupe} className="flex min-w-0 flex-col gap-6">
          <Field
            id="cl-type"
            label="Type de client"
            group
            required
            size="full"
            hint="Le type est celui que la DGI attend sur la facture ; il décide des champs obligatoires."
            error={champsAffiches.type}
          >
            <ChoiceCards
              value={type}
              onChange={(v) => {
                maj('type', v);
                touch('type');
              }}
              options={CUSTOMER_TYPES.map((t) => ({
                value: t.value,
                label: t.label,
                description: t.aide,
              }))}
            />
          </Field>

          {type === '' ? (
            <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
              Choisissez un type pour afficher les champs de la fiche.
            </p>
          ) : (
            <>
              <FormSection title="Identité">
                <Field
                  id="cl-name"
                  label={libelleNom(type)}
                  required
                  size="lg"
                  error={champsAffiches.name}
                >
                  <TextInput
                    value={form.name}
                    onChange={(e) => maj('name', e.target.value)}
                    onBlur={() => touch('name')}
                    maxLength={200}
                    autoComplete="organization"
                  />
                </Field>
                <Field
                  id="cl-nif"
                  label="NIF"
                  required={requis?.nif === true}
                  optional={requis?.nif !== true}
                  size="sm"
                  hint={
                    requis?.nif
                      ? `Obligatoire pour une ${typeChoisi?.label.toLowerCase() ?? 'ce type'}. Espaces et tirets retirés à l’enregistrement.`
                      : 'Espaces et tirets retirés à l’enregistrement.'
                  }
                  error={champsAffiches.nif}
                >
                  <TextInput
                    value={form.nif}
                    onChange={(e) => maj('nif', e.target.value)}
                    onBlur={() => touch('nif')}
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono uppercase"
                  />
                </Field>
                {referenceExonerationAdmise(type) ? (
                  <Field
                    id="cl-exemption"
                    label="Référence du document d’exonération"
                    required
                    size="full"
                    hint="Imprimée sur chaque facture de ce client (ligne de commentaire)."
                    error={champsAffiches.exemptionReference}
                  >
                    <TextInput
                      value={form.exemptionReference}
                      onChange={(e) => maj('exemptionReference', e.target.value)}
                      onBlur={() => touch('exemptionReference')}
                      maxLength={200}
                    />
                  </Field>
                ) : null}
              </FormSection>

              <FormSection
                title="Coordonnées"
                description="Facultatives. L’adresse est imprimée sur la facture si elle est renseignée."
              >
                <Field id="cl-phone" label="Téléphone" size="md" error={champsAffiches.phone}>
                  <PhoneInput
                    value={form.phone}
                    onChange={(v) => maj('phone', v)}
                    onBlur={() => touch('phone')}
                    maxLength={20}
                  />
                </Field>
                <Field id="cl-email" label="Adresse e-mail" size="md" error={champsAffiches.email}>
                  <TextInput
                    type="email"
                    inputMode="email"
                    value={form.email}
                    onChange={(e) => maj('email', e.target.value)}
                    onBlur={() => touch('email')}
                    maxLength={254}
                    autoComplete="email"
                  />
                </Field>
                <Field id="cl-address" label="Adresse" size="full" error={champsAffiches.address}>
                  <TextArea
                    value={form.address}
                    onChange={(e) => maj('address', e.target.value)}
                    onBlur={() => touch('address')}
                    maxLength={255}
                    rows={2}
                    autoComplete="street-address"
                  />
                </Field>
              </FormSection>
            </>
          )}
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button onClick={() => onFermer()} className="max-sm:h-11">
            {lectureSeule ? 'Retour à la liste' : 'Annuler'}
          </Button>
          {lectureSeule ? null : (
            <SubmitButton busy={occupe} busyLabel="Enregistrement…" className="max-sm:h-11">
              {fiche.mode === 'creation' ? 'Créer le client' : 'Enregistrer les modifications'}
            </SubmitButton>
          )}
        </div>
      </Form>
      {/* ADR-0046 — S9 : documents liés à un client existant (présentation O5). */}
      {id !== null && !enModal ? (
        <EntityDocumentsPanel
          entityType="customer"
          entityId={id}
          libelle={vue?.name ?? 'ce client'}
        />
      ) : null}
    </section>
  );
}
