/**
 * bench report — zagreguje result.json wszystkich prób do danych leaderboardu.
 *
 * Kontrakt (do implementacji):
 * - zbiera result.json ze wszystkich prób runu,
 * - liczy MEDIANĘ per (model × zadanie) — nie średnią (odporność na
 *   pojedynczy odjazd kosztowy) — oraz pass@k jako miarę niezawodności,
 * - raportuje też koszt całego runu, nie tylko prób,
 * - grupuje wyniki w ery (stemple wersji) — nigdy nie miesza er,
 * - wyjście: statyczne dane dla dashboardu GH Pages + surowe JSON-y jako
 *   artefakty.
 */
export async function reportCommand(_args: string[]): Promise<number> {
  console.error("bench report: not implemented in 0.1.0");
  return 1;
}
