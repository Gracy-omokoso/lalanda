'use client';

// Comptes — ADR-0040 § 3.1 et § 8.1 : liste triée par nom, recherche, filtre
// prospect / client, archivés ; création d'un PROSPECT (un compte client naît de
// la fiche client de Ventes). Compteurs rendus par l'API.

import { Badge, buttonClasses } from '@lalanda/ui';
import { Building2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type CrmAccountListItem } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

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
import { Bandeau, ChoixMembre } from './crm-ui';
import { nomMembre } from './pipeline-model';

function NouveauProspect({ onCree }: { onCree: (id: string) => void }): React.ReactElement {
  const { membres } = useAccesCrm();
  const [f, setF] = useState<FormulaireCompte>(formulaireCompte());
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
      onCree(r.account.id);
    } catch (err) {
      setErreur(messageCrm(err, 'Création impossible.'));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void creer(e)}
      className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <h3 className="text-sm font-semibold sm:col-span-2 lg:col-span-3">Nouveau prospect</h3>
      <Champ id="cp-nom" label="Nom de l’entreprise" requis erreur={champs['name']}>
        <input
          id="cp-nom"
          className={CHAMP}
          value={f.name}
          maxLength={200}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          {...aria('cp-nom', champs['name'])}
        />
      </Champ>
      <Champ id="cp-secteur" label="Secteur">
        <input
          id="cp-secteur"
          className={CHAMP}
          value={f.industry}
          maxLength={80}
          onChange={(e) => setF({ ...f, industry: e.target.value })}
        />
      </Champ>
      <Champ id="cp-origine" label="Origine" aide="Salon, recommandation, site…">
        <input
          id="cp-origine"
          className={CHAMP}
          value={f.origin}
          maxLength={80}
          onChange={(e) => setF({ ...f, origin: e.target.value })}
        />
      </Champ>
      <Champ id="cp-tel" label="Téléphone">
        <input
          id="cp-tel"
          className={CHAMP}
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
      </Champ>
      <Champ id="cp-email" label="E-mail">
        <input
          id="cp-email"
          type="email"
          className={CHAMP}
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
      </Champ>
      <Champ id="cp-responsable" label="Responsable">
        <ChoixMembre
          id="cp-responsable"
          valeur={f.ownerId}
          membres={membres}
          onChange={(ownerId) => setF({ ...f, ownerId })}
        />
      </Champ>
      {erreur ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        </div>
      ) : null}
      <button
        type="submit"
        className={buttonClasses(
          'primary',
          'md',
          'sm:col-span-2 sm:justify-self-start lg:col-span-3',
        )}
      >
        Créer le prospect
      </button>
    </form>
  );
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
              aria-expanded={creation}
              onClick={() => setCreation((c) => !c)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {creation ? 'Fermer' : 'Nouveau prospect'}
            </button>
          ) : null
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            aria-label="Rechercher un compte"
            placeholder="Rechercher par nom…"
            className={`${CHAMP} sm:max-w-sm`}
            value={filtres.q}
            onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Nature du compte">
            {FILTRES_NATURE.map((n) => (
              <button
                key={n.valeur}
                type="button"
                className={BOUTON_PETIT}
                aria-pressed={filtres.nature === n.valeur}
                onClick={() => setFiltres({ ...filtres, nature: n.valeur })}
              >
                {n.label}
              </button>
            ))}
            <button
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={filtres.archives}
              onClick={() => setFiltres({ ...filtres, archives: !filtres.archives })}
            >
              Archivés
            </button>
          </div>
        </div>
      </Bandeau>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {gerer && creation ? (
        <NouveauProspect
          onCree={() => {
            setCreation(false);
            charger(filtres, null);
          }}
        />
      ) : null}

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
