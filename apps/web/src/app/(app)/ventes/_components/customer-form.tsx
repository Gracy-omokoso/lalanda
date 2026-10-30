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

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerView } from '@/lib/api';

import { Alerte, aria, BOUTON, Champ, CHAMP, Pastille } from './form-ui';
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
}): React.ReactElement {
  const id = fiche.mode === 'edition' ? fiche.id : null;
  const [vue, setVue] = useState<CustomerView | null>(null);
  const [form, setForm] = useState<FormulaireClient>(() => formulaireClient(null));
  const [chargement, setChargement] = useState(id !== null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [autres, setAutres] = useState<string[]>([]);
  const [champs, setChamps] = useState<Partial<Record<ChampClient, string>>>({});
  const [perimee, setPerimee] = useState(false);
  const [existant, setExistant] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const lectureSeule = !gerer;

  const charger = useCallback(async (): Promise<void> => {
    if (id === null) return;
    setChargement(true);
    setErreurChargement(null);
    try {
      const v = await api.getCustomer(id);
      setVue(v);
      setForm(formulaireClient(v));
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
    const prep = preparerClient(form);
    if (!prep.ok) {
      setChamps(prep.champs);
      setErreur('Certains champs sont à compléter.');
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

      <form
        onSubmit={(e) => void enregistrer(e)}
        noValidate
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

        <fieldset disabled={lectureSeule || occupe} className="flex flex-col gap-5">
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={champs.type ? 'cl-type-erreur' : undefined}
          >
            <legend className="mb-1 text-sm font-semibold">
              Type de client
              <span className="text-[var(--foreground-muted)]" aria-hidden="true">
                {' '}
                *
              </span>
              <span className="sr-only"> (obligatoire)</span>
            </legend>
            <p className="-mt-1 text-xs text-[var(--foreground-muted)]">
              Le type est celui que la DGI attend sur la facture ; il décide des champs
              obligatoires.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CUSTOMER_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ${
                    type === t.value
                      ? 'border-[var(--accent)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="cl-type"
                    value={t.value}
                    checked={type === t.value}
                    onChange={() => maj('type', t.value)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{t.label}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">{t.aide}</span>
                  </span>
                </label>
              ))}
            </div>
            {champs.type ? (
              <p id="cl-type-erreur" className="text-xs font-medium text-[var(--danger)]">
                {champs.type}
              </p>
            ) : null}
          </fieldset>

          {type === '' ? (
            <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
              Choisissez un type pour afficher les champs de la fiche.
            </p>
          ) : (
            <>
              <fieldset className="flex flex-col gap-4">
                <legend className="mb-2 text-sm font-semibold">Identité</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Champ id="cl-name" label={libelleNom(type)} requis erreur={champs.name}>
                    <input
                      id="cl-name"
                      value={form.name}
                      onChange={(e) => maj('name', e.target.value)}
                      maxLength={200}
                      required
                      autoComplete="organization"
                      className={CHAMP}
                      {...aria('cl-name', champs.name)}
                    />
                  </Champ>
                  <Champ
                    id="cl-nif"
                    label="NIF"
                    requis={requis?.nif === true}
                    aide={
                      requis?.nif
                        ? `Obligatoire pour une ${typeChoisi?.label.toLowerCase() ?? 'ce type'}. Les espaces et tirets sont retirés à l’enregistrement.`
                        : 'Facultatif pour ce type. Les espaces et tirets sont retirés à l’enregistrement.'
                    }
                    erreur={champs.nif}
                  >
                    <input
                      id="cl-nif"
                      value={form.nif}
                      onChange={(e) => maj('nif', e.target.value)}
                      maxLength={40}
                      required={requis?.nif === true}
                      autoComplete="off"
                      spellCheck={false}
                      className={`${CHAMP} font-mono uppercase`}
                      {...aria('cl-nif', champs.nif, true)}
                    />
                  </Champ>
                  {referenceExonerationAdmise(type) ? (
                    <div className="sm:col-span-2">
                      <Champ
                        id="cl-exemption"
                        label="Référence du document d’exonération"
                        requis
                        aide="Imprimée sur chaque facture de ce client (ligne de commentaire)."
                        erreur={champs.exemptionReference}
                      >
                        <input
                          id="cl-exemption"
                          value={form.exemptionReference}
                          onChange={(e) => maj('exemptionReference', e.target.value)}
                          maxLength={200}
                          required
                          className={CHAMP}
                          {...aria('cl-exemption', champs.exemptionReference, true)}
                        />
                      </Champ>
                    </div>
                  ) : null}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-4">
                <legend className="mb-2 text-sm font-semibold">Coordonnées</legend>
                <p className="-mt-2 text-xs text-[var(--foreground-muted)]">
                  Facultatives. L’adresse est imprimée sur la facture si elle est renseignée.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Champ id="cl-phone" label="Téléphone" erreur={champs.phone}>
                    <input
                      id="cl-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => maj('phone', e.target.value)}
                      maxLength={20}
                      autoComplete="tel"
                      placeholder="+243 …"
                      className={CHAMP}
                      {...aria('cl-phone', champs.phone)}
                    />
                  </Champ>
                  <Champ id="cl-email" label="Adresse e-mail" erreur={champs.email}>
                    <input
                      id="cl-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => maj('email', e.target.value)}
                      maxLength={254}
                      autoComplete="email"
                      className={CHAMP}
                      {...aria('cl-email', champs.email)}
                    />
                  </Champ>
                  <div className="sm:col-span-2">
                    <Champ id="cl-address" label="Adresse" erreur={champs.address}>
                      <textarea
                        id="cl-address"
                        value={form.address}
                        onChange={(e) => maj('address', e.target.value)}
                        maxLength={255}
                        rows={2}
                        autoComplete="street-address"
                        className={CHAMP}
                        {...aria('cl-address', champs.address)}
                      />
                    </Champ>
                  </div>
                </div>
              </fieldset>
            </>
          )}
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {lectureSeule ? null : (
            <button type="submit" disabled={occupe} className={BOUTON}>
              {occupe
                ? 'Enregistrement…'
                : fiche.mode === 'creation'
                  ? 'Créer le client'
                  : 'Enregistrer les modifications'}
            </button>
          )}
          <button type="button" onClick={() => onFermer()} className={BOUTON}>
            {lectureSeule ? 'Retour à la liste' : 'Annuler'}
          </button>
        </div>
      </form>
    </section>
  );
}
