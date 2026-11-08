'use client';

// Réglages des documents RH générés — ADR-0072 § 3 et O2 : mise en page par défaut,
// lieu et signataire proposés, textes de l'attestation (bornés, sans HTML, champs
// nommés). Le certificat de travail n'a aucun texte personnalisable (art. 79 :
// « aucune autre indication »). Lecture `hr.read`, modification `hr.manage`.

import { Modal, buttonClasses } from '@lalanda/ui';
import { FileSignature } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { GENERATED_DOCUMENT_LIMITS } from '@lalanda/shared/hr';

import {
  hrGeneratedDocumentsApi,
  type GeneratedDocumentSettingsView,
} from '@/lib/api-hr-generated-documents';

import { Alerte, CHAMP, Champ } from '../../ventes/_components/form-ui';
import { lire, messageRh, type Lecture } from './rh-model';
import { Chargement, EchecLecture, Panneau } from './rh-ui';

export function DocumentsGeneresReglages({ modifier }: { modifier: boolean }): React.ReactElement {
  const [lecture, setLecture] = useState<Lecture<GeneratedDocumentSettingsView> | null>(null);
  const [version, setVersion] = useState(0);
  const [edition, setEdition] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(hrGeneratedDocumentsApi.settings()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  return (
    <Panneau
      titre="Attestations et certificats de travail"
      icone={FileSignature}
      id="rh-reg-documents-generes"
      action={
        modifier && lecture?.ok ? (
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            aria-haspopup="dialog"
            onClick={() => setEdition(true)}
          >
            Modifier
          </button>
        ) : null
      }
    >
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Réglages des documents illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--foreground-muted)]">Mise en page</dt>
              <dd>
                {lecture.valeur.templates.find((t) => t.id === lecture.valeur.templateId)?.label}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--foreground-muted)]">Lieu proposé</dt>
              <dd>{lecture.valeur.place ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--foreground-muted)]">Signataire proposé</dt>
              <dd>
                {lecture.valeur.signatory
                  ? `${lecture.valeur.signatory.name}, ${lecture.valeur.signatory.title}`
                  : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--foreground-muted)]">
                Introduction de l’attestation
              </dt>
              <dd className="whitespace-pre-line">
                {lecture.valeur.attestationIntro ?? lecture.valeur.defaults.attestationIntro}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--foreground-muted)]">Formule finale</dt>
              <dd className="whitespace-pre-line">
                {lecture.valeur.attestationClosing ?? lecture.valeur.defaults.attestationClosing}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--foreground-muted)]">
            L’en-tête reprend l’identité visuelle (logo, couleurs) et la fiche fiscale (raison
            sociale, siège, RCCM, id. nat., NIF). Le certificat de travail n’a aucun texte
            modifiable : la loi n’y admet aucune autre indication que ses mentions.
          </p>
          <Modal
            open={modifier && edition}
            onClose={() => setEdition(false)}
            title="Attestations et certificats de travail"
            size="lg"
          >
            {edition ? (
              <Formulaire
                v={lecture.valeur}
                onAnnuler={() => setEdition(false)}
                onEnregistre={(s) => {
                  setLecture({ ok: true, valeur: s });
                  setEdition(false);
                }}
              />
            ) : null}
          </Modal>
        </>
      )}
    </Panneau>
  );
}

function Formulaire({
  v,
  onAnnuler,
  onEnregistre,
}: {
  v: GeneratedDocumentSettingsView;
  onAnnuler: () => void;
  onEnregistre: (s: GeneratedDocumentSettingsView) => void;
}): React.ReactElement {
  const id = useId();
  const [templateId, setTemplateId] = useState(v.templateId);
  const [lieu, setLieu] = useState(v.place ?? '');
  const [nom, setNom] = useState(v.signatory?.name ?? '');
  const [qualite, setQualite] = useState(v.signatory?.title ?? '');
  const [intro, setIntro] = useState(v.attestationIntro ?? v.defaults.attestationIntro);
  const [fin, setFin] = useState(v.attestationClosing ?? v.defaults.attestationClosing);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const L = GENERATED_DOCUMENT_LIMITS;

  const enregistrer = async () => {
    setAlerte(null);
    if ((nom.trim() === '') !== (qualite.trim() === '')) {
      setAlerte('Renseignez le nom ET la qualité du signataire, ou aucun des deux.');
      return;
    }
    setOccupe(true);
    try {
      const s = await hrGeneratedDocumentsApi.putSettings({
        templateId,
        place: lieu.trim() === '' ? null : lieu.trim(),
        signatory: nom.trim() === '' ? null : { name: nom.trim(), title: qualite.trim() },
        // Le texte par défaut, inchangé, reste « par défaut » (il suivra ses évolutions).
        attestationIntro:
          intro.trim() === '' || intro.trim() === v.defaults.attestationIntro ? null : intro.trim(),
        attestationClosing:
          fin.trim() === '' || fin.trim() === v.defaults.attestationClosing ? null : fin.trim(),
        expectedRevision: v.revision,
      });
      onEnregistre(s);
    } catch (e) {
      setAlerte(messageRh(e, 'Réglages non enregistrés.'));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        void enregistrer();
      }}
    >
      {alerte ? <Alerte>{alerte}</Alerte> : null}
      <Champ id={`${id}-modele`} label="Mise en page par défaut">
        <select
          id={`${id}-modele`}
          className={CHAMP}
          value={templateId}
          onChange={(ev) => setTemplateId(ev.target.value as typeof templateId)}
        >
          {v.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Champ>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Champ id={`${id}-lieu`} label="Lieu proposé">
          <input
            id={`${id}-lieu`}
            className={CHAMP}
            maxLength={L.place}
            value={lieu}
            onChange={(ev) => setLieu(ev.target.value)}
          />
        </Champ>
        <Champ id={`${id}-nom`} label="Signataire proposé">
          <input
            id={`${id}-nom`}
            className={CHAMP}
            maxLength={L.signatoryName}
            value={nom}
            onChange={(ev) => setNom(ev.target.value)}
          />
        </Champ>
        <Champ id={`${id}-qualite`} label="Qualité">
          <input
            id={`${id}-qualite`}
            className={CHAMP}
            maxLength={L.signatoryTitle}
            value={qualite}
            onChange={(ev) => setQualite(ev.target.value)}
          />
        </Champ>
      </div>
      <Champ
        id={`${id}-intro`}
        label="Introduction de l’attestation"
        aide={`${L.intro} caractères au plus, sans balise. Champs : ${v.fields.map((f) => `{${f}}`).join(', ')}.`}
      >
        <textarea
          id={`${id}-intro`}
          className={CHAMP}
          rows={4}
          maxLength={L.intro}
          value={intro}
          onChange={(ev) => setIntro(ev.target.value)}
        />
      </Champ>
      <Champ
        id={`${id}-fin`}
        label="Formule finale de l’attestation"
        aide={`${L.closing} caractères au plus, sans balise.`}
      >
        <textarea
          id={`${id}-fin`}
          className={CHAMP}
          rows={2}
          maxLength={L.closing}
          value={fin}
          onChange={(ev) => setFin(ev.target.value)}
        />
      </Champ>
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClasses('ghost', 'sm')} onClick={onAnnuler}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={occupe}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
