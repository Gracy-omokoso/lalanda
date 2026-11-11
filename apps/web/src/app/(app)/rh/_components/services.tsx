'use client';

// Services — ADR-0045 § 2.3 : arbre des services actifs (rattachements),
// création et modification en fenêtre modale, archivage confirmé (`hr.manage`).
// L'API refuse un cycle, une profondeur de plus de huit niveaux et l'archivage
// d'un service encore occupé ; l'écran traduit ses refus.
//
// ADR-0074 : service parent et responsable en `EntityPicker` (sans « + » : la
// fenêtre est déjà celle de création d'un service), grille sémantique.

import {
  Button,
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  SubmitButton,
  TextInput,
  buttonClasses,
  correspondRecherche,
} from '@lalanda/ui';
import { Building2, Network, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { hrApi, type HrDepartmentView, type HrEmployeeListItem } from '@/lib/api-hr';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { useAccesRh } from './rh-access';
import {
  RH_BASE,
  lire,
  messageRh,
  nomAffiche,
  peutGererRh,
  peutLireRh,
  type Lecture,
} from './rh-model';
import { Bandeau, Chargement, DialogueDecision, EchecLecture, PhraseSection } from './rh-ui';
import {
  arbreServices,
  formService,
  parentsPossibles,
  validerService,
  type FormService,
} from './services-model';

/** Exporté pour la création rapide depuis la fiche collaborateur (ADR-0074 § 4). */
export function FormulaireService({
  service,
  services,
  employes,
  onEnregistre,
  onAnnuler,
  nomInitial = '',
}: {
  service: HrDepartmentView | null;
  services: HrDepartmentView[];
  employes: HrEmployeeListItem[];
  /** Reçoit le service écrit par l'API. */
  onEnregistre: (ecrit: HrDepartmentView) => void;
  onAnnuler: () => void;
  /** Création : nom repris du texte tapé dans le sélecteur. */
  nomInitial?: string;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormService>(() =>
    service ? formService(service) : { ...formService(null), name: nomInitial },
  );
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const r = validerService(f);
    if (!r.ok) {
      setChamp(r.erreur);
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      const ecrit = service
        ? await hrApi.updateDepartment(service.id, {
            ...r.corps,
            expectedRevision: service.revision,
          })
        : await hrApi.createDepartment(r.corps);
      onEnregistre(ecrit);
    } catch (err) {
      setErreur(messageRh(err, 'Le service n’a pas pu être enregistré.'));
    } finally {
      setEnvoi(false);
    }
  }

  const parents = parentsPossibles(services, service?.id ?? null);
  const parentChoisi = parents.find((s) => s.id === f.parentId) ?? null;
  const responsables = employes.map((e) => ({ id: e.id, nom: nomAffiche(e) }));
  const responsableChoisi = responsables.find((e) => e.id === f.headEmployeeId) ?? null;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <FormGrid>
        <Field id={`${id}-nom`} label="Nom du service" required size="lg" error={champ}>
          <TextInput
            value={f.name}
            autoFocus={service === null}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-parent`}
          label="Rattaché à"
          size="lg"
          newRow
          hint="Tapez pour chercher. Vide : service de premier niveau."
        >
          <EntityPicker<HrDepartmentView>
            value={parentChoisi}
            onChange={(s) => setF({ ...f, parentId: s?.id ?? '' })}
            search={async (q) =>
              parents
                .filter((s) => correspondRecherche([s.name], q))
                .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            }
            refreshKey={parents.length}
            getKey={(s) => s.id}
            getLabel={(s) => s.name}
            getDescription={(s) => services.find((p) => p.id === s.parentId)?.name ?? null}
            placeholder="Aucun (premier niveau)"
            debounceMs={0}
            emptyText="Aucun service ne correspond."
          />
        </Field>
        <Field
          id={`${id}-resp`}
          label="Responsable affiché"
          size="lg"
          newRow
          hint="Affiché sur l’organigramme. Il ne devient pas le manager des membres du service : la ligne hiérarchique se règle sur chaque fiche."
        >
          <EntityPicker<{ id: string; nom: string }>
            value={responsableChoisi}
            onChange={(e) => setF({ ...f, headEmployeeId: e?.id ?? '' })}
            search={async (q) => responsables.filter((e) => correspondRecherche([e.nom], q))}
            refreshKey={responsables.length}
            getKey={(e) => e.id}
            getLabel={(e) => e.nom}
            placeholder="Aucun"
            debounceMs={0}
            emptyText="Aucun collaborateur actif ne correspond."
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button size="sm" onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton size="sm" busy={envoi} busyLabel="Enregistrement…" className="max-sm:h-11">
          {service ? 'Enregistrer' : 'Créer le service'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function Services(): React.ReactElement {
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions);
  const [lecture, setLecture] = useState<Lecture<{ items: HrDepartmentView[] }> | null>(null);
  const [employes, setEmployes] = useState<HrEmployeeListItem[]>([]);
  const [edition, setEdition] = useState<HrDepartmentView | 'nouveau' | null>(null);
  const [archive, setArchive] = useState<HrDepartmentView | null>(null);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!peutLireRh(actions)) return;
    let annule = false;
    void lire(hrApi.listDepartments()).then((l) => {
      if (!annule) setLecture(l);
    });
    hrApi
      .listEmployees({ status: 'active', limit: 100 })
      .then((p) => {
        if (!annule) setEmployes(p.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [actions, version]);

  if (!peutLireRh(actions)) {
    return (
      <PhraseSection>
        Les services se consultent avec le droit de lire les dossiers du personnel. L’organigramme
        reste ouvert.
      </PhraseSection>
    );
  }

  const actifs = lecture?.ok ? lecture.valeur.items.filter((s) => s.active) : [];

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Building2}
        titre="Services"
        sousTitre="L’organisation en services et sous-services, huit niveaux au plus."
        actions={
          <>
            <Link href={`${RH_BASE}/organigramme`} className={BOUTON_PETIT}>
              <Network aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
              Organigramme
            </Link>
            {gerer ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                aria-haspopup="dialog"
                onClick={() => setEdition('nouveau')}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Nouveau service
              </button>
            ) : null}
          </>
        }
      />

      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les services sont illisibles."
          onReessayer={recharger}
        />
      ) : actifs.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucun service n’est encore créé.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {arbreServices(actifs).map(({ service: s, niveau }) => (
            <li
              key={s.id}
              style={{ marginInlineStart: `${Math.min(niveau, 7) * 1.25}rem` }}
              className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium break-words">
                  {niveau > 0 ? (
                    <span className="sr-only">Sous-service de niveau {niveau + 1} : </span>
                  ) : null}
                  {s.name}
                </span>
                {s.headName ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Responsable : {s.headName}
                  </span>
                ) : null}
              </span>
              {gerer ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    aria-label={`Modifier ${s.name}`}
                    onClick={() => setEdition(s)}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    aria-haspopup="dialog"
                    aria-label={`Archiver ${s.name}`}
                    onClick={() => setArchive(s)}
                  >
                    Archiver
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={gerer && edition !== null}
        onClose={() => setEdition(null)}
        title={edition === 'nouveau' ? 'Nouveau service' : 'Modifier le service'}
        size="md"
      >
        <FormulaireService
          service={edition === 'nouveau' || edition === null ? null : edition}
          services={actifs}
          employes={employes}
          onAnnuler={() => setEdition(null)}
          onEnregistre={() => {
            setEdition(null);
            recharger();
          }}
        />
      </Modal>

      {archive ? (
        <DialogueDecision
          titre={`Archiver « ${archive.name} » ?`}
          description="Un service n’est archivable que s’il n’a plus ni collaborateur actif ni sous-service actif."
          libelle=""
          bouton="Archiver"
          commentaire="aucun"
          onFermer={() => setArchive(null)}
          onValider={async () => {
            await hrApi.archiveDepartment(archive.id, archive.revision);
            setArchive(null);
            recharger();
          }}
        />
      ) : null}
    </section>
  );
}
