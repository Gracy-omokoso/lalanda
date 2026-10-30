'use client';

// Création d'un fournisseur (ADR-0044 § 2.1), dans le `Modal` de `@lalanda/ui`
// (docs/04 « Fenêtres modales »). Vérification de forme ici ; l'API tranche
// (NIF unique, homonymes signalés sans refus).

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useState } from 'react';

import { purchasesApi } from '@/lib/api-purchases';

import { Alerte, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import { identifiantExistant, lienFournisseur, messageAchats } from './achats-model';
import {
  formulaireFournisseur,
  phrasesAvertissements,
  preparerFournisseur,
  type FormulaireFournisseur,
} from './fournisseurs-model';

export function NouveauFournisseur({
  onCree,
}: {
  onCree: (id: string) => void;
}): React.ReactElement {
  const [f, setF] = useState<FormulaireFournisseur>(formulaireFournisseur());
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [existant, setExistant] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<{ id: string; phrases: string[] } | null>(
    null,
  );
  const [envoi, setEnvoi] = useState(false);

  const maj = (k: keyof FormulaireFournisseur) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    setExistant(null);
    const p = preparerFournisseur(f);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const r = await purchasesApi.createSupplier(p.corps);
      const phrases = phrasesAvertissements(r.warnings);
      if (phrases.length > 0) setAvertissements({ id: r.supplier.id, phrases });
      else onCree(r.supplier.id);
    } catch (err) {
      setErreur(messageAchats(err, 'Création impossible.'));
      setExistant(identifiantExistant(err));
    } finally {
      setEnvoi(false);
    }
  }

  if (avertissements) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-sm font-medium">
          Fournisseur créé.
        </p>
        {avertissements.phrases.map((ph) => (
          <Alerte key={ph}>
            <p>{ph}</p>
          </Alerte>
        ))}
        <button
          type="button"
          className={buttonClasses('primary', 'md', 'self-start')}
          onClick={() => onCree(avertissements.id)}
        >
          Ouvrir la fiche
        </button>
      </div>
    );
  }

  const texte = (
    id: string,
    cle: keyof FormulaireFournisseur,
    label: string,
    options: { requis?: boolean; type?: string; aide?: string; max?: number } = {},
  ): React.ReactElement => (
    <Champ id={id} label={label} requis={options.requis} aide={options.aide} erreur={champs[cle]}>
      <input
        id={id}
        type={options.type ?? 'text'}
        className={CHAMP}
        value={f[cle]}
        maxLength={options.max ?? 255}
        onChange={(e) => maj(cle)(e.target.value)}
        {...aria(id, champs[cle], options.aide !== undefined)}
      />
    </Champ>
  );

  return (
    <form noValidate onSubmit={(e) => void creer(e)} className="grid gap-3 sm:grid-cols-2">
      {texte('fo-nom', 'name', 'Nom', { requis: true, max: 200 })}
      <Champ id="fo-nature" label="Nature">
        <select
          id="fo-nature"
          className={CHAMP}
          value={f.kind}
          onChange={(e) => maj('kind')(e.target.value)}
        >
          <option value="company">Entreprise</option>
          <option value="individual">Particulier</option>
        </select>
      </Champ>
      {texte('fo-nif', 'nif', 'NIF', {
        aide: 'Facultatif. Lettres et chiffres, sans contrôle auprès de la DGI.',
        max: 40,
      })}
      <Champ id="fo-devise" label="Devise habituelle" aide="Proposée à la saisie, jamais imposée.">
        <select
          id="fo-devise"
          className={CHAMP}
          value={f.defaultCurrency}
          onChange={(e) => maj('defaultCurrency')(e.target.value)}
          aria-describedby="fo-devise-aide"
        >
          <option value="">Aucune</option>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
      </Champ>
      {texte('fo-tel', 'phone', 'Téléphone', { type: 'tel', max: 30 })}
      {texte('fo-email', 'email', 'E-mail', { type: 'email', max: 254 })}
      <div className="sm:col-span-2">{texte('fo-adresse', 'address', 'Adresse')}</div>
      <Champ id="fo-conditions" label="Conditions de paiement">
        <select
          id="fo-conditions"
          className={CHAMP}
          value={f.termsKind}
          onChange={(e) => maj('termsKind')(e.target.value)}
        >
          <option value="immediate">Paiement immédiat</option>
          <option value="net">À un nombre de jours (net)</option>
          <option value="end_of_month">Fin de mois, plus des jours</option>
        </select>
      </Champ>
      {f.termsKind === 'immediate'
        ? null
        : texte('fo-jours', 'termsDays', 'Nombre de jours', {
            aide: 'L’échéance de chaque facture en est déduite par Lalanda.',
            max: 3,
          })}
      <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">Contact principal (facultatif)</legend>
        {texte('fo-contact', 'contactName', 'Nom', { max: 120 })}
        {texte('fo-contact-email', 'contactEmail', 'E-mail', { type: 'email', max: 254 })}
        {texte('fo-contact-tel', 'contactPhone', 'Téléphone', { type: 'tel', max: 30 })}
        <p className="text-xs text-[var(--foreground-muted)] sm:col-span-3">
          Son adresse préremplit l’envoi des bons de commande.
        </p>
      </fieldset>
      {erreur ? (
        <div className="sm:col-span-2">
          <Alerte>
            <p>{erreur}</p>
            {existant ? (
              <p>
                <Link href={lienFournisseur(existant)} className="underline">
                  Ouvrir la fiche existante
                </Link>
              </p>
            ) : null}
          </Alerte>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={envoi}
        className={buttonClasses('primary', 'md', 'sm:col-span-2 sm:justify-self-start')}
      >
        {envoi ? 'Création…' : 'Créer le fournisseur'}
      </button>
    </form>
  );
}
