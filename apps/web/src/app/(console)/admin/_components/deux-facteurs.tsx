'use client';

// Double authentification de la console (ADR-0053 — P8, décision n° 2 retenue).
//
// Deux écrans montés par la coquille AVANT toute page de console :
//   - `EnrolementDeuxFacteurs` : opérateur non enrôlé. QR code (ou clé à saisir), code à
//     six chiffres + mot de passe, puis les dix codes de secours, montrés UNE fois ;
//   - `VerificationDeuxFacteurs` : opérateur enrôlé, session pas encore vérifiée. Mot de
//     passe + code (ou un code de secours) — c'est `POST /admin/reauth`.
//
// Ils ne protègent rien : l'API refuse toute route de console tant que ce n'est pas fait.

import { useState } from 'react';

import { api, type PlatformTwoFactorEnrollmentStart } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

import { formatBackupCode } from '@lalanda/shared/platform';

import { Bandeau } from './admin-chrome';
import {
  codeEnrolementValide,
  messageDeuxFacteurs,
  secondFacteurDe,
  texteCodesDeSecours,
} from './deux-facteurs-model';

const CHAMP = 'rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm';
const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';
const BOUTON =
  'rounded-md border border-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40';

function Cadre({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <h1 className="font-display text-xl font-bold tracking-tight">{titre}</h1>
      {children}
    </section>
  );
}

export function EnrolementDeuxFacteurs({
  onTermine,
}: {
  onTermine: () => void;
}): React.ReactElement {
  const { data: session } = useSession();
  const [debut, setDebut] = useState<PlatformTwoFactorEnrollmentStart | null>(null);
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [conserve, setConserve] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function commencer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      setDebut(await api.startPlatformTwoFactorEnrollment());
    } catch (err) {
      setErreur(messageDeuxFacteurs(err, 'Impossible de préparer l’enrôlement.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function confirmer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await api.confirmPlatformTwoFactorEnrollment({
        ...(motDePasse !== '' ? { password: motDePasse } : {}),
        code: code.replace(/\s/g, ''),
      });
      setMotDePasse('');
      setCode('');
      setCodes(res.backupCodes);
    } catch (err) {
      setErreur(messageDeuxFacteurs(err, 'Code refusé.'));
    } finally {
      setEnvoi(false);
    }
  }

  function telecharger(liste: string[]): void {
    const blob = new Blob([texteCodesDeSecours(liste, session?.user?.email ?? null)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lalanda-codes-de-secours.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (codes) {
    return (
      <Cadre titre="Vos dix codes de secours">
        <p className="text-sm text-[var(--foreground-muted)]">
          La double authentification est active. Si vous perdez votre téléphone, chacun de ces codes
          remplace une fois le code de l’application. Ils ne seront{' '}
          <strong>plus jamais affichés</strong> : enregistrez-les maintenant, hors de votre
          téléphone.
        </p>
        <ul className="grid grid-cols-1 gap-2 font-mono text-sm sm:grid-cols-2">
          {codes.map((c) => (
            <li
              key={c}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 tracking-wider"
            >
              {formatBackupCode(c)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BOUTON} onClick={() => telecharger(codes)}>
            Enregistrer dans un fichier
          </button>
          <button
            type="button"
            className={BOUTON}
            onClick={() =>
              void navigator.clipboard?.writeText(
                texteCodesDeSecours(codes, session?.user?.email ?? null),
              )
            }
          >
            Copier
          </button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={conserve}
            onChange={(e) => setConserve(e.target.checked)}
            className="mt-1"
          />
          J’ai mis ces codes en lieu sûr.
        </label>
        <div>
          <button type="button" className={BOUTON} disabled={!conserve} onClick={onTermine}>
            Ouvrir la console
          </button>
        </div>
      </Cadre>
    );
  }

  return (
    <Cadre titre="Activez la double authentification">
      <p className="text-sm text-[var(--foreground-muted)]">
        La console Lalanda exige, en plus de votre mot de passe, un code à six chiffres produit par
        une application d’authentification (Google Authenticator, Microsoft Authenticator,
        1Password, Authy…). Cela ne concerne que la console : votre espace organisation ne change
        pas.
      </p>
      {!debut ? (
        <div>
          <button
            type="button"
            className={BOUTON}
            disabled={envoi}
            onClick={() => void commencer()}
          >
            {envoi ? 'Préparation…' : 'Commencer'}
          </button>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void confirmer(e)}>
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
            <li>
              Dans l’application, ajoutez un compte en scannant ce QR code.
              <div className="mt-2 flex flex-wrap items-start gap-4">
                {/* Image `data:` produite par l'API : aucune ressource externe. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={debut.qrCodeDataUrl}
                  alt="QR code d’enrôlement de la double authentification"
                  width={220}
                  height={220}
                  className="rounded-md bg-white p-1"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={ETIQUETTE}>Ou saisissez cette clé</span>
                  <code className="break-all rounded-md bg-[var(--surface-2)] px-2 py-1 text-sm tracking-wider">
                    {debut.manualKey}
                  </code>
                </div>
              </div>
            </li>
            <li>Saisissez le code à six chiffres affiché, puis votre mot de passe.</li>
          </ol>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className={ETIQUETTE}>Code à six chiffres</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                className={`${CHAMP} w-36 font-mono tracking-widest`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className={ETIQUETTE}>Mot de passe</span>
              <input
                type="password"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                autoComplete="current-password"
                className={`${CHAMP} w-64`}
              />
            </label>
          </div>
          <p className="text-xs text-[var(--foreground-muted)]">
            Compte créé avec Google, sans mot de passe : laissez le champ vide ; une connexion
            Google de moins de dix minutes est alors exigée.
          </p>
          <div>
            <button
              type="submit"
              className={BOUTON}
              disabled={envoi || !codeEnrolementValide(code)}
            >
              {envoi ? 'Vérification…' : 'Activer'}
            </button>
          </div>
        </form>
      )}
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </Cadre>
  );
}

export function VerificationDeuxFacteurs({
  onTermine,
}: {
  onTermine: () => void;
}): React.ReactElement {
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const facteur = secondFacteurDe(code);

  async function confirmer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!facteur) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await api.confirmReauth(motDePasse, facteur);
      setMotDePasse('');
      setCode('');
      onTermine();
    } catch (err) {
      setErreur(messageDeuxFacteurs(err, 'Vérification refusée.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Cadre titre="Confirmez votre identité">
      <p className="text-sm text-[var(--foreground-muted)]">
        Pour ouvrir la console sur cette session, saisissez votre mot de passe et le code de votre
        application d’authentification. Téléphone perdu : utilisez un de vos codes de secours, à la
        place du code.
      </p>
      <form className="flex flex-col gap-3" onSubmit={(e) => void confirmer(e)}>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className={ETIQUETTE}>Mot de passe</span>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="current-password"
              className={`${CHAMP} w-64`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className={ETIQUETTE}>Code ou code de secours</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              maxLength={16}
              className={`${CHAMP} w-48 font-mono tracking-widest`}
            />
          </label>
        </div>
        <div>
          <button
            type="submit"
            className={BOUTON}
            disabled={envoi || motDePasse === '' || !facteur}
          >
            {envoi ? 'Vérification…' : 'Ouvrir la console'}
          </button>
        </div>
      </form>
      <p className="text-xs text-[var(--foreground-muted)]">
        Ni téléphone ni code de secours : demandez à un autre super-administrateur de réinitialiser
        votre double authentification.
      </p>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </Cadre>
  );
}
