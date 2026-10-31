'use client';

// Échéances des équipements — ADR-0046 § 3.3, § 3.4, § 6.6 (R17) : maintenances en
// retard ou à venir, garanties et assurances qui expirent, matériel encore chez un
// collaborateur sorti. Échéances et délais calculés par le moteur, par l'API.

import { Badge } from '@lalanda/ui';
import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { assetsApi, type AssetDeadlinesView } from '@/lib/api-assets';

import { formatJour, lienEquipement, lire, type Lecture } from './equipements-model';
import { Bandeau, CARTE, CarteVide, Chargement, EchecLecture, Panneau } from './equipements-ui';
import { grouperEcheances, phraseDelai, tonEcheance } from './echeances-model';

export function Echeances(): React.ReactElement {
  const [lecture, setLecture] = useState<Lecture<AssetDeadlinesView> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void lire(assetsApi.deadlines()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarClock}
        titre="Échéances"
        sousTitre="Ce qui demande votre attention : entretiens, garanties, assurances, matériel à reprendre."
      />
      {lecture === null ? (
        <Chargement texte="Chargement des échéances…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les échéances sont illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : lecture.valeur.items.length === 0 ? (
        <CarteVide>Aucune échéance proche : tout est à jour.</CarteVide>
      ) : (
        grouperEcheances(lecture.valeur.items).map((g) => (
          <Panneau key={g.kind} titre={`${g.libelle} (${g.items.length})`} id={`eq-ech-${g.kind}`}>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((e) => (
                <li key={`${e.kind}-${e.assetId}-${e.refId ?? ''}`}>
                  <Link href={lienEquipement(e.assetId)} className={CARTE}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-semibold break-words">{e.assetName}</span>
                      <Badge tone={tonEcheance(e.kind)}>{phraseDelai(e)}</Badge>
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {e.assetNumber} · {formatJour(e.date)}
                      {e.employeeName ? ` · ${e.employeeName}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panneau>
        ))
      )}
    </section>
  );
}
