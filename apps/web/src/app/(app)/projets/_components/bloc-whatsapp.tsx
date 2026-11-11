'use client';

// Bloc « WhatsApp » de « Mes notifications » — ADR-0065 § 2.
//
// Chacun saisit SON numéro (format international, +243 proposé), reçoit un code à
// 6 chiffres sur WhatsApp, le saisit : numéro vérifié. Retrait à tout moment. Le numéro
// n'est montré qu'à son titulaire ; l'écran ne l'envoie qu'aux routes de l'appelant.

import type { WhatsAppView } from '@lalanda/shared/work';
import { Button, Field, OtpInput, PhoneInput, StatusPill } from '@lalanda/ui';
import { useId, useState } from 'react';

import { workApi } from '@/lib/work-api';
import { Alerte } from './elements';
import {
  NUMERO_WHATSAPP_INITIAL,
  etapeWhatsApp,
  explicationReprise,
  libelleEtatWhatsApp,
  libelleIndisponibleWhatsApp,
} from './parametres-model';
import { messageWork } from './projets-model';

function heure(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function BlocWhatsApp({
  vue,
  onChange,
}: {
  vue: WhatsAppView;
  onChange: (v: WhatsAppView) => void;
}): React.ReactElement {
  const id = useId();
  const [numero, setNumero] = useState(vue.number?.phone ?? NUMERO_WHATSAPP_INITIAL);
  const [code, setCode] = useState('');
  const [changer, setChanger] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const etape = changer ? 'saisie' : etapeWhatsApp(vue);
  const n = vue.number;

  async function agir(action: () => Promise<WhatsAppView>, repli: string): Promise<void> {
    setErreur(null);
    setOccupe(true);
    try {
      const v = await action();
      onChange(v);
      setChanger(false);
      setCode('');
    } catch (err) {
      setErreur(messageWork(err, repli));
    } finally {
      setOccupe(false);
    }
  }

  const demander = (phone: string) =>
    agir(() => workApi.requestWhatsAppCode(phone), 'Le code n’a pas pu être envoyé.');

  function retirer(): void {
    if (
      !window.confirm('Retirer votre numéro WhatsApp ? Plus aucun message ne vous sera envoyé.')
    ) {
      return;
    }
    void agir(() => workApi.removeWhatsAppNumber(), 'Le numéro n’a pas pu être retiré.');
  }

  return (
    <section
      aria-labelledby={`${id}-titre`}
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id={`${id}-titre`} className="text-base font-semibold">
            WhatsApp
          </h3>
          <p className="text-sm text-[var(--foreground-muted)]">
            Recevez les notifications importantes sur votre téléphone, depuis le numéro WhatsApp de
            Lalanda. Votre numéro reste privé : aucun autre membre ne le voit.
          </p>
        </div>
        <StatusPill
          tone={
            etape === 'verifie'
              ? 'ok'
              : etape === 'code'
                ? 'wait'
                : etape === 'a-reprendre'
                  ? 'late'
                  : 'draft'
          }
        >
          {etape === 'indisponible' ? 'Indisponible' : libelleEtatWhatsApp(n?.status ?? null)}
        </StatusPill>
      </header>

      {vue.quota.reached ? (
        <Alerte>
          <p>
            Le plafond mensuel d’envois WhatsApp de votre organisation est atteint : plus aucun
            message WhatsApp ne part jusqu’au mois prochain. La cloche et l’e-mail continuent.
          </p>
        </Alerte>
      ) : null}

      {etape === 'indisponible' ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          {libelleIndisponibleWhatsApp(vue.unavailableReason)}
          {n
            ? ` Votre numéro ${n.phoneMasked} reste enregistré : les envois reprendront dès que WhatsApp sera de retour.`
            : ''}
        </p>
      ) : null}

      {etape === 'a-reprendre' && n ? (
        <p className="text-sm">{explicationReprise(n.status)}</p>
      ) : null}

      {etape === 'saisie' || etape === 'a-reprendre' ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void demander(numero);
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field
              id={`${id}-numero`}
              label="Votre numéro WhatsApp"
              className="w-full sm:w-80"
              hint={
                <>
                  Format international (+243 pour la RDC). Un code à 6 chiffres vous sera envoyé sur
                  WhatsApp ; {vue.codesLeftThisHour} demande
                  {vue.codesLeftThisHour > 1 ? 's' : ''} possible
                  {vue.codesLeftThisHour > 1 ? 's' : ''} dans l’heure.
                </>
              }
            >
              <PhoneInput value={numero} autoComplete="tel" onChange={setNumero} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={occupe || !vue.available || vue.codesLeftThisHour === 0}
              className="max-sm:h-11"
            >
              Recevoir un code
            </Button>
            {changer ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChanger(false)}
                className="max-sm:h-11"
              >
                Annuler
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {etape === 'code' && n?.code ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void agir(() => workApi.verifyWhatsAppCode(code), 'Le code n’a pas pu être vérifié.');
          }}
        >
          <p className="text-sm">
            Code envoyé au <span className="font-medium tabular-nums">{n.phoneMasked}</span>,
            valable jusqu’à {heure(n.code.expiresAt)} ({n.code.attemptsLeft} essai
            {n.code.attemptsLeft > 1 ? 's' : ''} restant{n.code.attemptsLeft > 1 ? 's' : ''}).
          </p>
          <Field id={`${id}-code`} label="Code reçu sur WhatsApp" group size="full">
            <OtpInput value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={occupe || code.length !== 6}
              className="max-sm:h-11"
            >
              Vérifier
            </Button>
            <Button
              size="sm"
              disabled={occupe || vue.codesLeftThisHour === 0 || !vue.available}
              onClick={() => void demander(n.phone)}
              className="max-sm:h-11"
            >
              Renvoyer un code
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNumero(n.phone);
                setChanger(true);
              }}
              className="max-sm:h-11"
            >
              Changer de numéro
            </Button>
          </div>
        </form>
      ) : null}

      {etape === 'verifie' && n ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Numéro vérifié : <span className="font-medium tabular-nums">{n.phone}</span>
            {n.verifiedAt
              ? ` (le ${new Date(n.verifiedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })})`
              : ''}
            . Choisissez ci-dessous les événements à recevoir sur WhatsApp.
          </p>
          <p className="text-xs text-[var(--foreground-muted)]">
            Répondez « STOP » à un message de Lalanda pour tout arrêter, à tout moment.
          </p>
        </div>
      ) : null}

      {n && !changer ? (
        <div className="flex flex-wrap gap-2">
          {etape === 'verifie' ? (
            <Button
              size="sm"
              onClick={() => {
                setNumero(n.phone);
                setChanger(true);
              }}
            >
              Changer de numéro
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={occupe} onClick={retirer}>
            Retirer mon numéro
          </Button>
        </div>
      ) : null}

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </section>
  );
}
