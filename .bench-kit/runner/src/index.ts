/**
 * bench — CLI runnera benchmarku.
 *
 * Komendy:
 *   bench run       — wykonanie prób macierzy model × zadanie × próba
 *   bench evaluate  — ocena artefaktów próby (static / tests / e2e / judge)
 *   bench validate  — bramka spójności instancji przed runem
 *   bench report    — agregacja result.json → dane leaderboardu
 *   bench leaderboard — statyczny dashboard z historii report.json
 *   bench matrix    — macierz jobów dla GH Actions
 *   bench assert    — pojedyncze asercje z puli na referencji (enabler skilli)
 *   bench judge     — pojedyncze wywołanie sędziego na diffie (kalibracja rubryk)
 *   bench calibrate — pomiar rozdzielczości rubryki na zbiorze kalibracyjnym
 *   bench doctor    — deterministyczna checklista środowiska instancji
 *
 * Wszystkie komendy zaimplementowane; kontrakty w docstringach
 * poszczególnych komend, schematy danych w src/schemas/.
 */
import { runCommand } from "./commands/run.ts";
import { evaluateCommand } from "./commands/evaluate.ts";
import { validateCommand } from "./commands/validate.ts";
import { reportCommand } from "./commands/report.ts";
import { leaderboardCommand } from "./commands/leaderboard.ts";
import { matrixCommand } from "./commands/matrix.ts";
import { assertCommand } from "./commands/assert.ts";
import { judgeCommand } from "./commands/judge.ts";
import { calibrateCommand } from "./commands/calibrate.ts";
import { doctorCommand } from "./commands/doctor.ts";

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  run: runCommand,
  evaluate: evaluateCommand,
  validate: validateCommand,
  report: reportCommand,
  leaderboard: leaderboardCommand,
  matrix: matrixCommand,
  assert: assertCommand,
  judge: judgeCommand,
  calibrate: calibrateCommand,
  doctor: doctorCommand,
};

const [command, ...args] = process.argv.slice(2);
const handler = command ? COMMANDS[command] : undefined;

if (!handler) {
  console.error("usage: bench <run|evaluate|validate|report|leaderboard|matrix|assert|judge|calibrate|doctor> [options]");
  process.exit(2);
}

process.exit(await handler(args));
