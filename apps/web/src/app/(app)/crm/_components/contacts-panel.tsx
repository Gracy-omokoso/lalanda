'use client';

// Contacts — ADR-0035 § 5, ADR-0040 § 2.2 : liste, création, rattachement à un
// compte (prospect ou client) ou « sans entreprise », détacher, import et
// export CSV. Le compte remplace le choix « client / entreprise saisie ».
//
// ADR-0074 : grille sémantique, téléphone en `PhoneInput`, compte en
// `EntityPicker` (`ChoixCompte`) avec « + » prospect sous `crm.manage` (droit de
// `POST /crm/accounts`). `preparerContact` inchangé.

import {
  Button,
  Field,
  FormGrid,
  Modal,
  PhoneInput,
  SubmitButton,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Contact, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type ContactView } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { creationProspect } from './comptes-liste';
import { useAccesCrm } from './crm-access';
import {
  formulaireContact,
  lienCompte,
  messageCrm,
  peutGererCrm,
  preparerContact,
  rattachementContact,
  type FormulaireContact,
} from './crm-model';
import { CsvActions } from './crm-nav';
import { Bandeau, ChoixCompte } from './crm-ui';

function Rattachement({
  c,
  onFait,
  onErreur,
}: {
  c: ContactView;
  onFait: () => void;
  onErreur: (m: string) => void;
}): React.ReactElement {
  const [ouvert, setOuvert] = useState(false);
  const [accountId, setAccountId] = useState(c.accountId ?? '');

  async function enregistrer(cible: string): Promise<void> {
    const p = preparerContact({ ...formulaireContact(c), accountId: cible });
    if (!p.ok) return;
    try {
      await crmApi.updateContact(c.id, { ...p.corps, expectedRevision: c.revision });
      setOuvert(false);
      onFait();
    } catch (err) {
      onErreur(messageCrm(err, 'Rattachement impossible.'));
    }
  }

  if (!ouvert) {
    return (
      <span className="flex flex-wrap gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={() => setOuvert(true)}>
          {c.accountId ? 'Changer de compte' : 'Rattacher à un compte'}
        </button>
        {c.accountId ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => void enregistrer('')}>
            Détacher
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-2 sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        void enregistrer(accountId);
      }}
    >
      <ChoixCompte
        id={`rattacher-${c.id}`}
        valeur={accountId}
        nomInitial={c.accountName}
        onChange={(id) => setAccountId(id)}
      />
      <span className="flex gap-2">
        <button type="submit" className={BOUTON_PETIT} disabled={accountId === ''}>
          Rattacher
        </button>
        <button type="button" className={BOUTON_PETIT} onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </span>
    </form>
  );
}

export function ContactsPanel(): React.ReactElement {
  const { actions } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ContactView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [f, setF] = useState<FormulaireContact>(formulaireContact());
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  function fermerCreation(): void {
    setCreation(false);
    setF(formulaireContact());
    setChamps({});
    setErreurCreation(null);
  }

  const charger = useCallback(() => {
    crmApi
      .listContacts({ limit: 100, ...(q.trim() ? { q: q.trim() } : {}) })
      .then((p) => {
        setItems(p.items);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Impossible de charger les contacts.')));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(charger, 200);
    return () => clearTimeout(t);
  }, [charger]);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const p = preparerContact(f);
    if (!p.ok) {
      setChamps(p.champs);
      return;
    }
    setErreurCreation(null);
    try {
      await crmApi.createContact(p.corps);
      fermerCreation();
      charger();
    } catch (err) {
      setErreurCreation(messageCrm(err, 'Création impossible.'));
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Contact}
        titre="Contacts"
        sousTitre="Les personnes, rattachées à leur compte (prospect ou client)."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setCreation(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouveau contact
            </button>
          ) : null
        }
      >
        <FormGrid>
          <Field id="ct-liste-q" label="Rechercher un contact" size="lg">
            <TextInput
              type="search"
              placeholder="Nom, e-mail, entreprise…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              leading={<Search aria-hidden="true" className="h-4 w-4" />}
            />
          </Field>
        </FormGrid>
      </Bandeau>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <Modal open={gerer && creation} onClose={fermerCreation} title="Nouveau contact" size="md">
        <form
          onSubmit={(e) => void creer(e)}
          aria-label="Nouveau contact"
          className="flex flex-col gap-4"
          noValidate
        >
          <FormGrid>
            <Field id="ct-nom" label="Nom" required size="md" error={champs['name']}>
              <TextInput
                value={f.name}
                maxLength={200}
                autoFocus
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field id="ct-fonction" label="Fonction" size="md">
              <TextInput
                value={f.jobTitle}
                maxLength={100}
                onChange={(e) => setF({ ...f, jobTitle: e.target.value })}
              />
            </Field>
            <Field id="ct-email" label="E-mail" size="md" newRow>
              <TextInput
                type="email"
                autoComplete="off"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Field>
            <Field id="ct-tel" label="Téléphone" size="md">
              <PhoneInput value={f.phone} onChange={(phone) => setF({ ...f, phone })} />
            </Field>
            <Field
              id="ct-compte"
              label="Compte"
              size="full"
              hint="Tapez pour chercher. Vide : personne sans entreprise."
            >
              <ChoixCompte
                id="ct-compte"
                valeur={f.accountId}
                onChange={(accountId) => setF({ ...f, accountId })}
                creer={creationProspect(gerer)}
              />
            </Field>
          </FormGrid>
          {erreurCreation ? (
            <Alerte>
              <p>{erreurCreation}</p>
            </Alerte>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button onClick={fermerCreation} className="max-sm:h-11">
              Annuler
            </Button>
            <SubmitButton showShortcut={false} className="max-sm:h-11">
              Ajouter le contact
            </SubmitButton>
          </div>
        </form>
      </Modal>

      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
              <span className="min-w-0 break-words">
                <strong>{c.name}</strong>
                {c.jobTitle ? ` · ${c.jobTitle}` : ''} —{' '}
                {c.accountId ? (
                  <Link href={lienCompte(c.accountId)} className="underline underline-offset-2">
                    {rattachementContact(c)}
                  </Link>
                ) : (
                  <span className="text-[var(--foreground-muted)]">{rattachementContact(c)}</span>
                )}
                <span className="block text-xs text-[var(--foreground-muted)]">
                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                </span>
              </span>
              {gerer ? (
                <span className="flex flex-wrap items-start gap-2">
                  <Rattachement c={c} onFait={charger} onErreur={setErreur} />
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    onClick={() => {
                      if (!window.confirm(`Supprimer le contact « ${c.name} » ?`)) return;
                      void crmApi
                        .deleteContact(c.id)
                        .then(charger)
                        .catch((err) => setErreur(messageCrm(err, 'Suppression impossible.')));
                    }}
                  >
                    Supprimer
                  </button>
                </span>
              ) : null}
            </li>
          ))}
          {items.length === 0 ? <li className="p-3 text-sm">Aucun contact.</li> : null}
        </ul>
      )}

      {gerer ? (
        <CsvActions
          quoi="contacts"
          colonnes="nom ; fonction ; email ; telephone ; entreprise ; nif_client ; notes"
          exporter={crmApi.exportContacts}
          importer={crmApi.importContacts}
          onImporte={charger}
        />
      ) : null}
    </section>
  );
}
