'use client';

// Formulaires d'un point de vente e-MCF (S25b — ADR-0021 §4.1).
//
// ── Le jeton ─────────────────────────────────────────────────────────────────
//
// Champ masqué, `autocomplete="off"`, vidé dès l'envoi — que l'envoi réussisse
// ou non. Il n'est jamais placé dans l'URL, `localStorage`, `sessionStorage` ni
// un journal console, et n'est jamais réaffiché : l'API ne renvoie que ses
// quatre derniers caractères. Il vit dans l'état de CE composant le temps de
// la saisie, puis dans la seule fermeture de l'envoi (et de son éventuelle
// nouvelle tentative après ré-authentification).
//
// Le serveur teste le jeton auprès de la DGI AVANT toute écriture : un refus
// signifie que RIEN n'a été enregistré. Le formulaire le dit.

import { useState } from 'react';

import type { EdefEnvironment, PointOfSaleView } from '@/lib/api';

import {
  PHRASE_PRODUCTION_FERMEE,
  erreurDgi,
  erreurFormatJeton,
  libelleEnvironnement,
  messageFiscal,
} from './fiscal-model';

const CHAMP =
  'w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)] disabled:opacity-50';

export interface NouveauPointDeVente {
  label: string;
  environment: EdefEnvironment;
  expectedNim: string | null;
  token: string;
}

/** Erreur d'API affichée avec, s'il y en a, le code et le libellé DGI tels quels. */
export function ErreurFiscale({ erreur }: { erreur: unknown }): React.ReactElement {
  const dgi = erreurDgi(erreur);
  return (
    <div
      role="alert"
      className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
    >
      <p>{messageFiscal(erreur, 'L’opération a échoué.')}</p>
      {dgi ? (
        <p className="mt-1 font-mono text-xs">
          Réponse de la DGI — code : {dgi.code ?? '—'} · libellé : {dgi.message ?? '—'}
        </p>
      ) : null}
    </div>
  );
}

