// Bramka e2e — kontrakt potoku, nie opinia sędziego.
//
// Dotąd e2e gatowało na `total >= 0.7`, czyli na ocenie LLM-a. Przy
// wagach demo (judge: 1) i rubryce (correctness 0.6) pojedyncza
// halucynacja sędziego dawała total 0.40 i czerwone CI bez żadnej
// regresji — ten sam patch w powtórce dostał 1.00. Prawdopodobieństwo
// zielonego CI było iloczynem dwóch losowań LLM, a nie funkcją stanu repo.
//
// Tu sprawdzamy to, po co ten job istnieje: że potok
// wiring → attempt → zachowana próba → evaluate → results/ działa i że
// ocena odzwierciedla faktyczną pracę agenta. Wynik sędziego NIE jest
// bramką — bramkujemy na tym, że sędzia w ogóle zwrócił poprawny JSON
// (to łapie realne awarie: ucięty JSON, za mały max_tokens, prozę
// zamiast struktury) oraz na deterministycznym guardzie static.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const instance = process.argv[2];
if (!instance) {
  console.error("użycie: e2e-gate.mjs <katalog instancji>");
  process.exit(2);
}

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
  return ok;
};

/** Pierwszy plik o danej nazwie w drzewie (drzewa e2e mają jedną próbę). */
function findFile(root, name) {
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) stack.push(path);
      else if (entry === name) return path;
    }
  }
  return null;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// --- artefakty, które kontrakt zachowanej próby obiecuje ---------------
const resultPath = findFile(join(instance, "results"), "result.json");
const attemptPath = findFile(join(instance, "attempts"), "attempt.json");
if (!resultPath) problems.push("brak result.json w results/ — ocena nie zapisała drzewa wyników");
if (!attemptPath) problems.push("brak attempt.json w attempts/ — kontrakt zachowanej próby zerwany");
if (problems.length) {
  for (const p of problems) console.error(`e2e-gate: ${p}`);
  process.exit(1);
}

const result = readJson(resultPath);
const attempt = readJson(attemptPath);
const attemptDir = attemptPath.slice(0, attemptPath.lastIndexOf("/"));
const judgePath = join(attemptDir, "judge.json");
const patchPath = join(attemptDir, "patch.diff");

// --- 1. wykonanie próby: żadnej awarii infrastruktury -------------------
check(attempt.infra_failure === false, `attempt.infra_failure = ${attempt.infra_failure} (oczekiwano false)`);
check(attempt.provider_error === false, `attempt.provider_error = ${attempt.provider_error} (oczekiwano false)`);
check(attempt.resource_kill === false, `attempt.resource_kill = ${attempt.resource_kill} (oczekiwano false)`);
check(attempt.execution?.timed_out === false, `próba demo trafiła w timeout (${attempt.timeout_s}s) — demo jest trywialne, to awaria`);
check(existsSync(join(attemptDir, "workspace")), "brak workspace/ w zachowanej próbie");
check(existsSync(patchPath) && statSync(patchPath).size > 0, "patch.diff pusty — agent nie zmienił nic");

// --- 2. sędzia: struktura, nie opinia ----------------------------------
if (check(existsSync(judgePath), "brak judge.json obok zachowanej próby")) {
  const [verdict] = readJson(judgePath);
  check(verdict?.parsed != null, "judge.json bez `parsed` — sędzia nie zwrócił poprawnego JSON-a (kontrakt rubryki)");
  check(verdict?.finish_reason === "stop", `judge finish_reason = ${verdict?.finish_reason} (oczekiwano "stop" — inne = ucięta odpowiedź)`);
  // Wynik sędziego celowo NIE jest bramką — tylko logujemy.
  console.log(`e2e-gate: judge score ${verdict?.score} (poza bramką — patrz nagłówek)`);
}

// --- 3. ocena: deterministyczny guard = faktyczny rezultat zadania -----
check(result.scores?.static === 1, `scores.static = ${result.scores?.static} (oczekiwano 1 — guard static/demo-readme-section sprawdza rezultat prompt.md)`);
check(Number.isFinite(result.total) && result.total >= 0 && result.total <= 1, `total = ${result.total} (oczekiwano liczby w [0,1])`);

// --- 4. stemple ery: kompletne i zgodne z wiringiem CI ------------------
const version = readFileSync(join(instance, ".bench-kit/VERSION"), "utf8").trim();
const s = result.stamps ?? {};
check(s.template_version === version, `stamps.template_version = ${s.template_version} != .bench-kit/VERSION (${version})`);
check(typeof s.scoring_version === "string" && s.scoring_version.length > 0, "stamps.scoring_version pusty");
check(/^[0-9a-f]{64}$/.test(s.task_hash ?? ""), `stamps.task_hash nie wygląda na sha256: ${s.task_hash}`);
check(s.judge_model === process.env.JUDGE_MODEL, `stamps.judge_model = ${s.judge_model} != JUDGE_MODEL (${process.env.JUDGE_MODEL}) — wiring demo nie trafił`);
check(typeof s.rubric_version === "string" && s.rubric_version.length > 0, "stamps.rubric_version pusty");
check(Number.isFinite(s.memory_limit_mb), `stamps.memory_limit_mb = ${s.memory_limit_mb} (oczekiwano liczby)`);

console.log(
  `e2e-gate: total ${result.total} | static ${result.scores?.static} | judge ${result.scores?.judge} | ` +
    `cost $${result.cost_usd} | ${result.duration_s}s | stamps ${JSON.stringify(result.stamps)}`,
);

if (problems.length) {
  console.error("");
  for (const p of problems) console.error(`::error::e2e-gate: ${p}`);
  process.exit(1);
}
console.log("e2e-gate: kontrakt potoku spełniony");
