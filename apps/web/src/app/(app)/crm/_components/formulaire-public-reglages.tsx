'use client';

// Panneau « Formulaire public » des réglages du CRM — ADR-0048 § 9.
//
// Sans formulaire : « Créer le formulaire » ouvre une FENÊTRE MODALE (titre,
// responsable, consentement, politique) ; le formulaire naît DÉSACTIVÉ. Ensuite :
// lien et extrait HTML à copier, champs de la liste fermée, consentement,
// responsable, opportunité automatique, identité visuelle, interrupteur, et
// « Générer un nouveau lien » (l'ancien cesse aussitôt de répondre).
// Lecture seule sans `crm.manage` ; le serveur reste seul juge.

import { buttonClasses } from '@lalanda/ui';
import { Globe } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { leadFormsApi, type CrmLeadFormView } from '@/lib/api-lead-forms';
import { LEAD_FORM_DEFAULT_CONSENT, type LeadFormFieldKey } from '@lalanda/shared/crm';

import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';
import { Dialogue } from '../../ventes/factures/_components/dialog-ui';

import { useAccesCrm, type MembreCrm } from './crm-access';
import { peutGererCrm } from './crm-model';
import { Panneau } from './crm-ui';
import {
  LEAD_FORM_DEFAULT_LABELS,
  changerChamp,
  corpsReglages,
  extraitHtml,
  lienPublic,
  manquesActivation,
  messageFormulaire,
  problemesChamps,
} from './formulaire-public-model';

