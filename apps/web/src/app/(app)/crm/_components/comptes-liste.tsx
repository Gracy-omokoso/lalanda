'use client';

// Comptes — ADR-0040 § 3.1 et § 8.1 : liste triée par nom, recherche, filtre
// prospect / client, archivés ; création d'un PROSPECT (un compte client naît de
// la fiche client de Ventes). Compteurs rendus par l'API.
//
// ADR-0074 : grille sémantique, téléphone en `PhoneInput`, responsable en
// `EntityPicker` (`ChoixMembre`) ; filtres : recherche, nature en segments,
// archivés en interrupteur. `preparerCompte` inchangé.

import {
  Badge,
  Button,
  Field,
  FormGrid,
  Modal,
  PhoneInput,
  SegmentedControl,
  SubmitButton,
  Switch,
  TextInput,
  buttonClasses,
  type EntityCreateFormProps,
} from '@lalanda/ui';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type CrmAccountListItem } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  FILTRES_COMPTES_INITIAUX,
  FILTRES_NATURE,
  formulaireCompte,
  libelleNature,
  preparerCompte,
  requeteComptes,
  type FiltresComptes,
  type FormulaireCompte,
} from './comptes-model';
import { useAccesCrm } from './crm-access';
import { formatEcheance, lienCompte, messageCrm, peutGererCrm } from './crm-model';
import { Bandeau, ChoixMembre, type CompteChoisi } from './crm-ui';
import { nomMembre } from './pipeline-model';

/**
 * Fiche complète de création d'un prospect (`POST /crm/accounts`, `crm.manage`).
 * Sert aussi de création rapide depuis un choix de compte (`nomInitial`).
 */
export function NouveauProspect({
  onCree,
  nomInitial = '',
  onAnnuler,
}: {
  onCree: (compte: CompteChoisi) => void;
  nomInitial?: string;
  onAnnuler?: () => void;
}): React.ReactElement {
  const { membres } = useAccesCrm();
  const [f, setF] = useState<FormulaireCompte>(() => ({
    ...formulaireCompte(),
    name: nomInitial,
  }));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const p = preparerCompte(f);
    if (!p.ok) {
      setChamps(p.champs);
      return;
    }
    try {
      const r = await crmApi.createAccount({ ...p.corps, name: f.name.trim() });
      if (r.warnings.some((w) => w.code === 'CRM_ACCOUNT_SIMILAR_NAME')) {
        window.alert(
          'Un compte au nom proche existe déjà : vérifiez qu’il ne s’agit pas de la même entreprise (vous pourrez fusionner les deux).',
        );
      }
      onCree({ id: r.account.id, name: r.account.name, kind: r.account.kind });
    } catch (err) {
      setErreur(messageCrm(err, 'Création impossible.'));
    }
  }

  return (
    <form noValidate onSubmit={(e) => void creer(e)} className="flex flex-col gap-4">
      <FormGrid>
        <Field id="cp-nom" label="Nom de l’entreprise" required size="lg" error={champs['name']}>
          <TextInput
            value={f.name}
            maxLength={200}
            autoFocus
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field id="cp-secteur" label="Secteur" size="md" newRow>
          <TextInput
            value={f.industry}
            maxLength={80}
            onChange={(e) => setF({ ...f, industry: e.target.value })}
          />
        </Field>
        <Field id="cp-origine" label="Origine" size="md" hint="Salon, recommandation, site…">
          <TextInput
            value={f.origin}
            maxLength={80}
            onChange={(e) => setF({ ...f, origin: e.target.value })}
          />
        </Field>
        <Field id="cp-tel" label="Téléphone" size="md" newRow>
          <PhoneInput value={f.phone} onChange={(phone) => setF({ ...f, phone })} />
        </Field>
        <Field id="cp-email" label="E-mail" size="md">
          <TextInput
            type="email"
            autoComplete="off"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </Field>
        <Field id="cp-responsable" label="Responsable" size="md" newRow>
          <ChoixMembre
            id="cp-responsable"
            valeur={f.ownerId}
            membres={membres}
            onChange={(ownerId) => setF({ ...f, ownerId })}
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {onAnnuler ? (
          <Button onClick={onAnnuler} className="max-sm:h-11">
            Annuler
          </Button>
        ) : null}
        <SubmitButton showShortcut={false} className="max-sm:h-11">
          Créer le prospect
        </SubmitButton>
      </div>
    </form>
  );
}

