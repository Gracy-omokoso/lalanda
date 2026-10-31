'use client';

// Échéances des documents — ADR-0046 § 4.2, § 6.6 (R18) : documents lisibles par
// vous qui ont expiré ou expirent sous leur délai de rappel. Statuts servis par l'API.

import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';

import { documentsApi, type DocumentDeadlineList } from '@/lib/api-documents';

import { formatJour, grouperEcheancesDocuments, lire, type Lecture } from './documents-model';
import {
  Bandeau,
  CarteDocument,
  CarteVide,
  Chargement,
  EchecLecture,
  Panneau,
} from './documents-ui';

export function EcheancesDocuments(): React.ReactElement {
  const [lecture, setLecture] = useState<Lecture<DocumentDeadlineList> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void lire(documentsApi.deadlines()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  const groupes = lecture?.ok ? grouperEcheancesDocuments(lecture.valeur.items) : null;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarClock}
        titre="Échéances"
        sousTitre={
          lecture?.ok
            ? `Au ${formatJour(lecture.valeur.today)} : attestations, licences, polices à renouveler.`
            : 'Attestations, licences, polices à renouveler.'
        }
      />
      {lecture === null ? (
        <Chargement texte="Chargement des échéances…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les échéances sont illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : groupes && groupes.expires.length + groupes.bientot.length === 0 ? (
        <CarteVide>Aucun document n’expire prochainement.</CarteVide>
      ) : groupes ? (
        <>
          {[
            ['Expirés', groupes.expires, 'doc-ech-expires'] as const,
            ['Expirent bientôt', groupes.bientot, 'doc-ech-bientot'] as const,
          ]
            .filter(([, items]) => items.length > 0)
            .map(([titre, items, id]) => (
              <Panneau key={id} titre={`${titre} (${items.length})`} id={id}>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((e) => (
                    <li key={e.document.id}>
                      <CarteDocument d={e.document} />
                    </li>
                  ))}
                </ul>
              </Panneau>
            ))}
        </>
      ) : null}
    </section>
  );
}
