'use client';

// « Documents générés » de la fiche collaborateur — ADR-0072.
//
// Bouton « Générer un document » (`hr.manage`) : choix du type (attestation pour un
// collaborateur en poste, certificat de travail à la sortie), modèle, signataire,
// lieu et date, options ; aperçu PDF (filigrané, rien n'est tiré ni stocké) puis
// génération. La pièce est rangée dans les documents RH de la fiche ; le registre
// liste les numéros. L'API reste juge de tout.
//
// ADR-0074 : type, mise en page et titre en `Select`, dates en `DatePicker`,
// grille sémantique, mentions en cases stylées, visibilité en interrupteur.
// Mêmes champs envoyés, même `validerForm`.

import {
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  Select,
  Switch,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Eye, FilePlus2, FileSignature, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import {
  hrGeneratedDocumentsApi,
  type GeneratedDocumentKind,
  type GeneratedDocumentSettingsView,
  type GeneratedDocumentView,
} from '@/lib/api-hr-generated-documents';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import {
  ATTESTATION_TITLE_LABELS,
  GENERATED_DOCUMENT_KIND_LABELS,
  corpsGeneration,
  formInitial,
  phraseType,
  typesPossibles,
  validerForm,
  type FormDocumentGenere,
} from './documents-generes-model';
import { useFiche } from './fiche-chrome';
import { useAccesRh } from './rh-access';
import { aujourdhui, formatJour, lire, messageRh, peutGererRh, type Lecture } from './rh-model';
import { Chargement, EchecLecture, Panneau } from './rh-ui';

export function DocumentsGeneres(): React.ReactElement | null {
  const { fiche } = useFiche();
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions) && fiche.status !== 'anonymized';
  const [registre, setRegistre] = useState<Lecture<{ items: GeneratedDocumentView[] }> | null>(
    null,
  );
  const [reglages, setReglages] = useState<GeneratedDocumentSettingsView | null>(null);
  const [version, setVersion] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const today = aujourdhui();
  const types = typesPossibles(fiche, today);

  useEffect(() => {
    let annule = false;
    void lire(hrGeneratedDocumentsApi.list(fiche.id)).then((l) => {
      if (!annule) setRegistre(l);
    });
    void hrGeneratedDocumentsApi
      .settings()
      .then((s) => {
        if (!annule) setReglages(s);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [fiche.id, version]);

  if (!peutGererRh(actions) && registre?.ok !== true) return null;

  return (
    <>
      <Panneau
        titre="Documents générés"
        icone={FileSignature}
        id="rh-fiche-documents-generes"
        action={
          gerer && types.length > 0 ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => {
                setSucces(null);
                setOuvert(true);
              }}
            >
              <FilePlus2 aria-hidden="true" className="mr-1 h-4 w-4" />
              Générer un document
            </button>
          ) : null
        }
      >
        {succes ? (
          <p role="status" className="text-sm text-[var(--success,inherit)]">
            {succes}
          </p>
        ) : null}
        {registre === null ? (
          <Chargement texte="Chargement des pièces…" />
        ) : !registre.ok ? (
          <EchecLecture
            erreur={registre.erreur}
            repli="Le registre des pièces est illisible."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        ) : registre.valeur.items.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucune attestation ni aucun certificat généré.{' '}
            {gerer && types.length === 0
              ? 'Une attestation se délivre à un collaborateur en poste, un certificat à la sortie.'
              : ''}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {registre.valeur.items.map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <strong>{g.number}</strong> — {GENERATED_DOCUMENT_KIND_LABELS[g.kind]}
                  {g.sensitive ? ' (sensible)' : ''}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {formatJour(g.issuedOn)} · {g.signatory.name}, {g.signatory.title}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[var(--foreground-muted)]">
          Chaque pièce est rangée dans les documents de la fiche. Regénérer crée une nouvelle pièce
          avec un nouveau numéro ; l’ancienne reste.
        </p>
      </Panneau>
      <Modal
        open={gerer && ouvert}
        onClose={() => setOuvert(false)}
        title="Générer un document"
        size="lg"
      >
        {ouvert ? (
          <FormulaireGeneration
            types={types}
            reglages={reglages}
            sensibleAutorise={actions !== null && actions.includes('hr.sensitive.read')}
            onAnnuler={() => setOuvert(false)}
            onGenere={(g) => {
              setOuvert(false);
              setSucces(
                `${GENERATED_DOCUMENT_KIND_LABELS[g.kind]} ${g.number} générée et rangée dans les documents de la fiche.`,
              );
              setVersion((v) => v + 1);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function FormulaireGeneration({
  types,
  reglages,
  sensibleAutorise,
  onAnnuler,
  onGenere,
}: {
  types: GeneratedDocumentKind[];
  reglages: GeneratedDocumentSettingsView | null;
  sensibleAutorise: boolean;
  onAnnuler: () => void;
  onGenere: (g: GeneratedDocumentView) => void;
}): React.ReactElement {
  const { fiche } = useFiche();
  const id = useId();
  const today = aujourdhui();
  const [form, setForm] = useState<FormDocumentGenere>(() =>
    formInitial(fiche, reglages, types[0]!, today),
  );
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [alerte, setAlerte] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<'apercu' | 'generer' | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (apercu) URL.revokeObjectURL(apercu);
    },
    [apercu],
  );

  const maj = (patch: Partial<FormDocumentGenere>) => setForm((f) => ({ ...f, ...patch }));

  const agir = async (quoi: 'apercu' | 'generer') => {
    const err = validerForm(form);
    setErreurs(err);
    if (Object.keys(err).length > 0) return;
    setAlerte(null);
    setOccupe(quoi);
    try {
      if (quoi === 'apercu') {
        const blob = await hrGeneratedDocumentsApi.preview(fiche.id, corpsGeneration(form));
        setApercu(URL.createObjectURL(blob));
      } else {
        const r = await hrGeneratedDocumentsApi.generate(fiche.id, corpsGeneration(form));
        onGenere(r.generated);
      }
    } catch (e) {
      setAlerte(messageRh(e, 'Le document n’a pas pu être produit.'));
    } finally {
      setOccupe(null);
    }
  };

  const case_ = (cle: 'contrat' | 'service' | 'matricule' | 'adresse', texte: string) => (
    <Checkbox label={texte} checked={form[cle]} onChange={(v) => maj({ [cle]: v })} />
  );
  const modeles = reglages?.templates ?? [{ id: 'classique', label: 'Classique', version: 1 }];
  const majEmploi = (i: number, patch: Partial<FormDocumentGenere['emplois'][number]>) =>
    maj({ emplois: form.emplois.map((x, k) => (k === i ? { ...x, ...patch } : x)) });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        void agir('generer');
      }}
    >
      {alerte ? <Alerte>{alerte}</Alerte> : null}
      <FormGrid>
        <Field id={`${id}-type`} label="Type de document" required size="md">
          <Select<GeneratedDocumentKind>
            value={form.kind}
            onChange={(v) => setForm(formInitial(fiche, reglages, v, today))}
            options={types.map((t) => ({ value: t, label: GENERATED_DOCUMENT_KIND_LABELS[t] }))}
          />
        </Field>
        <Field id={`${id}-modele`} label="Mise en page" size="md">
          <Select<FormDocumentGenere['templateId']>
            value={form.templateId}
            onChange={(v) => maj({ templateId: v })}
            options={modeles.map((t) => ({
              value: t.id as FormDocumentGenere['templateId'],
              label: t.label,
            }))}
          />
        </Field>
        {form.kind === 'attestation' ? (
          <Field id={`${id}-titre`} label="Titre" size="md" newRow>
            <Select<FormDocumentGenere['title']>
              value={form.title}
              onChange={(v) => maj({ title: v })}
              options={(
                Object.entries(ATTESTATION_TITLE_LABELS) as [FormDocumentGenere['title'], string][]
              ).map(([k, v]) => ({ value: k, label: v }))}
            />
          </Field>
        ) : null}
        <Field
          id={`${id}-nom`}
          label="Signataire (nom)"
          required
          size="md"
          newRow
          error={erreurs['signataireNom']}
        >
          <TextInput
            value={form.signataireNom}
            autoComplete="name"
            onChange={(ev) => maj({ signataireNom: ev.target.value })}
          />
        </Field>
        <Field
          id={`${id}-qualite`}
          label="Qualité du signataire"
          required
          size="md"
          error={erreurs['signataireQualite']}
        >
          <TextInput
            placeholder="Directrice générale"
            value={form.signataireQualite}
            onChange={(ev) => maj({ signataireQualite: ev.target.value })}
          />
        </Field>
        <Field id={`${id}-lieu`} label="Fait à" required size="md" newRow error={erreurs['lieu']}>
          <TextInput value={form.lieu} onChange={(ev) => maj({ lieu: ev.target.value })} />
        </Field>
        <Field id={`${id}-date`} label="Le" required size="sm" error={erreurs['date']}>
          <DatePicker value={form.date} onChange={(v) => maj({ date: v })} shortcuts={['today']} />
        </Field>
      </FormGrid>

      {form.kind === 'attestation' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Mentions facultatives</legend>
          {case_('contrat', 'Type de contrat')}
          {case_('service', 'Service')}
          {case_('matricule', 'Matricule')}
          {sensibleAutorise
            ? case_(
                'adresse',
                'Adresse personnelle (donnée sensible : la lecture est journalisée et la pièce sera chiffrée)',
              )
            : null}
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Nature des services prestés</legend>
          {form.emplois.map((j, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
            >
              <FormGrid>
                <Field
                  id={`${id}-emploi-${i}`}
                  label={`Emploi ${i + 1}`}
                  required
                  size="lg"
                  error={erreurs[`emploi-${i}`]}
                >
                  <TextInput
                    value={j.title}
                    onChange={(ev) => majEmploi(i, { title: ev.target.value })}
                  />
                </Field>
                <Field id={`${id}-emploi-${i}-du`} label="Du" required size="sm" newRow>
                  <DatePicker value={j.from} onChange={(v) => majEmploi(i, { from: v })} />
                </Field>
                <Field id={`${id}-emploi-${i}-au`} label="Au" required size="sm">
                  <DatePicker value={j.to} onChange={(v) => majEmploi(i, { to: v })} />
                </Field>
              </FormGrid>
              <button
                type="button"
                className={`${BOUTON_PETIT} self-end`}
                disabled={form.emplois.length === 1}
                onClick={() => maj({ emplois: form.emplois.filter((_, k) => k !== i) })}
              >
                <Trash2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                Retirer l’emploi {i + 1}
              </button>
            </div>
          ))}
          {form.emplois.length < 10 ? (
            <button
              type="button"
              className={`${BOUTON_PETIT} self-start`}
              onClick={() =>
                maj({
                  emplois: [
                    ...form.emplois,
                    { title: '', from: fiche.startDate, to: fiche.endDate ?? today },
                  ],
                })
              }
            >
              <Plus aria-hidden="true" className="mr-1 inline h-3 w-3" />
              Ajouter un emploi
            </button>
          ) : null}
          <FormGrid>
            <Field
              id={`${id}-cnss`}
              label="N° d’immatriculation CNSS"
              optional
              size="md"
              hint="Mention prévue par l’article 79. Laissé vide, le certificat indique « non communiqué » et reste incomplet."
              error={erreurs['cnss']}
            >
              <TextInput
                value={form.cnss}
                className="font-mono"
                onChange={(ev) => maj({ cnss: ev.target.value })}
              />
            </Field>
          </FormGrid>
        </fieldset>
      )}

      <Switch
        label="Visible du collaborateur dans « Mon espace »"
        checked={form.visible}
        onChange={(v) => maj({ visible: v })}
      />
      <p className="text-xs text-[var(--foreground-muted)]">{phraseType(form.kind)}</p>

      {apercu ? (
        <p className="text-sm">
          Aperçu prêt (filigrane « sans valeur », aucun numéro tiré) :{' '}
          <a href={apercu} target="_blank" rel="noopener noreferrer" className="underline">
            ouvrir l’aperçu PDF
          </a>
          .
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClasses('ghost', 'sm')} onClick={onAnnuler}>
          Annuler
        </button>
        <button
          type="button"
          className={buttonClasses('secondary', 'sm')}
          disabled={occupe !== null}
          onClick={() => void agir('apercu')}
        >
          <Eye aria-hidden="true" className="mr-1 h-4 w-4" />
          {occupe === 'apercu' ? 'Aperçu…' : 'Aperçu'}
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={occupe !== null}>
          {occupe === 'generer' ? 'Génération…' : 'Générer et ranger'}
        </button>
      </div>
    </form>
  );
}
