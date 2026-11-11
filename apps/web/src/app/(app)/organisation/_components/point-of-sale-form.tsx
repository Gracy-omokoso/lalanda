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

import { Button, Field, FormGrid, SegmentedControl, SubmitButton, TextInput } from '@lalanda/ui';
import { useState } from 'react';

import type { EdefEnvironment, PointOfSaleView } from '@/lib/api';

import {
  PHRASE_PRODUCTION_FERMEE,
  erreurDgi,
  erreurFormatJeton,
  libelleEnvironnement,
  messageFiscal,
} from './fiscal-model';

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
  // ADR-0074 : `Field` + `TextInput` masqué (pas de `PasswordInput` : le jeton
  // n'a pas de bouton « Afficher », il ne se relit jamais à l'écran).
  return (
    <Field
      id={id}
      label={libelle}
      required
      size="full"
      error={erreur ?? undefined}
      hint="Le jeton fourni par la DGI pour cet e-MCF. Il est vérifié auprès de la DGI avant d’être enregistré, chiffré, puis n’est plus jamais affiché : seuls ses quatre derniers caractères restent visibles."
    >
      <TextInput
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
        className="font-mono"
      />
    </Field>
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
      aria-label="Nouveau point de vente"
      className="flex flex-col gap-4"
    >
      <FormGrid>
        <Field
          id="pdv-label"
          label="Nom du point de vente"
          required
          size="lg"
          hint="Un nom pour vous y retrouver. Il n’est pas transmis à la DGI."
        >
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            required
            autoFocus
            placeholder="Boutique Gombe"
          />
        </Field>
        <Field
          id="pdv-nim"
          label="NIM attendu"
          optional
          size="sm"
          hint="S’il est renseigné, le jeton n’est accepté que si la DGI renvoie ce même numéro d’e-MCF."
        >
          <TextInput
            value={nim}
            onChange={(e) => setNim(e.target.value)}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field
          id="pdv-env"
          label="Environnement DGI"
          group
          size="full"
          newRow
          hint={
            <>
              {productionDisponible ? null : (
                <span id="pdv-env-ferme" className="block">
                  {PHRASE_PRODUCTION_FERMEE}
                </span>
              )}
              L’environnement est fixé à la création : un jeton de test ne fonctionne pas en
              production, et inversement.
            </>
          }
        >
          <SegmentedControl<EdefEnvironment>
            value={environment}
            onChange={setEnvironment}
            options={[
              { value: 'test', label: 'Mode test' },
              { value: 'production', label: 'Production', disabled: !productionDisponible },
            ]}
          />
        </Field>
      </FormGrid>

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
        <Button onClick={onAnnuler} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          variant="secondary"
          showShortcut={false}
          busy={envoi}
          busyLabel="Vérification auprès de la DGI…"
          disabled={label.trim() === '' || jeton === ''}
          className="max-sm:h-11"
        >
          {`Vérifier et ajouter (${libelleEnvironnement(environment)})`}
        </SubmitButton>
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
        <Button onClick={onAnnuler} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          variant="secondary"
          showShortcut={false}
          busy={envoi}
          busyLabel="Vérification auprès de la DGI…"
          disabled={jeton === ''}
          className="max-sm:h-11"
        >
          {reactivation ? 'Vérifier et réactiver' : 'Vérifier et remplacer'}
        </SubmitButton>
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
      <FormGrid>
        <Field id={`pdv-label-${point.id}`} label="Nom du point de vente" required size="lg">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            required
          />
        </Field>
        <Field id={`pdv-nim-${point.id}`} label="NIM attendu" optional size="sm">
          <TextInput
            value={nim}
            onChange={(e) => setNim(e.target.value)}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
      </FormGrid>
      {erreur ? <ErreurFiscale erreur={erreur} /> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button onClick={onAnnuler} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          variant="secondary"
          showShortcut={false}
          busy={envoi}
          busyLabel="Enregistrement…"
          disabled={label.trim() === ''}
          className="max-sm:h-11"
        >
          Enregistrer
        </SubmitButton>
      </div>
    </form>
  );
}
