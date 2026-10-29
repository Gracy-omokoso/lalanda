'use client';

// Contacts et prospects — ADR-0035 § 5 : liste, création, import et export CSV.

import { buttonClasses } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerView } from '@/lib/api';
import { crmApi, type ContactView } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';

import {
  formulaireContact,
  messageCrm,
  peutGererCrm,
  preparerContact,
  type FormulaireContact,
} from './crm-model';
import { CsvActions } from './crm-nav';

export function ContactsPanel(): React.ReactElement {
  const { actions } = useAccesVentes();
  const gerer = peutGererCrm(actions);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ContactView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [f, setF] = useState<FormulaireContact>(formulaireContact());
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [clients, setClients] = useState<CustomerView[]>([]);

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

  useEffect(() => {
    if (!gerer) return;
    api
      .listCustomers({ status: 'active', limit: 100 })
      .then((p) => setClients(p.items))
      .catch(() => undefined);
  }, [gerer]);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const p = preparerContact(f);
    if (!p.ok) {
      setChamps(p.champs);
      return;
    }
    try {
      await crmApi.createContact(p.corps);
      setF(formulaireContact());
      setChamps({});
      charger();
    } catch (err) {
      setErreur(messageCrm(err, 'Création impossible.'));
    }
  }

  return (
    <section className="flex flex-col gap-5">
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <input
        type="search"
        aria-label="Rechercher un contact"
        placeholder="Nom, e-mail, entreprise…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={CHAMP}
      />
      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span>
                <strong>{c.name}</strong>
                {c.jobTitle ? ` · ${c.jobTitle}` : ''} —{' '}
                {c.kind === 'prospect'
                  ? `Prospect${c.companyName ? ` (${c.companyName})` : ''}`
                  : `Client : ${c.customerName ?? '—'}`}
                <span className="block text-xs text-[var(--foreground-muted)]">
                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                </span>
              </span>
              {gerer ? (
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  onClick={() =>
                    void crmApi
                      .deleteContact(c.id)
                      .then(charger)
                      .catch((err) => setErreur(messageCrm(err, 'Suppression impossible.')))
                  }
                >
                  Supprimer
                </button>
              ) : null}
            </li>
          ))}
          {items.length === 0 ? <li className="p-3 text-sm">Aucun contact.</li> : null}
        </ul>
      )}

      {gerer ? (
        <>
          <form
            onSubmit={(e) => void creer(e)}
            className="grid gap-3 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-3"
            noValidate
          >
            <h3 className="text-sm font-semibold sm:col-span-3">Nouveau contact</h3>
            <Champ id="ct-nom" label="Nom" requis erreur={champs['name']}>
              <input
                id="ct-nom"
                className={CHAMP}
                value={f.name}
                maxLength={200}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                {...aria('ct-nom', champs['name'])}
              />
            </Champ>
            <Champ id="ct-fonction" label="Fonction">
              <input
                id="ct-fonction"
                className={CHAMP}
                value={f.jobTitle}
                maxLength={100}
                onChange={(e) => setF({ ...f, jobTitle: e.target.value })}
              />
            </Champ>
            <Champ id="ct-email" label="E-mail">
              <input
                id="ct-email"
                type="email"
                className={CHAMP}
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Champ>
            <Champ id="ct-tel" label="Téléphone">
              <input
                id="ct-tel"
                className={CHAMP}
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
              />
            </Champ>
            <Champ id="ct-rattachement" label="Rattaché à">
              <select
                id="ct-rattachement"
                className={CHAMP}
                value={f.rattachement}
                onChange={(e) =>
                  setF({ ...f, rattachement: e.target.value as FormulaireContact['rattachement'] })
                }
              >
                <option value="prospect">Un prospect</option>
                <option value="client">Un client existant</option>
              </select>
            </Champ>
            {f.rattachement === 'client' ? (
              <Champ id="ct-client" label="Client" requis erreur={champs['customerId']}>
                <select
                  id="ct-client"
                  className={CHAMP}
                  value={f.customerId}
                  onChange={(e) => setF({ ...f, customerId: e.target.value })}
                >
                  <option value="">Choisir…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Champ>
            ) : (
              <Champ id="ct-entreprise" label="Entreprise du prospect">
                <input
                  id="ct-entreprise"
                  className={CHAMP}
                  value={f.companyName}
                  maxLength={200}
                  onChange={(e) => setF({ ...f, companyName: e.target.value })}
                />
              </Champ>
            )}
            <button
              type="submit"
              className={buttonClasses('primary', 'md', 'sm:col-span-3 sm:justify-self-start')}
            >
              Ajouter le contact
            </button>
          </form>
          <CsvActions
            quoi="contacts"
            colonnes="nom ; fonction ; email ; telephone ; entreprise ; nif_client ; notes"
            exporter={crmApi.exportContacts}
            importer={crmApi.importContacts}
            onImporte={charger}
          />
        </>
      ) : null}
    </section>
  );
}
