'use client';

// Connexion à l'espace externe — ADR-0078 § 3 : adresse, puis code à six chiffres reçu
// par e-mail (À CHAQUE connexion, aucun mot de passe, aucun appareil mémorisé). Le
// serveur répond la même chose qu'un compte existe ou non ; l'écran aussi.

import type { PortalOrganizationChoice } from '@lalanda/shared/work';
import { Alert, Button, Field, FormGrid, OtpInput, Select, TextInput } from '@lalanda/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { choixOrganisations, detailPortail, portalApi } from '@/lib/portal-api';

type Etape = 'adresse' | 'code' | 'organisation';

export function ConnexionPortail(): React.ReactElement {
  const id = useId();
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>('adresse');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [organisations, setOrganisations] = useState<PortalOrganizationChoice[]>([]);
  const [organisation, setOrganisation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function demander(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      await portalApi.requestCode(email.trim());
      setCode('');
      setEtape('code');
    } catch (err) {
      setErreur(detailPortail(err).message ?? 'La demande n’a pas abouti. Réessayez.');
    } finally {
      setEnvoi(false);
    }
  }

  async function verifier(saisi: string, org?: string): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      await portalApi.verify(email.trim(), saisi, org);
      router.push('/portail/projets');
    } catch (err) {
      const choix = choixOrganisations(err);
      if (choix) {
        setOrganisations(choix);
        setOrganisation(choix[0]?.organizationId ?? '');
        setEtape('organisation');
      } else {
        setErreur(detailPortail(err).message ?? 'Code invalide ou expiré.');
        setCode('');
      }
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Connexion à votre espace</h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          Contacts clients et consultants : saisissez l’adresse à laquelle vous avez été invité. Un
          code vous est envoyé par e-mail à chaque connexion.
        </p>
      </div>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}

      {etape === 'adresse' ? (
        <form noValidate onSubmit={(e) => void demander(e)} className="flex flex-col gap-4">
          <FormGrid>
            <Field id={`${id}-email`} label="Adresse e-mail" required size="full">
              <TextInput
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </FormGrid>
          <Button type="submit" busy={envoi} disabled={envoi || !email.includes('@')}>
            Recevoir un code
          </Button>
        </form>
      ) : null}

      {etape === 'code' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Si un espace est ouvert pour <strong>{email}</strong>, un code vient d’y être envoyé. Il
            est valable 10 minutes.
          </p>
          <Field id={`${id}-code`} label="Code reçu" group size="full">
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(c) => void verifier(c)}
              disabled={envoi}
              autoFocus
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              busy={envoi}
              disabled={envoi || code.length !== 6}
              onClick={() => void verifier(code)}
            >
              Se connecter
            </Button>
            <Button variant="secondary" disabled={envoi} onClick={() => void demander()}>
              Renvoyer un code
            </Button>
            <Button variant="ghost" disabled={envoi} onClick={() => setEtape('adresse')}>
              Changer d’adresse
            </Button>
          </div>
        </div>
      ) : null}

      {etape === 'organisation' ? (
        <div className="flex flex-col gap-4">
          <Field id={`${id}-org`} label="Organisation à ouvrir" size="full">
            <Select<string>
              value={organisation}
              onChange={setOrganisation}
              options={organisations.map((o) => ({
                value: o.organizationId,
                label: o.organizationName || 'Organisation',
              }))}
            />
          </Field>
          <Button
            busy={envoi}
            disabled={envoi || !organisation}
            onClick={() => void verifier(code, organisation)}
          >
            Ouvrir
          </Button>
        </div>
      ) : null}
    </div>
  );
}
