'use client';

// Formulaire d'une section de données sensibles (ADR-0045 § 2.4), dans la fenêtre
// modale de l'onglet. Validation par le schéma partagé (mêmes messages que
// l'API) ; l'API chiffre, journalise et reste juge. Les champs ne se remplissent
// pas tout seuls (`autoComplete="off"`) : le navigateur ne retient rien.

import {
  HR_COMPENSATION_PERIODS,
  HR_CURRENCIES,
  HR_ID_DOCUMENT_KINDS,
  type HrCompensationPeriod,
  type HrCurrency,
  type HrIdDocumentKind,
} from '@lalanda/shared/hr';
import {
  Button,
  DatePicker,
  Field,
  FormGrid,
  MoneyInput,
  PhoneInput,
  SegmentedControl,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
  type FieldSize,
} from '@lalanda/ui';
import { useId, useState } from 'react';

import type { HrPrivateField, HrPrivateSections } from '@/lib/api-hr-admin';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  LIBELLES_PERIODE_SALAIRE,
  LIBELLES_PIECE,
  LIGNE_COMPTE_VIDE,
  LIGNE_CONTACT_VIDE,
  LIGNE_PIECE_VIDE,
  LIGNE_SALAIRE_VIDE,
  MAX_LIGNES,
  formSensible,
  messageSensible,
  validerSensible,
  type FormSensible,
} from './sensible-model';

// ADR-0074 : champs à la largeur de la donnée (`Field` + `FormGrid`), dates en
// `DatePicker`, montant en `MoneyInput` (même chaîne décimale que le lecteur du
// modèle), téléphones en `PhoneInput`, listes en `Select`, nature du moyen de
// paiement en segments. Mêmes champs envoyés, même validation (`validerSensible`).