function ChoixResponsable({
  id,
  valeur,
  membres,
  onChange,
}: {
  id: string;
  valeur: string | null;
  membres: readonly MembreCrm[];
  onChange: (v: string | null) => void;
}): React.ReactElement {
  const connu = valeur === null || membres.some((m) => m.userId === valeur);
  return (
    <select
      id={id}
      className={`${CHAMP} max-w-sm`}
      value={valeur ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">— Choisir —</option>
      {!connu ? <option value={valeur!}>Un membre</option> : null}
      {membres.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

function FenetreCreation({
  membres,
  onFermer,
  onCree,
}: {
  membres: readonly MembreCrm[];
  onFermer: () => void;
  onCree: (f: CrmLeadFormView) => void;
}): React.ReactElement {
  const id = useId();
  const [title, setTitle] = useState('Contactez-nous');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [consent, setConsent] = useState(LEAD_FORM_DEFAULT_CONSENT);
  const [policy, setPolicy] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      onCree(
        await leadFormsApi.create({
          title,
          consentText: consent,
          privacyPolicyUrl: policy.trim() === '' ? null : policy.trim(),
          assigneeUserId: assignee,
        }),
      );
    } catch (err) {
      setErreur(messageFormulaire(err, 'Création impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Dialogue titre="Créer le formulaire public" onFermer={onFermer}>
      <form onSubmit={(e) => void creer(e)} className="flex flex-col gap-4">
        <p className="text-sm text-[var(--foreground-muted)]">
          Le formulaire est créé <strong>désactivé</strong> : rien n’est public tant que vous ne
          l’activez pas. Chaque demande crée un prospect, un contact et une relance pour le
          responsable choisi.
        </p>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-titre`}>
          Titre affiché
          <input
            id={`${id}-titre`}
            className={CHAMP}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-resp`}>
          Responsable des demandes
          <ChoixResponsable
            id={`${id}-resp`}
            valeur={assignee}
            membres={membres}
            onChange={setAssignee}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-accord`}>
          Texte de consentement
          <textarea
            id={`${id}-accord`}
            className={CHAMP}
            rows={3}
            value={consent}
            maxLength={1000}
            onChange={(e) => setConsent(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-politique`}>
          Lien de votre politique de confidentialité (https://)
          <input
            id={`${id}-politique`}
            className={CHAMP}
            type="url"
            inputMode="url"
            placeholder="https://votre-site.cd/confidentialite"
            value={policy}
            maxLength={500}
            onChange={(e) => setPolicy(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={onFermer}>
            Annuler
          </button>
          <button
            type="submit"
            disabled={envoi || title.trim() === ''}
            className={buttonClasses('primary', 'md')}
          >
            {envoi ? 'Création…' : 'Créer (désactivé)'}
          </button>
        </div>
      </form>
    </Dialogue>
  );
}

export function FormulairePublicReglages(): React.ReactElement {
  const id = useId();
  const { actions, membres } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'echec'>('chargement');
  const [f, setF] = useState<CrmLeadFormView | null>(null);
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [origine, setOrigine] = useState('');

  useEffect(() => {
    setOrigine(window.location.origin);
    leadFormsApi
      .get()
      .then((r) => {
        setF(r.form);
        setEtat('pret');
      })
      .catch((err) => {
        setErreur(messageFormulaire(err, 'Formulaire public illisible.'));
        setEtat('echec');
      });
  }, []);

  async function enregistrer(enabled: boolean): Promise<void> {
    if (!f) return;
    setErreur(null);
    setInfo(null);
    try {
      const v = await leadFormsApi.update(corpsReglages(f, enabled));
      setF(v);
      setInfo(
        enabled && !f.enabled
          ? 'Formulaire activé : le lien est public.'
          : !enabled && f.enabled
            ? 'Formulaire désactivé : le lien ne répond plus.'
            : 'Réglages enregistrés.',
      );
    } catch (err) {
      setErreur(messageFormulaire(err, 'Enregistrement impossible.'));
    }
  }

  async function nouveauLien(): Promise<void> {
    if (!f) return;
    if (!window.confirm('L’ancien lien cessera aussitôt de fonctionner. Continuer ?')) return;
    setErreur(null);
    try {
      setF(await leadFormsApi.rotateToken(f.revision));
      setInfo('Nouveau lien généré. Remplacez l’ancien partout où il est publié.');
    } catch (err) {
      setErreur(messageFormulaire(err, 'Impossible de générer un nouveau lien.'));
    }
  }

  async function copier(texte: string, quoi: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texte);
      setInfo(`${quoi} copié.`);
    } catch {
      setInfo(`Copie impossible : sélectionnez ${quoi.toLowerCase()} et copiez-le.`);
    }
  }

  const titre = 'Formulaire public de prospects';

  if (etat === 'chargement') {
    return (
      <Panneau titre={titre} icone={Globe} id={`${id}-p`}>
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      </Panneau>
    );
  }

  if (!f) {
    return (
      <Panneau titre={titre} icone={Globe} id={`${id}-p`}>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <p className="text-sm text-[var(--foreground-muted)]">
          Une page publique, hébergée par Lalanda, où vos visiteurs laissent leurs coordonnées :
          chaque demande arrive dans le CRM (prospect, contact, relance « à traiter »). Aucun
          formulaire pour l’instant.
        </p>
        {gerer && etat === 'pret' ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md', 'self-start')}
            onClick={() => setCreation(true)}
          >
            Créer le formulaire
          </button>
        ) : null}
        {creation ? (
          <FenetreCreation
            membres={membres}
            onFermer={() => setCreation(false)}
            onCree={(v) => {
              setF(v);
              setCreation(false);
              setInfo('Formulaire créé, désactivé. Réglez-le puis activez-le.');
            }}
          />
        ) : null}
      </Panneau>
    );
  }

  const url = lienPublic(origine, f.publicPath);
  const manques = manquesActivation(f);
  const problemes = problemesChamps(f.fields);
  const majChamp = (key: LeadFormFieldKey, label: string) =>
    setF({
      ...f,
      fields: f.fields.map((c) =>
        c.key === key ? { ...c, label: label === '' ? null : label } : c,
      ),
    });

  return (
    <Panneau
      titre={titre}
      icone={Globe}
      id={`${id}-p`}
      action={
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${f.enabled ? 'border-[var(--success,#2f7d4f)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--foreground-muted)]'}`}
        >
          {f.enabled ? 'Activé' : 'Désactivé'}
        </span>
      }
    >
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info ? (
        <p role="status" className="text-sm">
          {info}
        </p>
      ) : null}
      <p className="text-sm text-[var(--foreground-muted)]">
        {f.stats.submissions} demande{f.stats.submissions > 1 ? 's' : ''} reçue
        {f.stats.submissions > 1 ? 's' : ''}
        {f.stats.lastSubmissionAt
          ? `, la dernière le ${new Date(f.stats.lastSubmissionAt).toLocaleDateString('fr-FR')}`
          : ''}
        .
      </p>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-url`} className="text-sm font-medium">
          Lien public {f.enabled ? '' : '(inactif tant que le formulaire est désactivé)'}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`${id}-url`} readOnly className={`${CHAMP} max-w-xl`} value={url} />
          <button type="button" className={BOUTON_PETIT} onClick={() => void copier(url, 'Lien')}>
            Copier le lien
          </button>
          <button
            type="button"
            className={BOUTON_PETIT}
            onClick={() => void copier(extraitHtml(url), 'Extrait HTML')}
          >
            Copier l’extrait HTML
          </button>
          {gerer ? (
            <button type="button" className={BOUTON_PETIT} onClick={() => void nouveauLien()}>
              Générer un nouveau lien
            </button>
          ) : null}
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          L’extrait est un lien à coller dans votre site ; l’affichage dans un cadre (iframe) n’est
          pas permis, par sécurité.
        </p>
      </div>

      <fieldset disabled={!gerer} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Réglages du formulaire public</legend>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-titre`}>
          Titre affiché
          <input
            id={`${id}-titre`}
            className={`${CHAMP} max-w-xl`}
            value={f.title}
            maxLength={120}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-intro`}>
          Introduction (facultative)
          <textarea
            id={`${id}-intro`}
            className={`${CHAMP} max-w-xl`}
            rows={2}
            value={f.intro ?? ''}
            maxLength={500}
            onChange={(e) => setF({ ...f, intro: e.target.value })}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Champs</span>
          <ul className="flex flex-col gap-2">
            {f.fields.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-3 text-sm">
                <input
                  aria-label={`Libellé du champ ${LEAD_FORM_DEFAULT_LABELS[c.key]}`}
                  className={`${CHAMP} max-w-xs`}
                  placeholder={LEAD_FORM_DEFAULT_LABELS[c.key]}
                  value={c.label ?? ''}
                  maxLength={80}
                  onChange={(e) => majChamp(c.key, e.target.value)}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    disabled={c.key === 'name'}
                    onChange={(e) =>
                      setF({
                        ...f,
                        fields: changerChamp(f.fields, c.key, 'enabled', e.target.checked),
                      })
                    }
                  />
                  Affiché
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={c.required}
                    disabled={c.key === 'name'}
                    onChange={(e) =>
                      setF({
                        ...f,
                        fields: changerChamp(f.fields, c.key, 'required', e.target.checked),
                      })
                    }
                  />
                  Obligatoire
                </label>
              </li>
            ))}
          </ul>
          {problemes.map((p) => (
            <p key={p} className="text-xs text-[var(--danger)]">
              {p}
            </p>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-accord`}>
          Texte de consentement (affiché à côté d’une case à cocher, non cochée)
          <textarea
            id={`${id}-accord`}
            className={`${CHAMP} max-w-xl`}
            rows={3}
            value={f.consentText}
            maxLength={1000}
            onChange={(e) => setF({ ...f, consentText: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-politique`}>
          Lien de votre politique de confidentialité (https://)
          <input
            id={`${id}-politique`}
            className={`${CHAMP} max-w-xl`}
            type="url"
            inputMode="url"
            value={f.privacyPolicyUrl ?? ''}
            maxLength={500}
            onChange={(e) => setF({ ...f, privacyPolicyUrl: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-merci`}>
          Message affiché après l’envoi
          <input
            id={`${id}-merci`}
            className={`${CHAMP} max-w-xl`}
            value={f.successMessage}
            maxLength={300}
            onChange={(e) => setF({ ...f, successMessage: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-resp`}>
          Responsable des demandes (reçoit la relance et la notification)
          <ChoixResponsable
            id={`${id}-resp`}
            valeur={f.assigneeUserId}
            membres={membres}
            onChange={(v) => setF({ ...f, assigneeUserId: v })}
          />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.createOpportunity}
            onChange={(e) => setF({ ...f, createOpportunity: e.target.checked })}
          />
          Créer aussi une opportunité (sans montant) pour chaque demande, en
          <select
            aria-label="Devise de l’opportunité"
            className={`${CHAMP} w-24`}
            value={f.opportunityCurrency}
            disabled={!f.createOpportunity}
            onChange={(e) =>
              setF({
                ...f,
                opportunityCurrency: e.target.value as CrmLeadFormView['opportunityCurrency'],
              })
            }
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.showBranding}
            onChange={(e) => setF({ ...f, showBranding: e.target.checked })}
          />
          Afficher le logo et la couleur de l’organisation (si un logo est enregistré)
        </label>

        {!f.enabled && manques.length > 0 ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Pour activer, il manque : {manques.join(', ')}.
          </p>
        ) : null}
        {gerer ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClasses('primary', 'md')}
              disabled={problemes.length > 0}
              onClick={() => void enregistrer(f.enabled)}
            >
              Enregistrer
            </button>
            {f.enabled ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'md')}
                onClick={() => void enregistrer(false)}
              >
                Désactiver
              </button>
            ) : (
              <button
                type="button"
                className={buttonClasses('secondary', 'md')}
                disabled={manques.length > 0}
                onClick={() => void enregistrer(true)}
              >
                Enregistrer et activer
              </button>
            )}
          </div>
        ) : null}
      </fieldset>
    </Panneau>
  );
}
