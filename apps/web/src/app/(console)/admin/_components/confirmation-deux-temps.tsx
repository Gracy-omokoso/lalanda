'use client';

// Confirmation en deux temps (ADR-0074 § 10 ; ADR-0053 — P8).
//
// Écran 1 : le mot de passe. Écran 2 : le code à six chiffres (`OtpInput`, envoi
// automatique à la sixième case), ou un code de secours sur demande. Le code n'est
// plus posé à côté du mot de passe.
//
// RIEN ne change côté sécurité : le mot de passe et le second facteur partent
// ENSEMBLE, dans la même requête qu'avant (`POST /admin/reauth` ou la confirmation
// d'enrôlement). Passer à l'écran 2 ne vérifie rien et n'appelle rien ; un mot de
// passe faux est refusé par l'API au moment de l'envoi, et l'écran revient alors à
// l'étape du mot de passe. Les deux valeurs sont vidées après succès.

import {
  Button,
  Field,
  Form,
  OtpInput,
  PasswordInput,
  SubmitButton,
  TextInput,
  type OtpInputHandle,
} from '@lalanda/ui';
import { ArrowLeft } from 'lucide-react';
import { useRef, useState } from 'react';

import type { PlatformSecondFactor } from '@/lib/api';

import { Bandeau } from './admin-chrome';
import {
  codeEnrolementValide,
  etapeApresErreur,
  motDePassePret,
  secondFacteurDe,
  type EtapeConnexion,
} from './deux-facteurs-model';

export function ConfirmationDeuxTemps({
  onConfirmer,
  messageErreur,
  libelleAction,
  motDePasseFacultatif = false,
  aideMotDePasse,
  codeDeSecoursPermis = true,
}: {
  /** Envoi unique du mot de passe et du second facteur ; rejette si l'API refuse. */
  onConfirmer: (
    motDePasse: string,
    facteur: PlatformSecondFactor & { code?: string },
  ) => Promise<void>;
  messageErreur: (err: unknown) => string;
  libelleAction: string;
  /** Enrôlement d'un compte Google : pas de mot de passe. */
  motDePasseFacultatif?: boolean;
  aideMotDePasse?: string;
  /** Enrôlement : les codes de secours n'existent pas encore. */
  codeDeSecoursPermis?: boolean;
}): React.ReactElement {
  const [etape, setEtape] = useState<EtapeConnexion>('motdepasse');
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [secours, setSecours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const otp = useRef<OtpInputHandle>(null);

  const facteur = codeDeSecoursPermis
    ? secondFacteurDe(code)
    : codeEnrolementValide(code)
      ? { code: code.replace(/\s/g, '') }
      : null;

  async function envoyer(saisie: string): Promise<void> {
    const f = codeDeSecoursPermis
      ? secondFacteurDe(saisie)
      : codeEnrolementValide(saisie)
        ? { code: saisie.replace(/\s/g, '') }
        : null;
    if (!f || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await onConfirmer(motDePasse, f);
      setMotDePasse('');
      setCode('');
    } catch (err) {
      setErreur(messageErreur(err));
      setCode('');
      const suite = etapeApresErreur(err);
      setEtape(suite);
      if (suite === 'code') setTimeout(() => otp.current?.focus(), 0);
    } finally {
      setEnvoi(false);
    }
  }

  if (etape === 'motdepasse') {
    return (
      <Form
        key="motdepasse"
        className="flex max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!motDePassePret(motDePasse, motDePasseFacultatif)) return;
          setErreur(null);
          setEtape('code');
        }}
      >
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
          Étape 1 sur 2
        </p>
        <Field
          label="Mot de passe"
          size="full"
          required={!motDePasseFacultatif}
          optional={motDePasseFacultatif}
          hint={aideMotDePasse}
        >
          <PasswordInput
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={!motDePassePret(motDePasse, motDePasseFacultatif)}
          >
            Continuer
          </Button>
        </div>
        {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      </Form>
    );
  }

  return (
    <Form
      key="code"
      autoFocusFirst={false}
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void envoyer(code);
      }}
    >
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
        Étape 2 sur 2
      </p>
      {secours ? (
        <Field
          label="Code de secours"
          size="full"
          hint="Douze caractères, avec ou sans tirets. Chaque code ne sert qu’une fois."
        >
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            autoFocus
            className="font-mono uppercase tracking-widest"
          />
        </Field>
      ) : (
        <Field
          label="Code de l’application d’authentification"
          size="full"
          group
          hint="Six chiffres. L’envoi part tout seul à la sixième case."
        >
          <OtpInput
            ref={otp}
            value={code}
            onChange={setCode}
            onComplete={(c) => void envoyer(c)}
            disabled={envoi}
            autoFocus
          />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton busy={envoi} busyLabel="Vérification…" disabled={!facteur}>
          {libelleAction}
        </SubmitButton>
        <Button
          variant="ghost"
          size="sm"
          disabled={envoi}
          onClick={() => {
            setEtape('motdepasse');
            setCode('');
            setErreur(null);
          }}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Mot de passe
        </Button>
        {codeDeSecoursPermis ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={envoi}
            onClick={() => {
              setSecours((s) => !s);
              setCode('');
            }}
          >
            {secours ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
          </Button>
        ) : null}
      </div>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </Form>
  );
}