/** Champ du jeton : masqué, jamais pré-rempli, jamais réaffiché. */
function ChampJeton({
  id,
  valeur,
  onChange,
  erreur,
  libelle,
}: {
  id: string;
  valeur: string;
  onChange: (v: string) => void;
  erreur: string | null;
  libelle: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {libelle}
      </label>
      <input
        id={id}
        type="password"
        value={valeur}
        onChange={(e) => onChange(e.target.value.trim())}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // Gestionnaires de mots de passe : ce n'est pas un mot de passe à retenir.
        data-1p-ignore=""
        data-lpignore="true"
        required
        aria-invalid={erreur ? true : undefined}
        aria-describedby={`${id}-aide${erreur ? ` ${id}-erreur` : ''}`}
        className={`${CHAMP} font-mono`}
      />
      <p id={`${id}-aide`} className="text-xs text-[var(--foreground-muted)]">
        Le jeton fourni par la DGI pour cet e-MCF. Il est vérifié auprès de la DGI avant d’être
        enregistré, chiffré, puis n’est plus jamais affiché : seuls ses quatre derniers caractères
        restent visibles.
      </p>
      {erreur ? (
        <p id={`${id}-erreur`} className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

/** Ajout d'un point de vente : nom, environnement, NIM attendu, jeton. */
export function PointOfSaleCreateForm({
  environnementParDefaut,
  productionDisponible,
  onEnvoyer,
  onAnnuler,
}: {
  environnementParDefaut: EdefEnvironment;
  productionDisponible: boolean;
  onEnvoyer: (valeurs: NouveauPointDeVente) => Promise<void>;
  onAnnuler: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState('');
  const [environment, setEnvironment] = useState<EdefEnvironment>(
    productionDisponible ? environnementParDefaut : 'test',
  );
  const [nim, setNim] = useState('');
  const [jeton, setJeton] = useState('');
  const [erreurJeton, setErreurJeton] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const format = erreurFormatJeton(jeton);
    setErreurJeton(format);
    if (format || label.trim() === '') return;
    const token = jeton;
    // Vidé AVANT l'appel : le champ ne garde jamais un jeton déjà envoyé.
    setJeton('');
    setEnvoi(true);
    setErreur(null);
    try {
      await onEnvoyer({
        label: label.trim(),
        environment,
        expectedNim: nim.trim() === '' ? null : nim.trim(),
        token,
      });
    } catch (err) {
      setErreur(err);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void envoyer(e)}
      noValidate
      aria-labelledby="pdv-nouveau-titre"
      className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <h4 id="pdv-nouveau-titre" className="text-sm font-semibold">
        Nouveau point de vente
      </h4>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pdv-label" className="text-sm font-medium">
            Nom du point de vente
          </label>
          <input
            id="pdv-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            required
            placeholder="Boutique Gombe"
            aria-describedby="pdv-label-aide"
            className={CHAMP}
          />
          <p id="pdv-label-aide" className="text-xs text-[var(--foreground-muted)]">
            Un nom pour vous y retrouver. Il n’est pas transmis à la DGI.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pdv-nim" className="text-sm font-medium">
            NIM attendu
          </label>
          <input
            id="pdv-nim"
            value={nim}
            onChange={(e) => setNim(e.target.value)}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="pdv-nim-aide"
            className={`${CHAMP} font-mono`}
          />
          <p id="pdv-nim-aide" className="text-xs text-[var(--foreground-muted)]">
            Facultatif. S’il est renseigné, le jeton n’est accepté que si la DGI renvoie ce même
            numéro d’e-MCF.
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Environnement DGI</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="pdv-env"
            checked={environment === 'test'}
            onChange={() => setEnvironment('test')}
          />
          Mode test
        </label>
        <label
          className={`flex items-center gap-2 text-sm ${productionDisponible ? '' : 'opacity-60'}`}
        >
          <input
            type="radio"
            name="pdv-env"
            checked={environment === 'production'}
            onChange={() => setEnvironment('production')}
            disabled={!productionDisponible}
            aria-describedby={productionDisponible ? undefined : 'pdv-env-ferme'}
          />
          Production
        </label>
        {productionDisponible ? null : (
          <p id="pdv-env-ferme" className="text-xs text-[var(--foreground-muted)]">
            {PHRASE_PRODUCTION_FERMEE}
          </p>
        )}
        <p className="text-xs text-[var(--foreground-muted)]">
          L’environnement est fixé à la création : un jeton de test ne fonctionne pas en production,
          et inversement.
        </p>
      </fieldset>

      <ChampJeton
        id="pdv-jeton"
        libelle="Jeton e-MCF"
        valeur={jeton}
        onChange={(v) => {
          setJeton(v);
          setErreurJeton(null);
        }}
        erreur={erreurJeton}
      />

      {erreur ? <ErreurFiscale erreur={erreur} /> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onAnnuler}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={envoi || label.trim() === '' || jeton === ''}
          className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          {envoi
            ? 'Vérification auprès de la DGI…'
            : `Vérifier et ajouter (${libelleEnvironnement(environment)})`}
        </button>
      </div>
    </form>
  );
}

/** Remplacement du jeton — ou réactivation d'un point de vente retiré. */
export function PointOfSaleTokenForm({
  point,
  onEnvoyer,
  onAnnuler,
}: {
  point: PointOfSaleView;
  onEnvoyer: (token: string) => Promise<void>;
  onAnnuler: () => void;
}): React.ReactElement {
  const [jeton, setJeton] = useState('');
  const [erreurJeton, setErreurJeton] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [envoi, setEnvoi] = useState(false);
  const id = `pdv-jeton-${point.id}`;
  const reactivation = !point.enabled;

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const format = erreurFormatJeton(jeton);
    setErreurJeton(format);
    if (format) return;
    const token = jeton;
    setJeton('');
    setEnvoi(true);
    setErreur(null);
    try {
      await onEnvoyer(token);
    } catch (err) {
      setErreur(err);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={(e) => void envoyer(e)} noValidate className="flex flex-col gap-3">
      <ChampJeton
        id={id}
        libelle={reactivation ? 'Nouveau jeton (réactivation)' : 'Nouveau jeton'}
        valeur={jeton}
        onChange={(v) => {
          setJeton(v);
          setErreurJeton(null);
        }}
        erreur={erreurJeton}
      />
      <p className="text-xs text-[var(--foreground-muted)]">
        Le jeton actuel reste en place si la DGI refuse le nouveau.
      </p>
      {erreur ? <ErreurFiscale erreur={erreur} /> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onAnnuler}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={envoi || jeton === ''}
          className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          {envoi
            ? 'Vérification auprès de la DGI…'
            : reactivation
              ? 'Vérifier et réactiver'
              : 'Vérifier et remplacer'}
        </button>
      </div>
    </form>
  );
}

/** Nom et NIM attendu — sans jeton, sans ré-authentification. */
export function PointOfSaleEditForm({
  point,
  onEnvoyer,
  onAnnuler,
}: {
  point: PointOfSaleView;
  onEnvoyer: (valeurs: { label: string; expectedNim: string | null }) => Promise<void>;
  onAnnuler: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState(point.label);
  const [nim, setNim] = useState(point.expectedNim ?? '');
  const [erreur, setErreur] = useState<unknown>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await onEnvoyer({ label: label.trim(), expectedNim: nim.trim() === '' ? null : nim.trim() });
    } catch (err) {
      setErreur(err);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={(e) => void envoyer(e)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`pdv-label-${point.id}`} className="text-sm font-medium">
            Nom du point de vente
          </label>
          <input
            id={`pdv-label-${point.id}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            required
            className={CHAMP}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`pdv-nim-${point.id}`} className="text-sm font-medium">
            NIM attendu
          </label>
          <input
            id={`pdv-nim-${point.id}`}
            value={nim}
            onChange={(e) => setNim(e.target.value)}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className={`${CHAMP} font-mono`}
          />
        </div>
      </div>
      {erreur ? <ErreurFiscale erreur={erreur} /> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onAnnuler}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={envoi || label.trim() === ''}
          className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
