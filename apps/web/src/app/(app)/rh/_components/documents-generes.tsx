'use client';

// « Documents générés » de la fiche collaborateur — ADR-0072.
//
// Bouton « Générer un document » (`hr.manage`) : choix du type (attestation pour un
// collaborateur en poste, certificat de travail à la sortie), modèle, signataire,
// lieu et date, options ; aperçu PDF (filigrané, rien n'est tiré ni stocké) puis
// génération. La pièce est rangée dans les documents RH de la fiche ; le registre
// liste les numéros. L'API reste juge de tout.

import { Modal, buttonClasses } from '@lalanda/ui';
import { Eye, FilePlus2, FileSignature, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import {
  hrGeneratedDocumentsApi,
  type GeneratedDocumentKind,
  type GeneratedDocumentSettingsView,
  type GeneratedDocumentView,
} from '@/lib/api-hr-generated-documents';

import { Alerte, BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';
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

  const case_ = (
    cle: 'visible' | 'contrat' | 'service' | 'matricule' | 'adresse',
    texte: string,
  ) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={form[cle]}
        onChange={(ev) => maj({ [cle]: ev.target.checked })}
      />
      <span>{texte}</span>
    </label>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        void agir('generer');
      }}
    >
      {alerte ? <Alerte>{alerte}</Alerte> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Champ id={`${id}-type`} label="Type de document" requis>
          <select
            id={`${id}-type`}
            className={CHAMP}
            value={form.kind}
            onChange={(ev) =>
              setForm(formInitial(fiche, reglages, ev.target.value as GeneratedDocumentKind, today))
            }
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {GENERATED_DOCUMENT_KIND_LABELS[t]}
              </option>
            ))}
          </select>
        </Champ>
        <Champ id={`${id}-modele`} label="Mise en page">
          <select
            id={`${id}-modele`}
            className={CHAMP}
            value={form.templateId}
            onChange={(ev) =>
              maj({ templateId: ev.target.value as FormDocumentGenere['templateId'] })
            }
          >
            {(reglages?.templates ?? [{ id: 'classique', label: 'Classique', version: 1 }]).map(
              (t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ),
            )}
          </select>
        </Champ>
        {form.kind === 'attestation' ? (
          <Champ id={`${id}-titre`} label="Titre">
            <select
              id={`${id}-titre`}
              className={CHAMP}
              value={form.title}
              onChange={(ev) => maj({ title: ev.target.value as FormDocumentGenere['title'] })}
            >
              {Object.entries(ATTESTATION_TITLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Champ>
        ) : null}
        <Champ id={`${id}-nom`} label="Signataire (nom)" requis erreur={erreurs['signataireNom']}>
          <input
            id={`${id}-nom`}
            className={CHAMP}
            value={form.signataireNom}
            onChange={(ev) => maj({ signataireNom: ev.target.value })}
          />
        </Champ>
        <Champ
          id={`${id}-qualite`}
          label="Qualité du signataire"
          requis
          erreur={erreurs['signataireQualite']}
        >
          <input
            id={`${id}-qualite`}
            className={CHAMP}
            placeholder="Directrice générale"
            value={form.signataireQualite}
            onChange={(ev) => maj({ signataireQualite: ev.target.value })}
          />
        </Champ>
        <Champ id={`${id}-lieu`} label="Fait à" requis erreur={erreurs['lieu']}>
          <input
            id={`${id}-lieu`}
            className={CHAMP}
            value={form.lieu}
            onChange={(ev) => maj({ lieu: ev.target.value })}
          />
        </Champ>
        <Champ id={`${id}-date`} label="Le" requis erreur={erreurs['date']}>
          <input
            id={`${id}-date`}
            type="date"
            className={CHAMP}
            value={form.date}
            onChange={(ev) => maj({ date: ev.target.value })}
          />
        </Champ>
      </div>

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
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <input
                aria-label={`Emploi ${i + 1}`}
                className={CHAMP}
                value={j.title}
                onChange={(ev) =>
                  maj({
                    emplois: form.emplois.map((x, k) =>
                      k === i ? { ...x, title: ev.target.value } : x,
                    ),
                  })
                }
              />
              <input
                aria-label={`Début de l’emploi ${i + 1}`}
                type="date"
                className={CHAMP}
                value={j.from}
                onChange={(ev) =>
                  maj({
                    emplois: form.emplois.map((x, k) =>
                      k === i ? { ...x, from: ev.target.value } : x,
                    ),
                  })
                }
              />
              <input
                aria-label={`Fin de l’emploi ${i + 1}`}
                type="date"
                className={CHAMP}
                value={j.to}
                onChange={(ev) =>
                  maj({
                    emplois: form.emplois.map((x, k) =>
                      k === i ? { ...x, to: ev.target.value } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                className={BOUTON_PETIT}
                aria-label={`Retirer l’emploi ${i + 1}`}
                disabled={form.emplois.length === 1}
                onClick={() => maj({ emplois: form.emplois.filter((_, k) => k !== i) })}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
              {erreurs[`emploi-${i}`] ? (
                <p className="text-xs text-[var(--danger)] sm:col-span-4">
                  {erreurs[`emploi-${i}`]}
                </p>
              ) : null}
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
          <Champ
            id={`${id}-cnss`}
            label="N° d’immatriculation CNSS"
            aide="Mention prévue par l’article 79. Laissé vide, le certificat indique « non communiqué » et reste incomplet."
            erreur={erreurs['cnss']}
          >
            <input
              id={`${id}-cnss`}
              className={CHAMP}
              value={form.cnss}
              onChange={(ev) => maj({ cnss: ev.target.value })}
            />
          </Champ>
        </fieldset>
      )}

      {case_('visible', 'Visible du collaborateur dans « Mon espace »')}
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
