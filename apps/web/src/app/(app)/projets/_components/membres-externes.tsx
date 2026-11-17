'use client';

// Membres externes d'un projet — ADR-0078. Section de l'écran « Membres ».
//
// Contact client (relié à la fiche client DU projet, compte CRM facultatif) et consultant
// (fiche fournisseur, référent interne, « peut ouvrir le projet »). Ils se connectent à
// l'espace externe par un code reçu par e-mail à chaque connexion. Invitation, réglage et
// retrait par la gestion du projet (chef, adjoint, `work.manage`) ; l'API reste juge.

import {
  WORK_EXTERNAL_KIND_LABELS,
  type WorkExternalKind,
  type WorkExternalMembersView,
} from '@lalanda/shared/work';
import {
  Alert,
  Button,
  Field,
  FormGrid,
  SegmentedControl,
  Select,
  StatusPill,
  Switch,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Mail, UserMinus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { ChoixEntite } from '@/components/choix-entite';
import { workExternalApi } from '@/lib/work-external-api';

import { useShell } from '../../_components/shell-context';
import { libelleFermeture, messageExterne } from '@/lib/externes-model';
import { useProjet } from './project-context';
import { codeWork, messageWork } from './projets-model';

const GENRES: { value: WorkExternalKind; label: string }[] = [
  { value: 'client', label: WORK_EXTERNAL_KIND_LABELS.client },
  { value: 'consultant', label: WORK_EXTERNAL_KIND_LABELS.consultant },
];

function message(err: unknown, repli: string): string {
  return messageExterne(codeWork(err)) ?? messageWork(err, repli);
}

interface Brouillon {
  kind: WorkExternalKind;
  email: string;
  name: string;
  crmAccountId: string;
  supplierId: string;
  referentUserId: string;
  canOpenProject: boolean;
}

const VIDE: Brouillon = {
  kind: 'client',
  email: '',
  name: '',
  crmAccountId: '',
  supplierId: '',
  referentUserId: '',
  canOpenProject: false,
};

export function MembresExternes(): React.ReactElement {
  const id = useId();
  const { projectId, members } = useProjet();
  const { organizationId } = useShell();
  const [vue, setVue] = useState<WorkExternalMembersView | null>(null);
  const [f, setF] = useState<Brouillon>(VIDE);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let annule = false;
    workExternalApi
      .listProjectExternals(projectId)
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(message(err, 'Les membres externes sont illisibles.'));
      });
    return () => {
      annule = true;
    };
  }, [projectId, version]);

  const referents = members
    .filter((m) => m.canUpdate && m.canLead !== false)
    .map((m) => ({ value: m.userId, label: m.name }));

  async function agir(p: Promise<unknown>, repli: string, ok?: string): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    setInfo(null);
    try {
      await p;
      if (ok) setInfo(ok);
      recharger();
    } catch (err) {
      setErreur(message(err, repli));
    } finally {
      setEnvoi(false);
    }
  }

  async function inviter(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!vue) return;
    const commun = { email: f.email, name: f.name };
    const body =
      f.kind === 'client'
        ? {
            kind: 'client' as const,
            ...commun,
            customerId: vue.customerId ?? '',
            ...(f.crmAccountId ? { crmAccountId: f.crmAccountId } : {}),
          }
        : {
            kind: 'consultant' as const,
            ...commun,
            supplierId: f.supplierId,
            referentUserId: f.referentUserId,
            canOpenProject: f.canOpenProject,
          };
    await agir(
      workExternalApi.invite(projectId, body),
      'L’invitation n’a pas pu être envoyée.',
      `Invitation envoyée à ${f.email}. La personne se connectera avec un code reçu par e-mail.`,
    );
    setF({ ...VIDE, kind: f.kind });
  }

  const actifs = vue?.members.filter((m) => m.status === 'active') ?? [];
  const fermes = vue?.members.filter((m) => m.status === 'closed') ?? [];

  return (
    <section aria-labelledby={`${id}-titre`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-titre`} className="text-sm font-semibold">
            Membres externes
          </h3>
          <Link
            href="/projets/externes"
            className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Tous les comptes externes
          </Link>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          Un contact client voit seulement les tâches marquées « visible par le client » et les
          commentaires partagés ; un consultant voit ses tâches (ou le projet, si vous l’ouvrez).
          Aucun montant, aucune marge, aucun coût ne leur est montré.
        </p>
      </div>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      {info ? <Alert tone="success">{info}</Alert> : null}

      {vue?.canManage ? (
        <form
          noValidate
          onSubmit={(e) => void inviter(e)}
          className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <FormGrid>
            <Field id={`${id}-genre`} label="Inviter" group size="full">
              <SegmentedControl<WorkExternalKind>
                value={f.kind}
                onChange={(kind) => setF({ ...VIDE, kind, email: f.email, name: f.name })}
                options={GENRES}
              />
            </Field>
            <Field id={`${id}-email`} label="Adresse e-mail" required size="md" newRow>
              <TextInput
                type="email"
                autoComplete="off"
                value={f.email}
                maxLength={254}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Field>
            <Field id={`${id}-nom`} label="Nom" required size="md">
              <TextInput
                value={f.name}
                maxLength={120}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            {f.kind === 'client' ? (
              vue.canInviteClient ? (
                <Field
                  id={`${id}-crm`}
                  label="Compte CRM"
                  optional
                  size="lg"
                  newRow
                  hint="Le contact est relié à la fiche client du projet ; le compte CRM est facultatif."
                >
                  <ChoixEntite
                    id={`${id}-crm`}
                    type="crm_account"
                    organizationId={organizationId}
                    valeur={f.crmAccountId}
                    onChange={(o) => setF({ ...f, crmAccountId: o?.id ?? '' })}
                  />
                </Field>
              ) : (
                <Alert tone="warning" className="@lg:col-span-12">
                  Ce projet n’est pas un projet client relié à une fiche client : reliez d’abord la
                  fiche dans les Réglages pour inviter un contact.
                </Alert>
              )
            ) : (
              <>
                <Field id={`${id}-fournisseur`} label="Fiche fournisseur" required size="lg" newRow>
                  <ChoixEntite
                    id={`${id}-fournisseur`}
                    type="supplier"
                    organizationId={organizationId}
                    valeur={f.supplierId}
                    onChange={(o) => setF({ ...f, supplierId: o?.id ?? '' })}
                  />
                </Field>
                <Field
                  id={`${id}-referent`}
                  label="Référent interne"
                  required
                  size="md"
                  hint="Il valide les feuilles de temps du consultant."
                >
                  <Select<string>
                    value={f.referentUserId}
                    onChange={(v) => setF({ ...f, referentUserId: v })}
                    options={referents}
                    placeholder="Choisir…"
                  />
                </Field>
                <Field id={`${id}-ouvrir`} label="Accès" group size="full">
                  <Switch
                    checked={f.canOpenProject}
                    onChange={(v) => setF({ ...f, canOpenProject: v })}
                    label="Peut ouvrir le projet"
                    description="Sinon, il ne voit que les tâches dont il est responsable ou collaborateur."
                  />
                </Field>
              </>
            )}
          </FormGrid>
          <div>
            <Button
              type="submit"
              size="sm"
              busy={envoi}
              disabled={
                envoi ||
                !f.email ||
                !f.name ||
                (f.kind === 'client' ? !vue.canInviteClient : !f.supplierId || !f.referentUserId)
              }
            >
              <Mail aria-hidden="true" className="h-4 w-4" />
              Envoyer l’invitation
            </Button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        {vue !== null && actifs.length === 0 ? (
          <li className="px-3 py-3 text-sm text-[var(--foreground-muted)]">
            Aucun membre externe sur ce projet.
          </li>
        ) : null}
        {actifs.map((m) => (
          <li key={m.account.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 break-words">
              <span className="font-medium">{m.account.name}</span>
              <span className="ml-2 text-xs text-[var(--foreground-muted)]">{m.account.email}</span>
              <span className="block text-xs text-[var(--foreground-muted)]">
                {m.account.kind === 'client'
                  ? `Fiche client : ${m.account.customerName ?? '—'}`
                  : `Fournisseur : ${m.account.supplierName ?? '—'} · référent : ${m.account.referent?.name ?? '—'}`}
              </span>
            </span>
            <StatusPill tone="open">{WORK_EXTERNAL_KIND_LABELS[m.account.kind]}</StatusPill>
            {m.account.kind === 'consultant' ? (
              <Switch
                checked={m.canOpenProject}
                disabled={!vue?.canManage || envoi}
                onChange={(v) =>
                  void agir(
                    workExternalApi.setCanOpenProject(projectId, m.account.id, v),
                    'Le réglage n’a pas pu être changé.',
                  )
                }
                label="Peut ouvrir le projet"
              />
            ) : null}
            {vue?.canManage ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                disabled={envoi}
                onClick={() =>
                  void agir(
                    workExternalApi.removeExternal(projectId, m.account.id),
                    'Le membre externe n’a pas pu être retiré.',
                    `${m.account.name} n’a plus accès à ce projet.`,
                  )
                }
              >
                <UserMinus aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                Retirer<span className="sr-only"> {m.account.name}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {fermes.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--foreground-muted)]">
            Accès fermés ({fermes.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {fermes.map((m) => (
              <li key={m.account.id} className="text-xs text-[var(--foreground-muted)]">
                {m.account.name} — {libelleFermeture(m.closedReason)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
