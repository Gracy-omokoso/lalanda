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
import { buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import type { HrPrivateField, HrPrivateSections } from '@/lib/api-hr-admin';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

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

const LABEL = 'flex min-w-0 flex-col gap-1 text-xs font-medium';

function Texte({
  label,
  valeur,
  onChange,
  type = 'text',
  multi = false,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  type?: string;
  multi?: boolean;
}): React.ReactElement {
  return (
    <label className={LABEL}>
      {label}
      {multi ? (
        <textarea
          rows={4}
          className={CHAMP}
          value={valeur}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={type}
          className={CHAMP}
          value={valeur}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
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
    <fieldset className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <legend className="px-1 text-xs font-semibold">{titre}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
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
              <Texte
                label="En vigueur depuis le"
                type="date"
                valeur={s.effectiveFrom}
                onChange={(v) => majLigne('salaires', i, { effectiveFrom: v })}
              />
              <Texte
                label="Montant"
                valeur={s.amount}
                onChange={(v) => majLigne('salaires', i, { amount: v })}
              />
              <label className={LABEL}>
                Devise
                <select
                  className={CHAMP}
                  value={s.currency}
                  onChange={(e) =>
                    majLigne('salaires', i, { currency: e.target.value as HrCurrency })
                  }
                >
                  {HR_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                Période
                <select
                  className={CHAMP}
                  value={s.period}
                  onChange={(e) =>
                    majLigne('salaires', i, { period: e.target.value as HrCompensationPeriod })
                  }
                >
                  {HR_COMPENSATION_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {LIBELLES_PERIODE_SALAIRE[p]}
                    </option>
                  ))}
                </select>
              </label>
              <Texte
                label="Note (facultative)"
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
              <label className={LABEL}>
                Nature
                <select
                  className={CHAMP}
                  value={c.kind}
                  onChange={(e) =>
                    majLigne('comptes', i, { kind: e.target.value as 'bank' | 'mobile_money' })
                  }
                >
                  <option value="bank">Compte bancaire</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </label>
              <Texte
                label={c.kind === 'bank' ? 'Banque' : 'Opérateur'}
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
                    valeur={c.iban}
                    onChange={(v) => majLigne('comptes', i, { iban: v })}
                  />
                  <Texte
                    label="BIC (facultatif)"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Texte
              label="Date de naissance (facultative)"
              type="date"
              valeur={f.birthDate}
              onChange={(v) => maj({ birthDate: v })}
            />
            <Texte
              label="Nationalité (facultative)"
              valeur={f.nationality}
              onChange={(v) => maj({ nationality: v })}
            />
          </div>
          {f.pieces.map((p, i) => (
            <Ligne key={i} titre={`Pièce ${i + 1}`} onRetirer={() => retirer('pieces', i)}>
              <label className={LABEL}>
                Nature
                <select
                  className={CHAMP}
                  value={p.kind}
                  onChange={(e) =>
                    majLigne('pieces', i, { kind: e.target.value as HrIdDocumentKind })
                  }
                >
                  {HR_ID_DOCUMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {LIBELLES_PIECE[k]}
                    </option>
                  ))}
                </select>
              </label>
              <Texte
                label="Numéro"
                valeur={p.number}
                onChange={(v) => majLigne('pieces', i, { number: v })}
              />
              <Texte
                label="Délivrée le (facultatif)"
                type="date"
                valeur={p.issuedOn}
                onChange={(v) => majLigne('pieces', i, { issuedOn: v })}
              />
              <Texte
                label="Expire le (facultatif)"
                type="date"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Texte label="Adresse" valeur={f.address} onChange={(v) => maj({ address: v })} />
            <Texte
              label="Téléphone personnel"
              type="tel"
              valeur={f.personalPhone}
              onChange={(v) => maj({ personalPhone: v })}
            />
            <Texte
              label="E-mail personnel"
              type="email"
              valeur={f.personalEmail}
              onChange={(v) => maj({ personalEmail: v })}
            />
          </div>
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
              <Texte
                label="Téléphone"
                type="tel"
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
        <Texte label="Motif détaillé" multi valeur={f.note} onChange={(v) => maj({ note: v })} />
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
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
