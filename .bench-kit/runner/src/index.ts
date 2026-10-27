/**
 * bench — CLI runnera benchmarku (model local-first: wykonanie i ocena
 * to dwa niezależne procesy na maszynie operatora / VPS).
 *
 * Komendy:
 *   bench attempt   — wykonanie prób macierzy → ZACHOWANE PRÓBY (attempts/)
 *   bench evaluate  — ocena zachowanych prób → wyniki w results/ w repo
 *   bench status    — stan macierzy z dysku (zachowane / w toku / ocenione)
 *   bench backlog   — etap zleceń backlogu wyprowadzony z dysku (nie ze statusów)
 *   bench changes   — zmiany w drzewie roboczym wg wpływu na scoring + plan commitów
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
import { backlogCommand } from "./commands/backlog.ts";
import { changesCommand } from "./commands/changes.ts";
import { shellCommand } from "./commands/shell.ts";
import { validateCommand } from "./commands/validate.ts";
import { reportCommand } from "./commands/report.ts";
import { leaderboardCommand } from "./commands/leaderboard.ts";
import { assertCommand } from "./commands/assert.ts";
import { judgeCommand } from "./commands/judge.ts";
import { calibrateCommand } from "./commands/calibrate.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { findInstanceRoot } from "./lib/instance.ts";
import { applyDiskTmpdir } from "./lib/tmpdir.ts";
import { resolve } from "node:path";

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  attempt: attemptCommand,
  evaluate: evaluateCommand,
  status: statusCommand,
  backlog: backlogCommand,
  changes: changesCommand,
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

// /tmp na tmpfs-ie (RAM) → katalogi tymczasowe na dysku instancji (lib/tmpdir.ts).
{
  const rootFlag = args.indexOf("--root");
  const start = rootFlag >= 0 && args[rootFlag + 1] ? resolve(args[rootFlag + 1] as string) : process.cwd();
  applyDiskTmpdir(findInstanceRoot(start));
}

if (!handler) {
  console.error("usage: bench <attempt|evaluate|status|backlog|changes|shell|validate|report|leaderboard|assert|judge|calibrate|doctor> [options]");
  process.exit(2);
}

process.exit(await handler(args));
