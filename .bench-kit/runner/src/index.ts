/**
 * bench — CLI runnera benchmarku (model local-first: wykonanie i ocena
 * to dwa niezależne procesy na maszynie operatora / VPS).
 *
 * Komendy:
 *   bench attempt   — wykonanie prób macierzy → ZACHOWANE PRÓBY (attempts/)
 *   bench evaluate  — ocena zachowanych prób → wyniki w results/ w repo
 *   bench status    — stan macierzy z dysku (zachowane / w toku / ocenione)
 *   bench shell     — kontener sędziego na kopii workspace'u zachowanej próby
 *   bench validate  — bramka spójności instancji przed biegiem
 *   bench report    — agregacja result.json (np. całego results/) → raport
 *   bench leaderboard — statyczny dashboard z historii raportów
 *   bench assert    — pojedyncze asercje z puli na referencji (enabler skilli)
 *   bench judge     — pojedyncze wywołanie sędziego na diffie (kalibracja rubryk)
 *   bench calibrate — pomiar rozdzielczości rubryki na zbiorze kalibracyjnym
 *   bench doctor    — deterministyczna checklista środowiska instancji
 *
 * Kontrakt zachowanej próby (jedyny punkt styku wykonanie ↔ ocena):
 * .bench-kit/ATTEMPT_FORMAT.md; schematy danych w src/schemas/.
 */
import { attemptCommand } from "./commands/attempt.ts";
import { evaluateCommand } from "./commands/evaluate.ts";
import { statusCommand } from "./commands/status.ts";
import { shellCommand } from "./commands/shell.ts";
import { validateCommand } from "./commands/validate.ts";
import { reportCommand } from "./commands/report.ts";
import { leaderboardCommand } from "./commands/leaderboard.ts";
import { assertCommand } from "./commands/assert.ts";
import { judgeCommand } from "./commands/judge.ts";
import { calibrateCommand } from "./commands/calibrate.ts";
import { doctorCommand } from "./commands/doctor.ts";

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  attempt: attemptCommand,
  evaluate: evaluateCommand,
  status: statusCommand,
  shell: shellCommand,
  validate: validateCommand,
  report: reportCommand,
  leaderboard: leaderboardCommand,
  assert: assertCommand,
  judge: judgeCommand,
  calibrate: calibrateCommand,
  doctor: doctorCommand,
};

const [command, ...args] = process.argv.slice(2);
const handler = command ? COMMANDS[command] : undefined;

if (!handler) {
  console.error("usage: bench <attempt|evaluate|status|shell|validate|report|leaderboard|assert|judge|calibrate|doctor> [options]");
  process.exit(2);
}

process.exit(await handler(args));
