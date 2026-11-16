'use client';

// Panneau de tâche — ADR-0076 : collaborateurs, abonnés (« Suivre / Ne plus suivre »),
// liste de contrôle et validation. Formulaires du kit `@lalanda/ui` (ADR-0074). Les
// gestes sont masqués selon les droits dits par le serveur (`myRights`) ; le serveur
// reste juge de chacun.

import {
  WORK_COLLAB_LIMITS,
  type WorkApprovalDecision,
  type WorkTaskDetail,
  type WorkTaskMyRights,
  type WorkTaskWriteResult,
} from '@lalanda/shared/work';
import {
  Button,
  Checkbox,
  EntityPicker,
  Field,
  StatusPill,
  Switch,
  TextArea,
  TextInput,
  correspondRecherche,
} from '@lalanda/ui';
import { useState } from 'react';

import { workApi } from '@/lib/work-api';

import {
  abonnesProposes,
  ajouterElement,
  basculerElement,
  collaborateurRetirable,
  collaborateursProposes,
  deplacerElement,
  elementsDe,
  libelleValidation,
  motifRequis,
  retirerElement,
  type ElementListe,
  type OptionPersonne,
} from './collab-model';
import { Avatar } from './elements';
import { useProjet } from './project-context';

interface PropsGeste {
  d: WorkTaskDetail;
  droits: WorkTaskMyRights;
  envoi: boolean;
  agir: (geste: () => Promise<void>, repli: string) => Promise<void>;
  apres: (r: WorkTaskWriteResult) => void;
}