/** Création rapide d'un prospect depuis un `ChoixCompte` (réservée à `crm.manage`). */
export function creationProspect(
  gerer: boolean,
): ((p: EntityCreateFormProps<CompteChoisi>) => React.ReactNode) | undefined {
  if (!gerer) return undefined;
  return function CreationProspect({ initialText, onCreated, onCancel }) {
    return <NouveauProspect nomInitial={initialText} onCree={onCreated} onAnnuler={onCancel} />;
  };
}

export function ComptesListe(): React.ReactElement {
  const { actions, membres } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [filtres, setFiltres] = useState<FiltresComptes>(FILTRES_COMPTES_INITIAUX);
  const [items, setItems] = useState<CrmAccountListItem[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback((f: FiltresComptes, cursor: string | null) => {
    crmApi
      .listAccounts(requeteComptes(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Impossible de charger les comptes.')));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => charger(filtres, null), 200);
    return () => clearTimeout(t);
  }, [filtres, charger]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Building2}
        titre="Comptes"
        sousTitre="Les entreprises suivies : prospects et clients, avec leurs contacts et opportunités."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setCreation(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouveau prospect
            </button>
          ) : null
        }
      >
        <FormGrid>
          <Field id="cp-liste-q" label="Rechercher" size="md">
            <TextInput
              type="search"
              placeholder="Rechercher par nom…"
              value={filtres.q}
              onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
              leading={<Search aria-hidden="true" className="h-4 w-4" />}
            />
          </Field>
          <Field id="cp-liste-nature" label="Nature du compte" size="md" group>
            <SegmentedControl
              value={filtres.nature}
              onChange={(nature) => setFiltres({ ...filtres, nature })}
              options={FILTRES_NATURE.map((n) => ({ value: n.valeur, label: n.label }))}
            />
          </Field>
          <Field id="cp-liste-archives" label="Archivés" size="sm">
            <Switch
              checked={filtres.archives}
              onChange={(archives) => setFiltres({ ...filtres, archives })}
              label="Afficher"
            />
          </Field>
        </FormGrid>
      </Bandeau>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouveau prospect"
        size="lg"
      >
        <NouveauProspect
          onCree={() => {
            setCreation(false);
            charger(filtres, null);
          }}
        />
      </Modal>

      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des comptes…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucun compte ne correspond.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={lienCompte(a.id)}
                className="group flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-words">{a.name}</span>
                  <Badge tone={a.kind === 'customer' ? 'success' : 'info'}>
                    {libelleNature(a.kind)}
                  </Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {[a.industry, a.ownerId ? `Responsable : ${nomMembre(membres, a.ownerId)}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'Sans responsable'}
                </span>
                <span className="grid grid-cols-2 gap-2">
                  <span className="rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs">
                    <strong className="block font-display text-lg tabular-nums">
                      {a.counts.contacts}
                    </strong>
                    contact{a.counts.contacts > 1 ? 's' : ''}
                  </span>
                  <span className="rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs">
                    <strong className="block font-display text-lg tabular-nums">
                      {a.counts.openOpportunities}
                    </strong>
                    opportunité{a.counts.openOpportunities > 1 ? 's' : ''} en cours
                  </span>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {a.nextActivity
                    ? `Prochaine action : ${a.nextActivity.subject} — ${formatEcheance(a.nextActivity.dueAt)}`
                    : 'Aucune action prévue'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtres, suivante)}
        >
          Afficher plus de comptes
        </button>
      ) : null}
    </section>
  );
}
