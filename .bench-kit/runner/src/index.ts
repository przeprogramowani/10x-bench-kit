/**
 * bench — CLI runnera benchmarku.
 *
 * Komendy:
 *   bench run       — wykonanie prób macierzy model × zadanie × próba
 *   bench evaluate  — ocena artefaktów próby (static / tests / e2e / judge)
 *   bench validate  — bramka spójności instancji przed runem
 *   bench report    — agregacja result.json → dane leaderboardu
 *
 * Wszystkie komendy zaimplementowane; kontrakty w docstringach
 * poszczególnych komend, schematy danych w src/schemas/.
 */
import { runCommand } from "./commands/run.ts";
import { evaluateCommand } from "./commands/evaluate.ts";
import { validateCommand } from "./commands/validate.ts";
import { reportCommand } from "./commands/report.ts";
import { matrixCommand } from "./commands/matrix.ts";

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  run: runCommand,
  evaluate: evaluateCommand,
  validate: validateCommand,
  report: reportCommand,
  matrix: matrixCommand,
};

const [command, ...args] = process.argv.slice(2);
const handler = command ? COMMANDS[command] : undefined;

if (!handler) {
  console.error("usage: bench <run|evaluate|validate|report|matrix> [options]");
  process.exit(2);
}

process.exit(await handler(args));
