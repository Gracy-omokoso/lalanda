'use client';

// Paramètres de l'organisation (S21a) — `organization.manage`.
//
// Un 403 ici est la réponse NORMALE pour un Analyste, un Comptable ou un Lecteur
// arrivé par l'URL : la page dit alors ce que son rôle permet, elle n'affiche pas
// une bannière rouge (pattern retenu sur /members en S20a).
//
// Limite annoncée plutôt que masquée : le logo se règle par URL, pas par upload —
// aucun stockage de fichiers n'est branché, exactement comme la photo de profil
// de l'espace compte (docs/04 § S20b).

import { useCallback, useEffect, useState } from 'react';

import { api, type DisplayCurrency, type OrganizationSettingsView } from '@/lib/api';

import { estRefus, formatDateHeure, messageErreur } from './organization-model';

export function SettingsPanel(): React.ReactElement {
  const [vue, setVue] = useState<OrganizationSettingsView | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [occupe, setOccupe] = useState(false);

  const [nom, setNom] = useState('');
  const [pays, setPays] = useState('');
  const [devise, setDevise] = useState<DisplayCurrency>('USD');
  const [logo, setLogo] = useState('');

  /** Recharge et RÉINITIALISE le formulaire depuis la réponse du serveur. */
  const appliquer = useCallback((s: OrganizationSettingsView): void => {
    setVue(s);
    setNom(s.name);
    setPays(s.pays);
    setDevise(s.deviseAffichage);
    setLogo(s.logoUrl ?? '');
  }, []);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      appliquer(await api.getOrganizationSettings());
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) {
        setRefuse(true);
        setVue(null);
      } else {
        setErreur(messageErreur(err, 'Impossible de charger les paramètres.'));
      }
    } finally {
      setChargement(false);
    }
  }, [appliquer]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setOccupe(true);
    setErreur(null);
    setNotice(null);
    try {
      const enregistre = await api.putOrganizationSettings({
        name: nom.trim(),
        pays: pays.trim().toUpperCase(),
        deviseAffichage: devise,
        // Un champ vidé signifie « pas de logo ». La chaîne vide n'est pas une
        // URL : l'envoyer telle quelle ferait échouer la validation serveur.
        logoUrl: logo.trim() === '' ? null : logo.trim(),
      });
      appliquer(enregistre);
      setNotice('Paramètres enregistrés.');
    } catch (err) {
      setErreur(messageErreur(err, 'Enregistrement impossible.'));
    } finally {
      setOccupe(false);
    }
  }

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }

  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-sm font-medium">Section réservée à la gouvernance</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          Les paramètres de l’organisation sont modifiables par un Propriétaire ou un
          Administrateur. Votre rôle vous donne accès au tableau de bord et à vos projets.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void enregistrer(e)} className="flex max-w-2xl flex-col gap-5">
      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}

      <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {notice ?? ''}
      </span>

      <Champ
        id="org-nom"
        label="Nom de l’organisation"
        aide="Affiché dans l’application, les rapports et les invitations."
      >
        <input
          id="org-nom"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          maxLength={100}
          required
          aria-describedby="org-nom-aide"
          className={CHAMP}
        />
      </Champ>

      <Champ
        id="org-pays"
        label="Pays par défaut"
        aide="Code ISO à deux lettres (CD pour la RDC). Sert de valeur par défaut aux nouveaux projets ; les projets existants gardent le leur."
      >
        <input
          id="org-pays"
          value={pays}
          onChange={(e) => setPays(e.target.value.toUpperCase())}
          maxLength={2}
          minLength={2}
          required
          aria-describedby="org-pays-aide"
          className={`${CHAMP} uppercase`}
        />
      </Champ>

      <Champ
        id="org-devise"
        label="Devise d’affichage par défaut"
        aide="N’altère aucun chiffre déjà validé : un plan figé reste retrouvable à l’identique."
      >
        <select
          id="org-devise"
          value={devise}
          onChange={(e) => setDevise(e.target.value as DisplayCurrency)}
          aria-describedby="org-devise-aide"
          className={CHAMP}
        >
          {/* Liste servie par l'API — l'interface ne la code pas en dur. */}
          {(vue?.options.currencies ?? [devise]).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Champ>

      <Champ
        id="org-logo"
        label="Logo (URL)"
        aide="Adresse http(s) d’une image déjà en ligne. L’envoi de fichier n’est pas disponible : le stockage n’est pas encore branché. Laissez vide pour n’afficher aucun logo."
      >
        <input
          id="org-logo"
          type="url"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          placeholder="https://…"
          aria-describedby="org-logo-aide"
          className={CHAMP}
        />
      </Champ>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={occupe}
          className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <span className="fig text-xs text-[var(--foreground-muted)]">
          {vue?.updatedAt
            ? `Dernière modification : ${formatDateHeure(vue.updatedAt)}`
            : 'Jamais modifié'}
          {vue ? ` · identifiant stable : ${vue.slug}` : ''}
        </span>
      </div>
    </form>
  );
}

const CHAMP =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50';

/** Champ étiqueté avec son aide reliée par `aria-describedby` (docs/04). */
function Champ({
  id,
  label,
  aide,
  children,
}: {
  id: string;
  label: string;
  aide: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      <p id={`${id}-aide`} className="text-xs text-[var(--foreground-muted)]">
        {aide}
      </p>
    </div>
  );
}
