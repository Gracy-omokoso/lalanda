// Délais des suites e2e (voir l'en-tête de `e2e-database.setup.ts`).
//
// Un délai de hook ou de test e2e ne prouve rien sur le code : il borne une
// attente pour qu'un blocage échoue au lieu de pendre. Il doit donc couvrir le
// travail RÉEL d'un démarrage sur une machine chargée, pas le temps qu'il prend
// sur un poste au repos.
//
// Mesures du 21 oct. 2026 (16 cœurs, charge moyenne 70 à 500, MongoDB partagé
// avec d'autres exécutions) :
//   - seule, une application de test crée les index de ses 40 modèles en ~35 s ;
//   - douze applications démarrant ensemble envoient ~450 opérations DDL
//     (`create`, `createIndexes`) simultanées à un même mongod, qui les traite
//     au compte-gouttes : AUCUN modèle n'avait fini ses index après 40 s, et des
//     `beforeAll` dépassaient 300 s.
// Ce coût existait déjà avant que le démarrage n'attende les index : il se
// payait alors en doublons pendant les tests au lieu de se payer dans le hook.

/** `beforeAll` / `afterAll` des suites e2e : démarrage (index compris) et nettoyage. */
export const E2E_HOOK_TIMEOUT_MS = 600_000;

/** Test e2e sans délai propre : quelques requêtes HTTP et transactions. */
export const E2E_TEST_TIMEOUT_MS = 60_000;
