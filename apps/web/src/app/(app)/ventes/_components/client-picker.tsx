'use client';

// Choix du client d'un document de vente (ADR-0074 § 4) — facture, avoir, devis.
//
// Un client enregistré se TROUVE en tapant (nom, NIF, e-mail : même recherche
// qu'avant, `GET /sales/customers?status=active&limit=50&q=…`) ; s'il n'existe
// pas, « + » ouvre la fiche client en fenêtre, pré-remplie avec le texte tapé.
// Le client créé est choisi d'office ; le document garde toute sa saisie. La
// création rapide n'est offerte qu'avec `sales.manage` (l'API le vérifie aussi).

import { Checkbox, EntityPicker, Field, FormGrid, SegmentedControl, TextInput } from '@lalanda/ui';

import { api, type CustomerType, type CustomerView } from '@/lib/api';

import type { FormulaireDocument } from '../factures/_components/invoice-model';

import { CustomerForm } from './customer-form';
import { libelleTypeClient } from './sales-model';

/** Liste des clients : liens de la fiche ouverte en création rapide. */
const CLIENTS_BASE = '/ventes/clients';

/** Client tel que le sélecteur le connaît : la fiche lue, ou ce que le brouillon en garde. */
type ClientChoisi = Pick<CustomerView, 'id' | 'name'> &
  Partial<Pick<CustomerView, 'type' | 'typeLabel' | 'nif'>>;

/** Sous-texte d'un client dans la liste : type DGI et NIF. */
function sousTexteClient(c: ClientChoisi): string | null {
  const morceaux = [c.typeLabel ?? null, c.nif ? `NIF ${c.nif}` : null].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(' · ') : null;
}

// Recherche servie par l'API (mêmes paramètres qu'avant : clients actifs, 50 au plus).
const chercherClients = async (q: string): Promise<CustomerView[]> =>
  (await api.listCustomers({ status: 'active', limit: 50, ...(q ? { q } : {}) })).items;

export function ChoixClientDocument({
  form,
  setForm,
  verrouille,
  desactive,
  creer,
  erreur,
  typeClient,
  onType = () => undefined,
  libelleSansFiche = 'Vente de comptoir',
}: {
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  /** Avoir : client repris de la facture d'origine. */
  verrouille: boolean;
  /** Lecture seule (rôle, envoi en cours) : champs visibles mais inactifs. */
  desactive: boolean;
  /** `sales.manage` : la création rapide d'un client est proposée. */
  creer: boolean;
  erreur: string | undefined;
  typeClient: CustomerType | null;
  onType?: (t: CustomerType | null) => void;
  /** Libellé du choix sans fiche (facture : vente de comptoir ; devis : personne physique). */
  libelleSansFiche?: string;
}): React.ReactElement {
  const mode = form.client?.mode ?? 'fiche';
  const choisi: ClientChoisi | null =
    form.client?.mode === 'fiche'
      ? {
          id: form.client.customerId,
          name: form.client.nom,
          ...(typeClient ? { type: typeClient, typeLabel: libelleTypeClient(typeClient) } : {}),
        }
      : null;

  function choisir(c: ClientChoisi | null): void {
    setForm((f) => ({
      ...f,
      client: c
        ? {
            mode: 'fiche',
            customerId: c.id,
            nom: c.name,
            printContactDetails: false,
          }
        : null,
    }));
    onType(c?.type ?? null);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={desactive}>
      <legend className="mb-1 text-sm font-semibold">Client</legend>
      {verrouille ? (
        <p className="text-sm">
          {form.client?.nom || 'Vente de comptoir'}{' '}
          <span className="text-xs text-[var(--foreground-muted)]">
            (repris de la facture d’origine)
          </span>
        </p>
      ) : (
        <FormGrid>
          <Field label="Type de vente" group size="full">
            <SegmentedControl<'fiche' | 'comptoir'>
              value={mode}
              onChange={(m) => {
                if (m === mode) return;
                if (m === 'fiche') {
                  setForm((f) => ({ ...f, client: null }));
                  onType(null);
                } else {
                  setForm((f) => ({ ...f, client: { mode: 'comptoir', nom: '' } }));
                  onType('PP');
                }
              }}
              options={[
                { value: 'fiche', label: 'Client enregistré' },
                { value: 'comptoir', label: libelleSansFiche },
              ]}
            />
          </Field>
          {mode === 'fiche' ? (
            <>
              <Field
                id="client-choix"
                label="Client"
                size="lg"
                newRow
                hint={
                  creer
                    ? 'Tapez un nom, un NIF ou un e-mail. Client absent : « + » le crée sans quitter le document.'
                    : 'Tapez un nom, un NIF ou un e-mail.'
                }
                error={erreur}
              >
                <EntityPicker<ClientChoisi>
                  value={choisi}
                  onChange={choisir}
                  search={chercherClients}
                  getKey={(c) => c.id}
                  getLabel={(c) => c.name}
                  getDescription={sousTexteClient}
                  placeholder="Nom, NIF ou e-mail"
                  recentKey="ventes.clients"
                  clearable
                  createTitle="Nouveau client"
                  createButtonLabel="Créer un client"
                  createSize="lg"
                  {...(creer
                    ? {
                        createForm: ({ initialText, onCreated, onCancel }) => (
                          <CustomerForm
                            fiche={{ mode: 'creation' }}
                            gerer
                            base={CLIENTS_BASE}
                            enModal
                            nomInitial={initialText}
                            onFermer={(c) => (c ? onCreated(c) : onCancel())}
                          />
                        ),
                      }
                    : {})}
                />
              </Field>
              {form.client?.mode === 'fiche' ? (
                <Field label="Coordonnées du client" group size="full">
                  <Checkbox
                    checked={form.client.printContactDetails}
                    onChange={(v) =>
                      setForm((f) =>
                        f.client?.mode === 'fiche'
                          ? { ...f, client: { ...f.client, printContactDetails: v } }
                          : f,
                      )
                    }
                    label="Le client demande que ses coordonnées figurent sur le document"
                  />
                </Field>
              ) : null}
            </>
          ) : (
            <Field
              id="client-comptoir"
              label="Nom du client"
              optional
              size="lg"
              newRow
              error={erreur}
            >
              <TextInput
                value={form.client?.mode === 'comptoir' ? form.client.nom : ''}
                maxLength={200}
                onChange={(e) =>
                  setForm((f) => ({ ...f, client: { mode: 'comptoir', nom: e.target.value } }))
                }
              />
            </Field>
          )}
        </FormGrid>
      )}
      {verrouille && erreur ? (
        <p id="client-erreur" className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </fieldset>
  );
}
