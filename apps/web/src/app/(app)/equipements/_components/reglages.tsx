'use client';

// Catégories et réglages des équipements — ADR-0046 § 3.5 : catégories proposées
// à l'activation, modifiables, SANS durée ; délais de rappel ; affichage de
// l'estimation de gestion. Lecture `assets.read`, écriture `assets.manage`.

import {
  Badge,
  Field,
  FormGrid,
  Modal,
  SubmitButton,
  Switch,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Settings, Tags } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { assetsApi, type AssetCategoryView, type AssetSettingsView } from '@/lib/api-assets';

import { useShell } from '../../_components/shell-context';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { formulaireReglages, preparerReglages, type FormulaireReglages } from './echeances-model';
import { lire, messageEquipements, peutGererEquipements, type Lecture } from './equipements-model';
import {
  Bandeau,
  ChampNombre,
  Chargement,
  EchecLecture,
  Panneau,
  PhraseSection,
  useCategories,
} from './equipements-ui';
import { ETIQUETTE_ESTIMATION } from './fiche-model';

export function Reglages(): React.ReactElement {
  const { actions } = useShell();
  const gerer = peutGererEquipements(actions);
  const [versionCat, setVersionCat] = useState(0);
  const categories = useCategories(versionCat);
  const [edition, setEdition] = useState<AssetCategoryView | 'nouvelle' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function basculer(c: AssetCategoryView): Promise<void> {
    setErreur(null);
    try {
      await assetsApi.updateCategory(c.id, { expectedRevision: c.revision, active: !c.active });
      setVersionCat((v) => v + 1);
    } catch (err) {
      setErreur(messageEquipements(err, 'Modification impossible.'));
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Settings}
        titre="Catégories et réglages"
        sousTitre="Les catégories rangent le registre ; elles ne portent aucune durée d’amortissement."
      />
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panneau
          titre="Catégories"
          icone={Tags}
          id="eq-categories"
          action={
            gerer ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                aria-haspopup="dialog"
                onClick={() => setEdition('nouvelle')}
              >
                Nouvelle catégorie
              </button>
            ) : null
          }
        >
          {categories === null ? (
            <Chargement />
          ) : !categories.ok ? (
            <EchecLecture erreur={categories.erreur} repli="Les catégories sont illisibles." />
          ) : categories.valeur.length === 0 ? (
            <PhraseSection>Aucune catégorie.</PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {categories.valeur.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 break-words font-medium">{c.name}</span>
                  {!c.active ? <Badge tone="neutral">Désactivée</Badge> : null}
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {c.assetCount} équipement{c.assetCount > 1 ? 's' : ''}
                  </span>
                  {gerer ? (
                    <>
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        aria-haspopup="dialog"
                        onClick={() => setEdition(c)}
                      >
                        Renommer<span className="sr-only"> {c.name}</span>
                      </button>
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() => void basculer(c)}
                      >
                        {c.active ? 'Désactiver' : 'Réactiver'}
                        <span className="sr-only"> {c.name}</span>
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panneau>
        <PanneauReglages gerer={gerer} />
      </div>
      {edition !== null ? (
        <DialogueCategorie
          categorie={edition === 'nouvelle' ? null : edition}
          onFermer={() => setEdition(null)}
          onFait={() => {
            setEdition(null);
            setVersionCat((v) => v + 1);
          }}
        />
      ) : null}
    </section>
  );
}

function DialogueCategorie({
  categorie,
  onFermer,
  onFait,
}: {
  categorie: AssetCategoryView | null;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [nom, setNom] = useState(categorie?.name ?? '');
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (nom.trim() === '') {
      setChamp('Le nom est obligatoire.');
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      if (categorie === null) await assetsApi.createCategory(nom.trim());
      else
        await assetsApi.updateCategory(categorie.id, {
          expectedRevision: categorie.revision,
          name: nom.trim(),
        });
      onFait();
    } catch (err) {
      setErreur(messageEquipements(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title={categorie ? 'Renommer la catégorie' : 'Nouvelle catégorie'}
      size="sm"
    >
      <form noValidate onSubmit={(e) => void valider(e)} className="flex flex-col gap-3">
        <Field id={`${id}-nom`} label="Nom" required size="full" error={champ}>
          <TextInput
            value={nom}
            maxLength={80}
            autoFocus
            onChange={(e) => setNom(e.target.value)}
          />
        </Field>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
          Enregistrer
        </SubmitButton>
      </form>
    </Modal>
  );
}

function PanneauReglages({ gerer }: { gerer: boolean }): React.ReactElement {
  const id = useId();
  const [lecture, setLecture] = useState<Lecture<AssetSettingsView> | null>(null);
  const [f, setF] = useState<FormulaireReglages | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(assetsApi.getSettings()).then((l) => {
      if (annule) return;
      setLecture(l);
      if (l.ok) setF(formulaireReglages(l.valeur));
    });
    return () => {
      annule = true;
    };
  }, []);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!lecture?.ok || f === null) return;
    setMessage(null);
    const p = preparerReglages(f, lecture.valeur.revision);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const s = await assetsApi.putSettings(p.corps);
      setLecture({ ok: true, valeur: s });
      setF(formulaireReglages(s));
      setMessage({ ok: true, texte: 'Réglages enregistrés.' });
    } catch (err) {
      setMessage({ ok: false, texte: messageEquipements(err, 'Enregistrement impossible.') });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Panneau titre="Rappels et affichage" icone={Settings} id="eq-reglages">
      {lecture === null || (lecture.ok && f === null) ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Les réglages sont illisibles." />
      ) : f === null ? null : (
        <form noValidate onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-3">
          <fieldset disabled={!gerer} className="flex flex-col gap-4">
            <FormGrid>
              <Field
                id={`${id}-rappel`}
                label="Rappel avant l’expiration d’une garantie ou assurance (jours)"
                size="lg"
                error={champs['reminderDays']}
              >
                <ChampNombre
                  entier
                  className="max-w-[8rem]"
                  value={f.reminderDays}
                  onChange={(e) => setF({ ...f, reminderDays: e.target.value })}
                />
              </Field>
              <Field
                id={`${id}-maint`}
                label="Maintenance « à venir » à partir de (jours)"
                size="lg"
                newRow
                error={champs['maintenanceDueSoonDays']}
              >
                <ChampNombre
                  entier
                  className="max-w-[8rem]"
                  value={f.maintenanceDueSoonDays}
                  onChange={(e) => setF({ ...f, maintenanceDueSoonDays: e.target.value })}
                />
              </Field>
            </FormGrid>
            <Switch
              checked={f.showDepreciationEstimate}
              onChange={(v) => setF({ ...f, showDepreciationEstimate: v })}
              disabled={!gerer}
              label="Afficher l’amortissement indicatif"
              description={`${ETIQUETTE_ESTIMATION}.`}
            />
          </fieldset>
          {message ? (
            message.ok ? (
              <p className="text-sm text-[var(--success)]" role="status">
                {message.texte}
              </p>
            ) : (
              <Alerte>
                <p>{message.texte}</p>
              </Alerte>
            )
          ) : null}
          {gerer ? (
            <SubmitButton
              size="sm"
              busy={envoi}
              busyLabel="Enregistrement…"
              className="self-start max-sm:h-11 max-sm:w-full"
            >
              Enregistrer
            </SubmitButton>
          ) : null}
        </form>
      )}
    </Panneau>
  );
}
