/**
 * bench run — wykona próby macierzy model × zadanie × próba.
 *
 * Kontrakt (do implementacji):
 * - wejście: --models <id,...> --tasks <nazwa,...> --trials <n>
 *   (defaults z bench.config.yaml),
 * - przygotowanie: jednorazowe pobranie pinowanych commitów repozytoriów
 *   bazowych i zapieczenie ich w obrazy — próby nie zależą od sieci,
 * - każda próba w jednorazowym kontenerze: świeża kopia repo bazowego
 *   + overlay zadania, pusty XDG_DATA_HOME, `opencode run` z prompt.md
 *   pod twardym timeoutem z task.yaml,
 * - po próbie: adapter metryk → metrics.json, diff workspace → patch.diff,
 * - wynik częściowy zapisywany per próba; ocena robi `bench evaluate`.
 */
export async function runCommand(_args: string[]): Promise<number> {
  console.error("bench run: not implemented in 0.1.0");
  return 1;
}
