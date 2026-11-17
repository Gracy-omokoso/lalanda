'use client';

// Comptes externes de l'organisation — ADR-0078 (gestion, `work.manage`).
//
//   - comptes (contact client, consultant) : fiche, référent, projets ouverts, fermeture ;
//   - consultant : taux d'achat datés (`purchase.manage` pour poser, `purchase.read` pour
//     lire) et récapitulatif temps × taux exportable (CSV) ;
//   - conversion MANUELLE d'un Invité externe en contact client ou consultant (le rôle
//     « Invité externe » reste disponible ; la conversion ne retire pas l'appartenance à
//     l'organisation, geste de l'écran Membres).

import {
  WORK_EXTERNAL_KIND_LABELS,
  WORK_RATE_CURRENCIES,
  type WorkExternalAccountView,
  type WorkExternalKind,
  type WorkMemberRateView,
} from '@lalanda/shared/work';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  SegmentedControl,
  Select,
  StatusPill,
  Switch,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { useCallback, useEffect, useId, useState } from 'react';

import { ChoixEntite } from '@/components/choix-entite';
import { api, type MemberView } from '@/lib/api';
import { libelleFermeture, messageExterne } from '@/lib/externes-model';
import { workApi, type WorkMemberOption } from '@/lib/work-api';
import { workExternalApi } from '@/lib/work-external-api';

import { useShell } from '../../_components/shell-context';
import { codeWork, messageWork } from './projets-model';

function message(err: unknown, repli: string): string {
  return messageExterne(codeWork(err)) ?? messageWork(err, repli);
}

