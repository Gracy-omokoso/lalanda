'use client';

// Réglages du lot 1 RH (ADR-0068) : matricules (préfixe dérivé du nom de
// l'organisation, largeur) et jours fériés de la RDC proposés « à vérifier ».
// L'API reste juge ; chaque modification s'ouvre en fenêtre modale.
//
// ADR-0074 : préfixe en `TextInput`, nombre de chiffres en `Select`.

import {
  Button,
  Field,
  FormGrid,
  Modal,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Hash } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import {
  hrLot1Api,
  type CountryHolidaysProposalView,
  type EmployeeNumberingView,
} from '@/lib/api-hr-lot1';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { formatJour, lire, messageRh, type Lecture } from './rh-model';
import { Chargement, EchecLecture, Panneau } from './rh-ui';

// ── Matricules ──────────────────────────────────────────────────────────────

export function MatriculesReglages({ modifier }: { modifier: boolean }): React.ReactElement {
  const [lecture, setLecture] = useState<Lecture<EmployeeNumberingView> | null>(null);
  const [version, setVersion] = useState(0);
  const [edition, setEdition] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(hrLot1Api.getNumbering()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  return (
    <Panneau
      titre="Matricules"
      icone={Hash}
      id="rh-reg-matricules"
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
          repli="Réglage des matricules illisible."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Préfixe <strong>{lecture.valeur.prefix}</strong>
            {lecture.valeur.configuredPrefix === null
              ? ' (tiré du nom de l’organisation)'
              : ''}, {lecture.valeur.width} chiffres — prochain matricule :{' '}
            <strong>{lecture.valeur.nextNumber}</strong>.
          </p>
          <p className="text-xs text-[var(--foreground-muted)]">
            Un matricule est attribué à la création et n’est jamais réutilisé, même après une sortie
            ou une anonymisation. Un matricule saisi à la main qui suit ce format fait repartir le
            compteur au-dessus.
          </p>
        </div>
      )}
      <Modal
        open={modifier && edition && lecture?.ok === true}
        onClose={() => setEdition(false)}
        title="Matricules"
        size="sm"
      >
        {lecture?.ok ? (
          <FormulaireMatricules
            valeur={lecture.valeur}
            onAnnuler={() => setEdition(false)}
            onEnregistre={() => {
              setEdition(false);
              setVersion((v) => v + 1);
            }}
          />
        ) : null}
      </Modal>
    </Panneau>
  );
}

function FormulaireMatricules({
  valeur,
  onAnnuler,
  onEnregistre,
}: {
  valeur: EmployeeNumberingView;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const id = useId();
  const [prefixe, setPrefixe] = useState(valeur.configuredPrefix ?? '');
  const [largeur, setLargeur] = useState(valeur.width);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await hrLot1Api.updateNumbering({
        expectedRevision: valeur.revision,
        prefix: prefixe.trim() === '' ? null : prefixe.trim(),
        width: largeur,
      });
      onEnregistre();
    } catch (err) {
      setErreur(messageRh(err, 'Le réglage n’a pas pu être enregistré.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <FormGrid>
        <Field
          id={`${id}-prefixe`}
          label="Préfixe"
          optional
          size="sm"
          hint={`Laisser vide : ${valeur.defaultPrefix} (tiré du nom de l’organisation). Lettres, chiffres ou « - _ / . », 10 au plus.`}
        >
          <TextInput
            value={prefixe}
            placeholder={valeur.defaultPrefix}
            className="font-mono"
            onChange={(e) => setPrefixe(e.target.value)}
          />
        </Field>
        <Field
          id={`${id}-largeur`}
          label="Nombre de chiffres"
          size="xs"
          newRow
          hint="De 3 à 8 ; 4 donne GF-0001."
        >
          <Select<string>
            value={String(largeur)}
            onChange={(v) => setLargeur(Number(v))}
            options={[3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          busy={envoi}
          busyLabel="Enregistrement…"
          showShortcut={false}
          className="max-sm:h-11"
        >
          Enregistrer
        </SubmitButton>
      </div>
    </form>
  );
}

// ── Jours fériés de la RDC proposés ─────────────────────────────────────────

export function ChargerFeriesRdc({
  annee,
  onAnnuler,
  onCharge,
}: {
  annee: number;
  onAnnuler: () => void;
  onCharge: (message: string) => void;
}): React.ReactElement {
  const [lecture, setLecture] = useState<Lecture<CountryHolidaysProposalView> | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(hrLot1Api.rdcHolidaysProposal(annee)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [annee]);

  if (lecture === null) return <Chargement />;
  if (!lecture.ok) {
    return <EchecLecture erreur={lecture.erreur} repli="Liste proposée illisible." />;
  }
  const p = lecture.valeur;
  const nouveaux = p.items.filter((h) => !h.alreadyPresent).length;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-[var(--foreground-muted)]">
        Source : {p.source.text}, lue via {p.source.readVia} (consultée le{' '}
        {formatJour(p.source.consultedOn)}). Chaque date est ajoutée « à vérifier » : confirmez-la
        une fois contrôlée. Les reports et les journées déclarées chômées par arrêté ne sont pas
        proposés.
      </p>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {p.items.map((h) => (
          <li key={h.date} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              <span className="font-medium">{formatJour(h.date)}</span> — {h.label}
            </span>
            {h.alreadyPresent ? (
              <span className="text-xs text-[var(--foreground-muted)]">déjà saisi</span>
            ) : null}
          </li>
        ))}
      </ul>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button
          type="button"
          className={buttonClasses('primary', 'sm')}
          disabled={envoi || nouveaux === 0}
          onClick={() => {
            setEnvoi(true);
            setErreur(null);
            hrLot1Api
              .loadRdcHolidays(annee)
              .then((r) =>
                onCharge(
                  `${r.created} jour(s) férié(s) ajouté(s), à vérifier${r.alreadyPresent > 0 ? ` ; ${r.alreadyPresent} déjà saisi(s)` : ''}.`,
                ),
              )
              .catch((err: unknown) => setErreur(messageRh(err, 'Le chargement a échoué.')))
              .finally(() => setEnvoi(false));
          }}
        >
          {nouveaux === 0 ? 'Tout est déjà saisi' : `Ajouter ${nouveaux} date(s) à vérifier`}
        </button>
      </div>
    </div>
  );
}
