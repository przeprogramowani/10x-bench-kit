/**
 * bench validate — bramka spójności instancji przed pierwszym/każdym runem.
 *
 * Kontrakt (do implementacji):
 * - bench.config.yaml i wszystkie tasks/<x>/task.yaml parsują się
 *   schematami z schemas/,
 * - każde repo bazowe daje się sklonować, pinowany commit istnieje,
 * - referencje evaluation[] w task.yaml wskazują istniejące asercje
 *   w evaluation-pool/, rubryki się parsują,
 * - testy weryfikacyjne zadań przechodzą na wersji referencyjnej,
 * - zadania po dacie ważności → warning (starzenie zadań),
 * - po `bench-kit update`: zgodność contentu z nowym schematem; przy
 *   zmianach łamiących wypisuje, co poprawić.
 */
export async function validateCommand(_args: string[]): Promise<number> {
  console.error("bench validate: not implemented in 0.1.0");
  return 1;
}