function Texte({
  label,
  valeur,
  onChange,
  type = 'text',
  multi = false,
  size = 'md',
  newRow = false,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  type?: string;
  multi?: boolean;
  size?: FieldSize;
  newRow?: boolean;
}): React.ReactElement {
  return (
    <Field label={label} size={multi ? 'full' : size} newRow={newRow}>
      {multi ? (
        <TextArea
          rows={4}
          value={valeur}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <TextInput
          type={type}
          value={valeur}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function ChampDate({
  label,
  valeur,
  onChange,
  newRow = false,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  newRow?: boolean;
}): React.ReactElement {
  return (
    <Field label={label} size="sm" newRow={newRow}>
      <DatePicker value={valeur} onChange={onChange} shortcuts={['today']} />
    </Field>
  );
}

function Telephone({
  label,
  valeur,
  onChange,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <Field label={label} size="md">
      <PhoneInput value={valeur} autoComplete="off" onChange={onChange} />
    </Field>
  );
}

function Ligne({
  titre,
  onRetirer,
  children,
}: {
  titre: string;
  onRetirer: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <legend className="px-1 text-xs font-semibold">{titre}</legend>
      <FormGrid>{children}</FormGrid>
      <button type="button" className={`${BOUTON_DANGER} self-start`} onClick={onRetirer}>
        Retirer
      </button>
    </fieldset>
  );
}

export function FormulaireSensible<F extends HrPrivateField>({
  champ,
  actuel,
  onAnnuler,
  onEnregistrer,
}: {
  champ: F;
  actuel: HrPrivateSections[F] | null;
  onAnnuler: () => void;
  onEnregistrer: (data: HrPrivateSections[F]) => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormSensible>(() => formSensible(champ, actuel));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const maj = (p: Partial<FormSensible>): void => setF((x) => ({ ...x, ...p }));

  function majLigne<K extends 'salaires' | 'comptes' | 'pieces' | 'contacts'>(
    cle: K,
    i: number,
    p: Partial<FormSensible[K][number]>,
  ): void {
    setF((x) => ({
      ...x,
      [cle]: (x[cle] as FormSensible[K][number][]).map((l, j) => (j === i ? { ...l, ...p } : l)),
    }));
  }
  function retirer(cle: 'salaires' | 'comptes' | 'pieces' | 'contacts', i: number): void {
    setF((x) => ({ ...x, [cle]: (x[cle] as unknown[]).filter((_, j) => j !== i) }));
  }

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerSensible(champ, f);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs([]);
    setEnvoi(true);
    try {
      await onEnregistrer(r.data);
    } catch (err) {
      setErreurs([messageSensible(err, 'La section n’a pas pu être enregistrée.')]);
    } finally {
      setEnvoi(false);
    }
  }

  const ajouter = (libelle: string, onClick: () => void, plein: boolean): React.ReactElement =>
    plein ? (
      <p className="text-xs text-[var(--foreground-muted)]">Nombre maximal atteint.</p>
    ) : (
      <button type="button" className={`${BOUTON_PETIT} self-start`} onClick={onClick}>
        {libelle}
      </button>
    );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void envoyer(e)}
      noValidate
      autoComplete="off"
      aria-describedby={erreurs.length > 0 ? `${id}-erreurs` : undefined}
    >
      {champ === 'compensation' ? (
        <>
          <p className="text-xs text-[var(--foreground-muted)]">
            Salaire de base tel qu’il figure au contrat. Lalanda ne calcule ni brut, ni net, ni
            cotisation.
          </p>
          {f.salaires.map((s, i) => (
            <Ligne key={i} titre={`Salaire ${i + 1}`} onRetirer={() => retirer('salaires', i)}>
              <ChampDate
                label="En vigueur depuis le"
                valeur={s.effectiveFrom}
                onChange={(v) => majLigne('salaires', i, { effectiveFrom: v })}
              />
              <Field label="Montant" size="sm">
                <MoneyInput
                  value={s.amount}
                  currency={s.currency}
                  autoComplete="off"
                  onChange={(v) => majLigne('salaires', i, { amount: v })}
                />
              </Field>
              <Field label="Devise" size="sm" group>
                <SegmentedControl<HrCurrency>
                  value={s.currency}
                  onChange={(v) => majLigne('salaires', i, { currency: v })}
                  options={HR_CURRENCIES.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Période" size="sm">
                <Select<HrCompensationPeriod>
                  value={s.period}
                  onChange={(v) => majLigne('salaires', i, { period: v })}
                  options={HR_COMPENSATION_PERIODS.map((p) => ({
                    value: p,
                    label: LIBELLES_PERIODE_SALAIRE[p],
                  }))}
                />
              </Field>
              <Texte
                label="Note (facultative)"
                size="full"
                valeur={s.note}
                onChange={(v) => majLigne('salaires', i, { note: v })}
              />
            </Ligne>
          ))}
          {ajouter(
            'Ajouter un salaire',
            () => maj({ salaires: [...f.salaires, { ...LIGNE_SALAIRE_VIDE }] }),
            f.salaires.length >= MAX_LIGNES.salaires,
          )}
        </>
      ) : null}

      {champ === 'bankDetails' ? (
        <>
          {f.comptes.map((c, i) => (
            <Ligne key={i} titre={`Moyen ${i + 1}`} onRetirer={() => retirer('comptes', i)}>
              <Field label="Nature" size="full" group>
                <SegmentedControl<'bank' | 'mobile_money'>
                  value={c.kind}
                  onChange={(v) => majLigne('comptes', i, { kind: v })}
                  options={[
                    { value: 'bank', label: 'Compte bancaire' },
                    { value: 'mobile_money', label: 'Mobile money' },
                  ]}
                />
              </Field>
              <Texte
                label={c.kind === 'bank' ? 'Banque' : 'Opérateur'}
                newRow
                valeur={c.nom}
                onChange={(v) => majLigne('comptes', i, { nom: v })}
              />
              <Texte
                label="Titulaire"
                valeur={c.holderName}
                onChange={(v) => majLigne('comptes', i, { holderName: v })}
              />
              <Texte
                label={c.kind === 'bank' ? 'Numéro de compte' : 'Numéro de téléphone'}
                type={c.kind === 'bank' ? 'text' : 'tel'}
                valeur={c.numero}
                onChange={(v) => majLigne('comptes', i, { numero: v })}
              />
              {c.kind === 'bank' ? (
                <>
                  <Texte
                    label="IBAN (facultatif)"
                    size="lg"
                    valeur={c.iban}
                    onChange={(v) => majLigne('comptes', i, { iban: v })}
                  />
                  <Texte
                    label="BIC (facultatif)"
                    size="sm"
                    valeur={c.swift}
                    onChange={(v) => majLigne('comptes', i, { swift: v })}
                  />
                </>
              ) : null}
            </Ligne>
          ))}
          {ajouter(
            'Ajouter un moyen de paiement',
            () => maj({ comptes: [...f.comptes, { ...LIGNE_COMPTE_VIDE }] }),
            f.comptes.length >= MAX_LIGNES.comptes,
          )}
          <p className="text-xs text-[var(--foreground-muted)]">
            Le collaborateur et les personnes habilitées sont prévenus de tout changement.
          </p>
        </>
      ) : null}

      {champ === 'identity' ? (
        <>
          <FormGrid>
            <ChampDate
              label="Date de naissance (facultative)"
              valeur={f.birthDate}
              onChange={(v) => maj({ birthDate: v })}
            />
            <Texte
              label="Nationalité (facultative)"
              valeur={f.nationality}
              onChange={(v) => maj({ nationality: v })}
            />
          </FormGrid>
          {f.pieces.map((p, i) => (
            <Ligne key={i} titre={`Pièce ${i + 1}`} onRetirer={() => retirer('pieces', i)}>
              <Field label="Nature" size="md">
                <Select<HrIdDocumentKind>
                  value={p.kind}
                  onChange={(v) => majLigne('pieces', i, { kind: v })}
                  options={HR_ID_DOCUMENT_KINDS.map((k) => ({
                    value: k,
                    label: LIBELLES_PIECE[k],
                  }))}
                />
              </Field>
              <Texte
                label="Numéro"
                valeur={p.number}
                onChange={(v) => majLigne('pieces', i, { number: v })}
              />
              <ChampDate
                label="Délivrée le (facultatif)"
                newRow
                valeur={p.issuedOn}
                onChange={(v) => majLigne('pieces', i, { issuedOn: v })}
              />
              <ChampDate
                label="Expire le (facultatif)"
                valeur={p.expiresOn}
                onChange={(v) => majLigne('pieces', i, { expiresOn: v })}
              />
            </Ligne>
          ))}
          {ajouter(
            'Ajouter une pièce',
            () => maj({ pieces: [...f.pieces, { ...LIGNE_PIECE_VIDE }] }),
            f.pieces.length >= MAX_LIGNES.pieces,
          )}
        </>
      ) : null}

      {champ === 'personalContact' ? (
        <>
          <FormGrid>
            <Texte
              label="Adresse"
              size="full"
              valeur={f.address}
              onChange={(v) => maj({ address: v })}
            />
            <Telephone
              label="Téléphone personnel"
              valeur={f.personalPhone}
              onChange={(v) => maj({ personalPhone: v })}
            />
            <Texte
              label="E-mail personnel"
              type="email"
              valeur={f.personalEmail}
              onChange={(v) => maj({ personalEmail: v })}
            />
          </FormGrid>
          {f.contacts.map((c, i) => (
            <Ligne
              key={i}
              titre={`Contact d’urgence ${i + 1}`}
              onRetirer={() => retirer('contacts', i)}
            >
              <Texte
                label="Nom"
                valeur={c.name}
                onChange={(v) => majLigne('contacts', i, { name: v })}
              />
              <Texte
                label="Lien"
                valeur={c.relation}
                onChange={(v) => majLigne('contacts', i, { relation: v })}
              />
              <Telephone
                label="Téléphone"
                valeur={c.phone}
                onChange={(v) => majLigne('contacts', i, { phone: v })}
              />
            </Ligne>
          ))}
          {ajouter(
            'Ajouter un contact d’urgence',
            () => maj({ contacts: [...f.contacts, { ...LIGNE_CONTACT_VIDE }] }),
            f.contacts.length >= MAX_LIGNES.contacts,
          )}
        </>
      ) : null}

      {champ === 'exitNote' ? (
        <FormGrid>
          <Texte label="Motif détaillé" multi valeur={f.note} onChange={(v) => maj({ note: v })} />
        </FormGrid>
      ) : null}

      {erreurs.length > 0 ? (
        <div id={`${id}-erreurs`}>
          <Alerte>
            <ul className="list-disc pl-4">
              {erreurs.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alerte>
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          busy={envoi}
          busyLabel="Enregistrement…"
          showShortcut={false}
          className="max-sm:h-11"
        >
          Enregistrer
        </SubmitButton>
      </div>
    </form>
  );
}
