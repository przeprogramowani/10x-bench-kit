/**
 * Rozdzielczość zbioru zadań — ile zadań potrzeba, żeby porównanie
 * PAROWE dwóch modeli (te same zadania) rozstrzygnęło różnicę δ w odsetku
 * rozwiązanych zadań (α = 0.05 dwustronnie, moc 0.8; przybliżenie
 * McNemara z jawnym założeniem rozbieżności ψ = δ + 0.1).
 *
 * Ta sama formuła co w bench-analysis/analytics.mjs (skrypt skilla nie
 * importuje TS) — zmiana tu = zmiana tam.
 */
export function tasksNeeded(delta: number): number {
  const za = 1.96;
  const zb = 0.8416;
  const psi = Math.min(1, delta + 0.1);
  return Math.ceil((za * Math.sqrt(psi) + zb * Math.sqrt(Math.max(0, psi - delta * delta))) ** 2 / (delta * delta));
}

/**
 * Najmniejsza różnica (pp), którą n zadań rozstrzyga parowo; null = żadna.
 * Poniżej 6 zadań test znaków nie osiąga p < 0.05 nawet przy samych
 * wygranych (min p = 0.0625 dla n = 5).
 */
export function resolvableGap(nTasks: number): number | null {
  if (nTasks < 6) return null;
  for (let pp = 5; pp <= 100; pp++) if (tasksNeeded(pp / 100) <= nTasks) return pp;
  return null;
}
