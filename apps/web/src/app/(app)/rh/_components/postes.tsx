'use client';

// Référentiel des postes (ADR-0068 § 3) : numéro de poste (`POS-001`, jamais
// réutilisé), intitulé, service, statut (vacant, pourvu, supprimé), titulaire et
// historique. Un poste se pourvoit depuis la fiche d'un collaborateur (« Nouveau
// poste » ou « Remplacement poste pour poste ») ; la sortie du titulaire le rend
// vacant. Seul un poste vacant se supprime. L'API reste juge.
//
// ADR-0074 : filtre de statut en segments ; service en `EntityPicker` avec
// « + » (fiche service complète en fenêtre, sous `hr.manage`).

import {
  Badge,
  Button,
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  SegmentedControl,
  SubmitButton,
  TextInput,
  buttonClasses,
  correspondRecherche,
} from '@lalanda/ui';
import { Briefcase, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import type { HrDepartmentView } from '@/lib/api-hr';
import { hrLot1Api, type PositionDetailView, type PositionView } from '@/lib/api-hr-lot1';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { LIBELLES_STATUT_POSTE } from './lot1-model';
import { useReferentielsRh } from './referentiels';
import { useAccesRh } from './rh-access';
import {
  formatJour,
  lienCollaborateur,
  lire,
  messageRh,
  peutGererRh,
  peutLireRh,
  type Lecture,
} from './rh-model';
import { Bandeau, Chargement, EchecLecture, PhraseSection } from './rh-ui';
import { FormulaireService } from './services';

type Filtre = 'current' | 'open' | 'filled' | 'deleted';

const FILTRES: [Filtre, string][] = [
  ['current', 'En cours'],
  ['open', 'Vacants'],
  ['filled', 'Pourvus'],
  ['deleted', 'Supprimés'],
];

const TON: Record<PositionView['status'], 'warning' | 'success' | 'neutral'> = {
  open: 'warning',
  filled: 'success',
  deleted: 'neutral',
};

export function Postes(): React.ReactElement {
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions);
  const [filtre, setFiltre] = useState<Filtre>('current');
  const [lecture, setLecture] = useState<Lecture<PositionView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const [edition, setEdition] = useState<PositionView | 'nouveau' | null>(null);
  const [detail, setDetail] = useState<PositionDetailView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!peutLireRh(actions)) return;
    let annule = false;
    void lire(hrLot1Api.listPositions(filtre).then((r) => r.items)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [filtre, version, actions]);

  const ouvrir = useCallback((p: PositionView) => {
    setErreur(null);
    hrLot1Api
      .getPosition(p.id)
      .then(setDetail)
      .catch((err: unknown) => setErreur(messageRh(err, 'Poste illisible.')));
  }, []);

  if (!peutLireRh(actions)) {
    return (
      <PhraseSection>
        Le référentiel des postes est réservé aux rôles qui tiennent les dossiers du personnel.
      </PhraseSection>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Briefcase}
        titre="Postes"
        sousTitre="Chaque poste garde son numéro : un remplacement poste pour poste reprend le même numéro, la personne reçoit un nouveau matricule. La sortie du titulaire rend le poste vacant."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setEdition('nouveau')}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouveau poste vacant
            </button>
          ) : null
        }
      >
        <SegmentedControl<Filtre>
          aria-label="Statut"
          value={filtre}
          onChange={setFiltre}
          options={FILTRES.map(([v, l]) => ({ value: v, label: l }))}
        />
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {lecture === null ? (
        <Chargement texte="Chargement des postes…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Impossible de charger les postes."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : lecture.valeur.length === 0 ? (
        <PhraseSection>
          Aucun poste ici. Un poste se crée aussi depuis la fiche d’un collaborateur (« Nouveau
          poste »).
        </PhraseSection>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)]">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--foreground-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">N° de poste</th>
                <th className="px-3 py-2 font-medium">Intitulé</th>
                <th className="px-3 py-2 font-medium">Service</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Titulaire</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {lecture.valeur.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{p.positionNumber}</td>
                  <td className="px-3 py-2 break-words">{p.title}</td>
                  <td className="px-3 py-2">{p.departmentName ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={TON[p.status]}>{LIBELLES_STATUT_POSTE[p.status]}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {p.holderEmployeeId ? (
                      <Link className="underline" href={lienCollaborateur(p.holderEmployeeId)}>
                        {p.holderName ?? 'Collaborateur'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      aria-haspopup="dialog"
                      onClick={() => ouvrir(p)}
                    >
                      Historique<span className="sr-only"> {p.positionNumber}</span>
                    </button>
                    {gerer && p.status !== 'deleted' ? (
                      <button
                        type="button"
                        className={`${BOUTON_PETIT} ml-1`}
                        aria-haspopup="dialog"
                        onClick={() => setEdition(p)}
                      >
                        Modifier<span className="sr-only"> {p.positionNumber}</span>
                      </button>
                    ) : null}
                    {gerer && p.status === 'open' ? (
                      <button
                        type="button"
                        className={`${BOUTON_DANGER} ml-1`}
                        onClick={() => {
                          setErreur(null);
                          hrLot1Api
                            .deletePosition(p.id, p.revision)
                            .then(() => setVersion((v) => v + 1))
                            .catch((err: unknown) =>
                              setErreur(messageRh(err, 'Le poste n’a pas pu être supprimé.')),
                            );
                        }}
                      >
                        Supprimer<span className="sr-only"> {p.positionNumber}</span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={gerer && edition !== null}
        onClose={() => setEdition(null)}
        title={edition === 'nouveau' ? 'Nouveau poste vacant' : 'Modifier le poste'}
        description={
          edition === 'nouveau'
            ? 'Le numéro de poste est attribué à l’enregistrement et ne sera jamais réutilisé.'
            : undefined
        }
        size="sm"
      >
        {edition !== null ? (
          <FormulairePoste
            poste={edition === 'nouveau' ? null : edition}
            onAnnuler={() => setEdition(null)}
            onEnregistre={() => {
              setEdition(null);
              setVersion((v) => v + 1);
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.positionNumber} — ${detail.title}` : 'Poste'}
        size="md"
      >
        {detail ? (
          detail.holders.length === 0 ? (
            <PhraseSection>Ce poste n’a encore eu aucun titulaire.</PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {detail.holders.map((h) => (
                <li
                  key={`${h.employeeId}-${h.from}`}
                  className="flex flex-wrap justify-between gap-2 py-2"
                >
                  <Link className="underline" href={lienCollaborateur(h.employeeId)}>
                    {h.displayName}
                    {h.employeeNumber ? ` (${h.employeeNumber})` : ''}
                  </Link>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    depuis le {formatJour(h.from)}
                    {h.to ? ` jusqu’au ${formatJour(h.to)}` : ' — en poste'}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Modal>
    </section>
  );
}

function FormulairePoste({
  poste,
  onAnnuler,
  onEnregistre,
}: {
  poste: PositionView | null;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const id = useId();
  const { actions } = useAccesRh();
  const gererServices = peutGererRh(actions);
  // Les collaborateurs ne servent qu'à la création rapide d'un service (responsable).
  const { services, employes } = useReferentielsRh(gererServices);
  const [servicesAjoutes, setServicesAjoutes] = useState<HrDepartmentView[]>([]);
  const tousServices = [
    ...services,
    ...servicesAjoutes.filter((a) => !services.some((s) => s.id === a.id)),
  ];
  const [titre, setTitre] = useState(poste?.title ?? '');
  const [service, setService] = useState(poste?.departmentId ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    if (titre.trim() === '') {
      setErreur('L’intitulé est obligatoire.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const departmentId = service === '' ? null : service;
      if (poste) {
        await hrLot1Api.updatePosition(poste.id, {
          expectedRevision: poste.revision,
          title: titre.trim(),
          departmentId,
        });
      } else {
        await hrLot1Api.createPosition({ title: titre.trim(), departmentId });
      }
      onEnregistre();
    } catch (err) {
      setErreur(messageRh(err, 'Le poste n’a pas pu être enregistré.'));
    } finally {
      setEnvoi(false);
    }
  }

  const serviceChoisi = tousServices.find((s) => s.id === service) ?? null;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <FormGrid>
        <Field id={`${id}-titre`} label="Intitulé" required size="lg">
          <TextInput value={titre} onChange={(e) => setTitre(e.target.value)} />
        </Field>
        <Field
          id={`${id}-service`}
          label="Service"
          size="lg"
          newRow
          hint={
            gererServices
              ? 'Tapez pour chercher. Service absent : « + » le crée sans quitter le poste.'
              : 'Tapez pour chercher. Vide : aucun service.'
          }
        >
          <EntityPicker<HrDepartmentView>
            value={serviceChoisi}
            onChange={(s) => setService(s?.id ?? '')}
            search={async (q) =>
              tousServices
                .filter((s) => correspondRecherche([s.name], q))
                .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            }
            refreshKey={tousServices.length}
            getKey={(s) => s.id}
            getLabel={(s) => s.name}
            getDescription={(s) => tousServices.find((p) => p.id === s.parentId)?.name ?? null}
            placeholder="Aucun service"
            debounceMs={0}
            emptyText="Aucun service ne correspond."
            createTitle="Nouveau service"
            createButtonLabel="Créer un service"
            {...(gererServices
              ? {
                  createForm: ({ initialText, onCreated, onCancel }) => (
                    <FormulaireService
                      service={null}
                      services={tousServices}
                      employes={employes}
                      nomInitial={initialText}
                      onEnregistre={(cree) => {
                        setServicesAjoutes((l) => [...l, cree]);
                        onCreated(cree);
                      }}
                      onAnnuler={onCancel}
                    />
                  ),
                }
              : {})}
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button size="sm" onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton size="sm" busy={envoi} busyLabel="Enregistrement…" className="max-sm:h-11">
          Enregistrer
        </SubmitButton>
      </div>
    </form>
  );
}