function TauxConsultant({
  compte,
  peutPoser,
}: {
  compte: WorkExternalAccountView;
  peutPoser: boolean;
}): React.ReactElement {
  const id = useId();
  const [taux, setTaux] = useState<WorkMemberRateView[] | null>(null);
  const [devise, setDevise] = useState<'USD' | 'CDF'>('USD');
  const [montant, setMontant] = useState('');
  const [depuis, setDepuis] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    workExternalApi
      .listRates(compte.id)
      .then((r) => setTaux(r.items))
      .catch(() => setTaux(null));
  }, [compte.id, version]);

  async function poser(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    try {
      await workExternalApi.setRate(compte.id, {
        currency: devise,
        hourlyRate: montant.trim().replace(',', '.'),
        effectiveFrom: depuis,
      });
      setMontant('');
      setVersion((v) => v + 1);
    } catch (err) {
      setErreur(message(err, 'Le taux n’a pas pu être posé.'));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <p className="text-xs font-semibold">Taux d’achat horaire (HT)</p>
      {taux === null ? (
        <p className="text-xs text-[var(--foreground-muted)]">Taux non visibles avec vos droits.</p>
      ) : taux.length === 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Aucun taux : le temps du consultant n’est pas encore valorisé.
        </p>
      ) : (
        <ul className="text-xs">
          {taux.map((t) => (
            <li key={t.id}>
              {t.hourlyCost} {t.currency} / h depuis le {t.effectiveFrom}
            </li>
          ))}
        </ul>
      )}
      {peutPoser ? (
        <form noValidate onSubmit={(e) => void poser(e)} className="flex flex-col gap-2">
          <FormGrid>
            <Field id={`${id}-devise`} label="Devise" size="xs">
              <Select<'USD' | 'CDF'>
                value={devise}
                onChange={setDevise}
                options={WORK_RATE_CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field id={`${id}-montant`} label="Taux horaire" size="sm" required>
              <TextInput
                inputMode="decimal"
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
              />
            </Field>
            <Field id={`${id}-depuis`} label="À partir du" size="sm" required>
              <DatePicker value={depuis} onChange={setDepuis} />
            </Field>
          </FormGrid>
          {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!montant || !depuis}>
              Poser le taux
            </Button>
            <a
              href={workExternalApi.recapCsvUrl(compte.id)}
              className={buttonClasses('secondary', 'sm')}
            >
              Récapitulatif temps × taux (CSV)
            </a>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ConversionInvite({
  invite,
  membres,
  onFermer,
  onFait,
}: {
  invite: MemberView;
  membres: WorkMemberOption[];
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const { organizationId } = useShell();
  const [kind, setKind] = useState<WorkExternalKind>('client');
  const [projets, setProjets] = useState<
    { projectId: string; name: string; kind: string; customerId: string | null }[]
  >([]);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [referent, setReferent] = useState('');
  const [ouvrir, setOuvrir] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    workExternalApi
      .guestProjects(invite.userId)
      .then((r) => setProjets(r.items))
      .catch((err: unknown) => setErreur(message(err, 'Projets de l’invité illisibles.')));
  }, [invite.userId]);

  async function convertir(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await workExternalApi.convertGuest(
        invite.userId,
        kind === 'client'
          ? { kind, projectIds: choisis, customerId }
          : {
              kind,
              projectIds: choisis,
              supplierId,
              referentUserId: referent,
              canOpenProject: ouvrir,
            },
      );
      onFait();
    } catch (err) {
      setErreur(message(err, 'La conversion n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  }

  const visibles = kind === 'client' ? projets.filter((p) => p.kind === 'client') : projets;
  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title={`Convertir ${invite.name ?? invite.email ?? 'l’invité'}`}
      description="L’invité devient membre externe des projets choisis et en est retiré comme membre interne. Son appartenance à l’organisation n’est pas touchée : retirez-la ensuite dans Membres si besoin."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFermer} disabled={envoi}>
            Annuler
          </Button>
          <Button
            busy={envoi}
            disabled={
              envoi ||
              choisis.length === 0 ||
              (kind === 'client' ? !customerId : !supplierId || !referent)
            }
            onClick={() => void convertir()}
          >
            Convertir
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <FormGrid>
          <Field id={`${id}-genre`} label="Devient" group size="full">
            <SegmentedControl<WorkExternalKind>
              value={kind}
              onChange={(k) => {
                setKind(k);
                setChoisis([]);
              }}
              options={[
                { value: 'client', label: WORK_EXTERNAL_KIND_LABELS.client },
                { value: 'consultant', label: WORK_EXTERNAL_KIND_LABELS.consultant },
              ]}
            />
          </Field>
          {kind === 'client' ? (
            <Field id={`${id}-client`} label="Fiche client" required size="lg" newRow>
              <ChoixEntite
                id={`${id}-client`}
                type="customer"
                organizationId={organizationId}
                valeur={customerId}
                onChange={(o) => setCustomerId(o?.id ?? '')}
              />
            </Field>
          ) : (
            <>
              <Field id={`${id}-fournisseur`} label="Fiche fournisseur" required size="lg" newRow>
                <ChoixEntite
                  id={`${id}-fournisseur`}
                  type="supplier"
                  organizationId={organizationId}
                  valeur={supplierId}
                  onChange={(o) => setSupplierId(o?.id ?? '')}
                />
              </Field>
              <Field id={`${id}-referent`} label="Référent interne" required size="md">
                <Select<string>
                  value={referent}
                  onChange={setReferent}
                  placeholder="Choisir…"
                  options={membres
                    .filter((m) => m.canUpdate && m.canLead !== false)
                    .map((m) => ({ value: m.userId, label: m.name }))}
                />
              </Field>
              <Field id={`${id}-ouvrir`} label="Accès" group size="full">
                <Switch checked={ouvrir} onChange={setOuvrir} label="Peut ouvrir les projets" />
              </Field>
            </>
          )}
        </FormGrid>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Projets</legend>
          {visibles.length === 0 ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              {kind === 'client'
                ? 'L’invité n’est membre d’aucun projet client.'
                : 'L’invité n’est membre d’aucun projet.'}
            </p>
          ) : null}
          {visibles.map((p) => (
            <Checkbox
              key={p.projectId}
              checked={choisis.includes(p.projectId)}
              onChange={(coche) =>
                setChoisis((c) =>
                  coche ? [...c, p.projectId] : c.filter((x) => x !== p.projectId),
                )
              }
              label={p.name}
            />
          ))}
        </fieldset>
        {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      </div>
    </Modal>
  );
}

export function ComptesExternes(): React.ReactElement {
  const { organizationId, actions } = useShell();
  const [comptes, setComptes] = useState<WorkExternalAccountView[] | null>(null);
  const [invites, setInvites] = useState<MemberView[]>([]);
  const [membres, setMembres] = useState<WorkMemberOption[]>([]);
  const [conversion, setConversion] = useState<MemberView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  const peutPoser = actions?.includes('purchase.manage') ?? false;

  useEffect(() => {
    workExternalApi
      .listAccounts()
      .then((r) => setComptes(r.items))
      .catch((err: unknown) => setErreur(message(err, 'Les comptes externes sont illisibles.')));
    workApi
      .listMembers()
      .then(setMembres)
      .catch(() => setMembres([]));
    if (organizationId) {
      api
        .listMembers(organizationId)
        .then((r) => setInvites(r.members.filter((m) => m.role === 'guest')))
        .catch(() => setInvites([]));
    }
  }, [organizationId, version]);

  async function debloquer(c: WorkExternalAccountView): Promise<void> {
    try {
      await workExternalApi.unlockAccount(c.id);
      recharger();
    } catch (err) {
      setErreur(message(err, 'Le compte n’a pas pu être débloqué.'));
    }
  }

  async function fermer(c: WorkExternalAccountView): Promise<void> {
    if (!window.confirm(`Fermer l’accès de ${c.name} à tous ses projets ?`)) return;
    try {
      await workExternalApi.closeAccount(c.id);
      recharger();
    } catch (err) {
      setErreur(message(err, 'Le compte n’a pas pu être fermé.'));
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Membres externes</h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          Contacts clients et consultants de l’organisation. Ils se connectent à l’espace externe
          avec un code reçu par e-mail à chaque connexion ; l’accès se ferme seul à l’archivage du
          projet, au retrait du membre ou à l’archivage de la fiche client ou fournisseur.
        </p>
      </div>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      <ul className="flex flex-col gap-3">
        {comptes !== null && comptes.length === 0 ? (
          <li className="text-sm text-[var(--foreground-muted)]">
            Aucun compte externe. Invitez un contact ou un consultant depuis les Membres d’un
            projet.
          </li>
        ) : null}
        {(comptes ?? []).map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-[var(--foreground-muted)]">{c.email}</span>
              <StatusPill tone="open">{WORK_EXTERNAL_KIND_LABELS[c.kind]}</StatusPill>
              <StatusPill tone={c.status === 'active' ? 'ok' : 'draft'}>
                {c.status === 'active'
                  ? `${c.projectCount} projet${c.projectCount > 1 ? 's' : ''} ouvert${c.projectCount > 1 ? 's' : ''}`
                  : libelleFermeture(c.closedReason)}
              </StatusPill>
              {c.pausedUntil ? (
                <StatusPill tone="late">
                  {`Connexion en pause jusqu’à ${new Date(c.pausedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                </StatusPill>
              ) : null}
              {c.status === 'active' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void debloquer(c)}
                  title="Lève la pause et remet à zéro les compteurs du jour (codes faux, demandes)."
                >
                  Débloquer la connexion
                </Button>
              ) : null}
              {c.status === 'active' ? (
                <Button size="sm" variant="secondary" onClick={() => void fermer(c)}>
                  Fermer l’accès
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-[var(--foreground-muted)]">
              {c.kind === 'client'
                ? `Fiche client : ${c.customerName ?? '—'}`
                : `Fournisseur : ${c.supplierName ?? '—'} · référent : ${c.referent?.name ?? '—'}`}
              {c.lastLoginAt
                ? ` · dernière connexion le ${new Date(c.lastLoginAt).toLocaleString('fr-FR')}`
                : ' · jamais connecté'}
            </p>
            {c.kind === 'consultant' ? <TauxConsultant compte={c} peutPoser={peutPoser} /> : null}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Invités externes à convertir</h2>
        <p className="text-xs text-[var(--foreground-muted)]">
          Conversion manuelle, au cas par cas : le rôle « Invité externe » reste utilisable.
        </p>
        {invites.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucun Invité externe.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
            {invites.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>
                  {m.name ?? m.email}
                  <span className="ml-2 text-xs text-[var(--foreground-muted)]">{m.email}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setConversion(m)}>
                  Convertir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {conversion ? (
        <ConversionInvite
          invite={conversion}
          membres={membres}
          onFermer={() => setConversion(null)}
          onFait={() => {
            setConversion(null);
            recharger();
          }}
        />
      ) : null}
    </section>
  );
}