function Personne({
  p,
  retirer,
}: {
  p: OptionPersonne;
  retirer: (() => void) | null;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] py-0.5 pr-2 pl-0.5 text-xs">
      <Avatar name={p.name} cle={p.userId} taille={20} />
      <span className="break-words">{p.name}</span>
      {retirer ? (
        <button
          type="button"
          onClick={retirer}
          className="ml-0.5 text-[var(--foreground-muted)] hover:text-[var(--danger)]"
          aria-label={`Retirer ${p.name}`}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/** Collaborateurs et abonnés d'une tâche, et « Suivre / Ne plus suivre » pour soi. */
export function ParticipantsTache({
  d,
  droits,
  envoi,
  agir,
  apres,
  onSuivi,
}: PropsGeste & { onSuivi: () => void }): React.ReactElement {
  const { members, moi, assignerSoiSeulement } = useProjet();
  const regle = { moi, soiSeulement: assignerSoiSeulement };
  const collaborateurs = d.collaborators ?? [];
  const ids = collaborateurs.map((c) => c.userId);
  const proposes = collaborateursProposes(
    members,
    { assigneeUserId: d.assignee?.userId ?? null, collaboratorUserIds: ids },
    regle,
  );
  const abonnes = d.followers;
  const abonnesIds = abonnes.map((a) => a.userId);
  const abonnables = abonnesProposes(members, abonnesIds);
  const suit = d.following ?? (moi !== null && abonnesIds.includes(moi));

  const patch = (corps: { collaboratorUserIds?: string[]; followerUserIds?: string[] }) =>
    void agir(
      async () => apres(await workApi.patchTask(d.id, { expectedRevision: d.revision, ...corps })),
      'Enregistrement impossible.',
    );

  return (
    <section aria-labelledby="participants-titre" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="participants-titre" className="text-sm font-semibold">
          Collaborateurs et abonnés
        </h3>
        <Button
          size="sm"
          disabled={envoi}
          aria-pressed={suit}
          onClick={() =>
            void agir(async () => {
              await (suit ? workApi.unfollowTask(d.id) : workApi.followTask(d.id));
              onSuivi();
            }, 'Abonnement impossible.')
          }
        >
          {suit ? 'Ne plus suivre' : 'Suivre'}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-[var(--foreground-muted)]">
          Les collaborateurs modifient la tâche, commentent et cochent la liste de contrôle ; seul
          le responsable la termine.
        </p>
        {collaborateurs.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucun collaborateur.</p>
        ) : (
          <ul aria-label="Collaborateurs" className="flex flex-wrap gap-1.5">
            {collaborateurs.map((c) => (
              <Personne
                key={c.userId}
                p={c}
                retirer={
                  droits.canEdit && collaborateurRetirable(c.userId, regle)
                    ? () => patch({ collaboratorUserIds: ids.filter((u) => u !== c.userId) })
                    : null
                }
              />
            ))}
          </ul>
        )}
        {droits.canEdit && ids.length < WORK_COLLAB_LIMITS.collaboratorsMax ? (
          <EntityPicker<OptionPersonne>
            id="tache-collab-ajout"
            aria-label="Ajouter un collaborateur"
            value={null}
            onChange={(p) => {
              if (p) patch({ collaboratorUserIds: [...ids, p.userId] });
            }}
            search={async (q) => proposes.filter((p) => correspondRecherche([p.name], q))}
            refreshKey={proposes.length}
            getKey={(p) => p.userId}
            getLabel={(p) => p.name}
            placeholder="Ajouter un collaborateur…"
            debounceMs={0}
            disabled={envoi}
            emptyText="Personne d’autre ne peut collaborer (les Lecteurs ne portent pas de tâche)."
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-[var(--foreground-muted)]">
          Les abonnés sont notifiés des commentaires.
        </p>
        {abonnes.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucun abonné.</p>
        ) : (
          <ul aria-label="Abonnés" className="flex flex-wrap gap-1.5">
            {abonnes.map((a) => (
              <Personne
                key={a.userId}
                p={a}
                retirer={
                  droits.canEdit
                    ? () => patch({ followerUserIds: abonnesIds.filter((u) => u !== a.userId) })
                    : null
                }
              />
            ))}
          </ul>
        )}
        {droits.canEdit && abonnesIds.length < 20 ? (
          <EntityPicker<OptionPersonne>
            id="tache-abonne-ajout"
            aria-label="Ajouter un abonné"
            value={null}
            onChange={(p) => {
              if (p) patch({ followerUserIds: [...abonnesIds, p.userId] });
            }}
            search={async (q) => abonnables.filter((p) => correspondRecherche([p.name], q))}
            refreshKey={abonnables.length}
            getKey={(p) => p.userId}
            getLabel={(p) => p.name}
            placeholder="Ajouter un abonné…"
            debounceMs={0}
            disabled={envoi}
            emptyText="Aucune personne ne correspond."
          />
        ) : null}
      </div>
    </section>
  );
}

/** Liste de contrôle : cocher (responsable, collaborateurs, gestion), composer (qui modifie). */
export function ListeControle({ d, droits, envoi, agir, apres }: PropsGeste): React.ReactElement {
  const items = elementsDe(d.checklist ?? []);
  const [nouveau, setNouveau] = useState('');
  const faits = items.filter((i) => i.done).length;
  const auteurs = new Map((d.checklist ?? []).map((c) => [c.id, c]));

  const enregistrer = (next: ElementListe[], apresOk?: () => void) =>
    void agir(async () => {
      apres(await workApi.putChecklist(d.id, { expectedRevision: d.revision, items: next }));
      apresOk?.();
    }, 'Liste de contrôle non enregistrée.');

  if (items.length === 0 && !droits.canEdit) return <></>;
  return (
    <section aria-labelledby="liste-titre" className="flex flex-col gap-2">
      <h3 id="liste-titre" className="text-sm font-semibold">
        Liste de contrôle {items.length > 0 ? `(${faits}/${items.length})` : ''}
      </h3>
      {items.length > 0 ? (
        <ul className="flex flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((it, k) => {
            const a = it.id ? auteurs.get(it.id) : undefined;
            return (
              <li
                key={it.id ?? `n${k}`}
                className="flex min-h-9 items-center gap-2 border-b border-[var(--border)] px-2 text-sm last:border-b-0"
              >
                <Checkbox
                  checked={it.done}
                  disabled={!droits.canCheck || envoi}
                  onChange={() => enregistrer(basculerElement(items, k))}
                  label={
                    <span className={it.done ? 'text-[var(--foreground-muted)] line-through' : ''}>
                      {it.text}
                    </span>
                  }
                  {...(a?.done && a.doneBy ? { description: `Coché par ${a.doneBy.name}` } : {})}
                />
                {droits.canEdit ? (
                  <span className="ml-auto flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      disabled={envoi || k === 0}
                      aria-label={`Monter « ${it.text} »`}
                      onClick={() => enregistrer(deplacerElement(items, k, -1))}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      disabled={envoi || k === items.length - 1}
                      aria-label={`Descendre « ${it.text} »`}
                      onClick={() => enregistrer(deplacerElement(items, k, 1))}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      disabled={envoi}
                      aria-label={`Retirer « ${it.text} »`}
                      onClick={() => enregistrer(retirerElement(items, k))}
                    >
                      ×
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {droits.canEdit && items.length < WORK_COLLAB_LIMITS.checklistItemsMax ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = ajouterElement(items, nouveau);
            if (next) enregistrer(next, () => setNouveau(''));
          }}
        >
          <label htmlFor="liste-nouveau" className="sr-only">
            Nouvel élément de la liste de contrôle
          </label>
          <TextInput
            id="liste-nouveau"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            placeholder="Ajouter un élément…"
            maxLength={WORK_COLLAB_LIMITS.checklistTextMax}
            className="min-w-0 flex-1"
          />
          <Button type="submit" busy={envoi} disabled={!nouveau.trim()}>
            Ajouter
          </Button>
        </form>
      ) : null}
      {droits.canEdit && items.length >= WORK_COLLAB_LIMITS.checklistItemsMax ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          {WORK_COLLAB_LIMITS.checklistItemsMax} éléments au plus : découpez en sous-tâches.
        </p>
      ) : null}
    </section>
  );
}

const DECISIONS: { value: WorkApprovalDecision; label: string }[] = [
  { value: 'approve', label: 'Approuver' },
  { value: 'request_changes', label: 'Demander des modifications' },
  { value: 'reject', label: 'Refuser' },
];

/** Validation : réglage (gestion), soumission (responsable), décision (validateur). */
export function ValidationTache({ d, droits, envoi, agir, apres }: PropsGeste): React.ReactElement {
  const { members, project } = useProjet();
  const [motif, setMotif] = useState('');
  const [erreurMotif, setErreurMotif] = useState<string | null>(null);
  const a = d.approvalDetail ?? null;
  const libelle = libelleValidation(a);
  if (!a?.required && !droits.canManage) return <></>;

  const validateurs: OptionPersonne[] = members
    .filter((m) => m.canUpdate && m.seesProject !== false && m.projectRole !== 'viewer')
    .map((m) => ({ userId: m.userId, name: m.name }));
  const reglage = (required: boolean, approverUserId: string | null) =>
    void agir(
      async () =>
        apres(
          await workApi.patchTask(d.id, {
            expectedRevision: d.revision,
            approval: { required, approverUserId },
          }),
        ),
      'Réglage de la validation impossible.',
    );
  const decider = (decision: WorkApprovalDecision) => {
    if (motifRequis(decision) && motif.trim() === '') {
      setErreurMotif('Indiquez le motif : il sera transmis au responsable.');
      return;
    }
    setErreurMotif(null);
    void agir(async () => {
      apres(
        await workApi.decideApproval(d.id, {
          expectedRevision: d.revision,
          decision,
          ...(motifRequis(decision) ? { reason: motif.trim() } : {}),
        }),
      );
      setMotif('');
    }, 'Décision impossible.');
  };
  const parDefaut = project?.owner?.name ?? project?.deputy?.name ?? null;

  return (
    <section
      aria-labelledby="validation-titre"
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="validation-titre" className="text-sm font-semibold">
          Validation
        </h3>
        {libelle ? (
          <StatusPill
            tone={
              a?.state === 'approved'
                ? 'ok'
                : a?.state === 'pending'
                  ? 'wait'
                  : a?.state === 'rejected' || a?.state === 'changes_requested'
                    ? 'late'
                    : 'draft'
            }
          >
            {libelle}
          </StatusPill>
        ) : null}
      </div>

      {droits.canManage ? (
        <div className="flex flex-col gap-2">
          <Switch
            checked={a?.required === true}
            disabled={envoi}
            onChange={(v) => reglage(v, a?.approverUserId ?? null)}
            label="À valider : la tâche n’est terminée qu’après approbation"
          />
          {a?.required ? (
            <Field
              id="validation-validateur"
              label="Validateur"
              optional
              size="full"
              hint={
                parDefaut
                  ? `Sans choix : ${parDefaut} (chef de projet, à défaut l’adjoint).`
                  : 'Ce projet n’a ni chef ni adjoint : désignez le validateur.'
              }
            >
              <EntityPicker<OptionPersonne>
                value={a.approver ?? null}
                onChange={(p) => reglage(true, p?.userId ?? null)}
                search={async (q) => validateurs.filter((p) => correspondRecherche([p.name], q))}
                refreshKey={validateurs.length}
                getKey={(p) => p.userId}
                getLabel={(p) => p.name}
                placeholder="Chef de projet (par défaut)"
                debounceMs={0}
                disabled={envoi}
                emptyText="Aucune personne ne correspond."
              />
            </Field>
          ) : null}
        </div>
      ) : a?.required ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Validateur : {a.approver?.name ?? a.pendingApprover?.name ?? 'chef de projet'}
        </p>
      ) : null}

      {a?.required && a.state === 'pending' && a.pendingApprover ? (
        <p className="text-sm">
          Soumise par {a.submittedBy?.name ?? '—'} ; en attente de {a.pendingApprover.name}.
        </p>
      ) : null}
      {a?.reason && (a.state === 'changes_requested' || a.state === 'rejected') ? (
        <p className="rounded-[var(--radius-sm)] bg-[var(--surface-muted)] p-2 text-sm">
          <span className="font-medium">Motif ({a.decidedBy?.name ?? 'validateur'}) : </span>
          {a.reason}
        </p>
      ) : null}

      {droits.canSubmit ? (
        <Button
          variant="primary"
          size="sm"
          busy={envoi}
          className="self-start"
          onClick={() =>
            void agir(
              async () => apres(await workApi.submitApproval(d.id, d.revision)),
              'Soumission impossible.',
            )
          }
        >
          Soumettre à validation
        </Button>
      ) : null}

      {droits.canDecide ? (
        <div className="flex flex-col gap-2">
          <Field
            id="validation-motif"
            label="Motif"
            size="full"
            hint="Obligatoire pour demander des modifications ou refuser."
            {...(erreurMotif ? { error: erreurMotif } : {})}
          >
            <TextArea
              rows={2}
              maxLength={WORK_COLLAB_LIMITS.approvalReasonMax}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {DECISIONS.map((o) => (
              <Button
                key={o.value}
                size="sm"
                variant={
                  o.value === 'approve' ? 'primary' : o.value === 'reject' ? 'danger' : 'secondary'
                }
                disabled={envoi}
                onClick={() => decider(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
