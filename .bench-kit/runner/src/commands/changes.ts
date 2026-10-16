/**
 * bench changes — przegląd INTENCJI zmian w drzewie roboczym zamiast
 * przeglądu linii. Skille zostawiają pliki (zadania, rubryki, raporty,
 * wyniki, backlog), a commit robi użytkownik — ta komenda mówi mu, co
 * każda zmiana robi z porównywalnością wyników, i proponuje podział na
 * commity wg intencji. Czyta gita (diff względem --base, domyślnie HEAD,
 * plus pliki nieśledzone), niczego nie stage'uje ani nie commituje.
 *
 * Wpływ zmiany:
 *   neutral — koordynacja / nowe zadanie (era startowa) / ustawienia biegu
 *   data    — nowe oceny, re-oceny, metadane prób
 *   era     — zamyka erę porównywalności (zmienione zadanie, bump rubryki,
 *             sędzia, limity zasobów) → przez PR, z notą o erze
 *   blocked — zmiana, której nie da się uczciwie zacommitować (edycja
 *             rubryki bez bumpu `version` przy istniejących wynikach,
 *             plik roboczy w katalogu zadania) — exit 1
 *
 * Użycie: bench changes [--base <ref>] [--json] [--root <dir>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { hashTaskDir } from "../lib/era.ts";
import { findInstanceRoot, listTaskNames, loadTask } from "../lib/instance.ts";
import { parseRubric } from "../lib/judge.ts";
import { isDir, readJson } from "../lib/matrix.ts";
import { gateFilled } from "./backlog.ts";

interface Options {
  root: string;
  base: string;
  json: boolean;
}

function parseArgs(args: string[]): Options | null {
  const opts: Options = { root: process.cwd(), base: "HEAD", json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--base") opts.base = args[++i] ?? "";
    else if (arg === "--root") opts.root = resolve(args[++i] ?? "");
    else return null;
  }
  return opts.base ? opts : null;
}

type Impact = "neutral" | "data" | "era" | "blocked";
type Status = "A" | "M" | "D";

interface Change {
  status: Status;
  path: string;
}

export interface Group {
  key: string;
  title: string;
  impact: Impact;
  needs_pr: boolean;
  changes: Change[];
  messages: string[];
  commit_message: string;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const IMPACT_RANK: Record<Impact, number> = { neutral: 0, data: 1, era: 2, blocked: 3 };
/** Pola configu wchodzące do stempli ery (result.json) — ich zmiana zamyka erę. */
const ERA_CONFIG_FIELDS = ["judge.model", "judge.rubric_version", "resources.memory_mb"];

class Git {
  readonly root: string;
  readonly base: string;
  private readonly prefix: string;
  constructor(root: string, base: string) {
    this.root = root;
    this.prefix = this.run(["rev-parse", "--show-prefix"]).trim();
    let resolved = EMPTY_TREE;
    try {
      resolved = this.run(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).trim();
    } catch {
      if (base !== "HEAD") throw new Error(`nieznany --base: ${base}`);
      // repo bez commitów — wszystko jest nowe
    }
    this.base = resolved;
  }
  run(args: string[]): string {
    return execFileSync("git", ["-C", this.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  }
  changes(): Change[] {
    const out: Change[] = [];
    const diff = this.run(["diff", "--name-status", "--no-renames", "-z", "--relative", this.base, "--"]).split("\0");
    for (let i = 0; i + 1 < diff.length; i += 2) {
      const status = (diff[i] as string).charAt(0);
      const path = diff[i + 1] as string;
      if (!path) continue;
      out.push({ status: status === "A" || status === "D" ? status : "M", path });
    }
    for (const path of this.run(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
      if (path) out.push({ status: "A", path });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  existsAtBase(path: string): boolean {
    try {
      this.run(["cat-file", "-e", `${this.base}:${this.prefix}${path}`]);
      return true;
    } catch {
      return false;
    }
  }
  showAtBase(path: string): string | null {
    try {
      return this.run(["show", `${this.base}:${this.prefix}${path}`]);
    } catch {
      return null;
    }
  }
}

/** Wszystkie result.json w results/ drzewa roboczego (task → lista stempli). */
function resultStamps(root: string): { task: string; path: string; stamps: Record<string, unknown> }[] {
  const out: { task: string; path: string; stamps: Record<string, unknown> }[] = [];
  const walk = (dir: string, task: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (isDir(full)) walk(full, task);
      else if (name === "result.json") {
        const result = readJson(full);
        if (result) out.push({ task, path: full, stamps: (result.stamps ?? {}) as Record<string, unknown> });
      }
    }
  };
  const results = join(root, "results");
  if (isDir(results)) for (const task of readdirSync(results)) if (isDir(join(results, task))) walk(join(results, task), task);
  return out;
}

function tasksUsing(root: string, ref: string): string[] {
  return listTaskNames(root).filter((name) => {
    try {
      return loadTask(root, name).evaluation.includes(ref as never);
    } catch {
      return false;
    }
  });
}

const getPath = (obj: unknown, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);

/** Ścieżka w puli → referencja asercji (`judge/x`, `tests/y`), null dla README itp. */
function poolRef(path: string): string | null {
  const judge = path.match(/^evaluation-pool\/judge\/([^/]+)\.md$/);
  if (judge && judge[1] !== "README") return `judge/${judge[1]}`;
  const guard = path.match(/^evaluation-pool\/(static|tests|e2e)\/([^/]+)\/.+$/);
  return guard ? `${guard[1]}/${guard[2]}` : null;
}

const skillsPath = (path: string) => /^\.[^/]+\/skills\//.test(path);

export function planChanges(root: string, base: string): { base: string; groups: Group[] } {
  const git = new Git(root, base);
  const changes = git.changes();
  const groups = new Map<string, Group>();
  const group = (key: string, init: Omit<Group, "key" | "changes" | "messages">): Group => {
    let g = groups.get(key);
    if (!g) {
      g = { key, changes: [], messages: [], ...init };
      groups.set(key, g);
    }
    return g;
  };
  const raise = (g: Group, impact: Impact) => {
    if (IMPACT_RANK[impact] > IMPACT_RANK[g.impact]) g.impact = impact;
  };
  const stamps = resultStamps(root);
  const claimed = new Set<string>();

  // 1. Zadania: nowe (era startowa) vs zmienione (zamknięcie ery).
  const taskChanges = new Map<string, Change[]>();
  for (const c of changes) {
    const m = c.path.match(/^tasks\/([^/]+)\/.+$/);
    if (m) taskChanges.set(m[1] as string, [...(taskChanges.get(m[1] as string) ?? []), c]);
  }
  const newTasks = new Set<string>();
  for (const [name, list] of taskChanges) {
    const existed = git.existsAtBase(`tasks/${name}/task.yaml`);
    const exists = existsSync(join(root, "tasks", name, "task.yaml"));
    let g: Group;
    if (!existed) {
      newTasks.add(name);
      g = group(`task:${name}`, {
        title: `nowe zadanie ${name}`,
        impact: "neutral",
        needs_pr: false,
        commit_message: `feat(tasks): ${name} — nowe zadanie`,
      });
      const report = join(root, "reports", `${name}-build.md`);
      if (existsSync(join(root, "tasks", name, "todo.md"))) g.messages.push("budowa w toku — commit dopiero po raporcie subagenta");
      else g.messages.push("nowe zadanie otwiera własną erę — nie zamyka żadnej istniejącej");
      if (existsSync(join(root, "tasks", name, "todo.md"))) {
        // brak raportu to normalny stan w trakcie budowy — powód blokady podaje todo.md
      } else if (!existsSync(report)) g.messages.push(`brak reports/${name}-build.md — zadanie bez dowodów ze stanu startowego (bench-build)`);
      else if (!gateFilled(readFileSync(report, "utf8"))) g.messages.push("raport bez sekcji Batch gate — stan startowy nieudowodniony na bramce partii");
    } else {
      const results = stamps.filter((s) => s.task === name);
      const hash = exists ? hashTaskDir(join(root, "tasks", name)) : null;
      const previous = results.filter((s) => s.stamps.task_hash !== hash).length;
      g = group(`task:${name}`, {
        title: exists ? `zmiana zadania ${name}` : `usunięcie zadania ${name}`,
        impact: "era",
        needs_pr: true,
        commit_message: exists ? `feat(tasks): ${name} — nowa era zadania` : `chore(tasks): usunięcie ${name}`,
      });
      g.messages.push(
        `zmiana katalogu zadania = nowy task_hash: ${previous} wynik(ów) zostaje w poprzedniej erze; ` +
          "zachowane próby wykonano starą definicją — nowa era wymaga NOWYCH prób (to nie re-ocena)",
      );
    }
    for (const c of list) {
      g.changes.push(c);
      claimed.add(c.path);
      if (c.path.endsWith("/todo.md") && c.status !== "D") {
        raise(g, "blocked");
        g.messages.push(`${c.path}: plik roboczy subagenta — wchodzi do task_hash; usuń przed commitem`);
      }
    }
  }
  // Raport budowy jedzie z zadaniem, którego dotyczy.
  for (const c of changes) {
    const m = c.path.match(/^reports\/(.+)-build\.md$/);
    const g = m ? groups.get(`task:${m[1]}`) : undefined;
    if (g) {
      g.changes.push(c);
      claimed.add(c.path);
    }
  }

  // 2. Pula oceny: nowe wpisy należą do nowego zadania, które je referuje;
  //    zmiany istniejących to zmiana scoringu dla wszystkich zadań, które ich używają.
  const poolChanges = new Map<string, Change[]>();
  for (const c of changes) {
    const ref = poolRef(c.path);
    if (ref) poolChanges.set(ref, [...(poolChanges.get(ref) ?? []), c]);
  }
  for (const [ref, list] of poolChanges) {
    const [type, name] = ref.split("/") as [string, string];
    const entryPath = type === "judge" ? `evaluation-pool/judge/${name}.md` : `evaluation-pool/${type}/${name}`;
    const users = tasksUsing(root, ref);
    if (!git.existsAtBase(entryPath)) {
      const owner = [...newTasks].find((t) => users.includes(t));
      const g = owner
        ? (groups.get(`task:${owner}`) as Group)
        : group(`pool:${ref}`, {
            title: `nowy wpis puli ${ref}`,
            impact: "neutral",
            needs_pr: false,
            commit_message: `feat(pool): ${ref}`,
          });
      if (!owner) g.messages.push(users.length ? `używany przez: ${users.join(", ")}` : "nieużywany przez żadne zadanie");
      for (const c of list) {
        g.changes.push(c);
        claimed.add(c.path);
      }
      continue;
    }
    if (type === "judge") {
      const before = parseRubric(git.showAtBase(entryPath) ?? "").version;
      const deleted = !existsSync(join(root, entryPath));
      const after = deleted ? null : parseRubric(readFileSync(join(root, entryPath), "utf8")).version;
      const stamped = stamps.filter((s) => String(s.stamps.rubric_version ?? "").split("+").includes(`${name}@${before}`));
      const g = group(`rubric:${name}`, {
        title: deleted
          ? `usunięcie rubryki ${name}`
          : before === after
            ? `edycja rubryki ${name} (v${before ?? "?"}, bez bumpu)`
            : `rubryka ${name} v${before ?? "?"}→v${after ?? "?"}`,
        impact: "neutral",
        needs_pr: true,
        commit_message: `feat(scoring): rubryka ${name} v${after ?? "?"} + re-ocena zachowanych prób`,
      });
      if (deleted) {
        raise(g, users.length ? "blocked" : "era");
        if (users.length) g.messages.push(`rubryka usunięta, a referują ją zadania: ${users.join(", ")}`);
      } else if (before === after) {
        if (stamped.length > 0) {
          raise(g, "blocked");
          g.messages.push(
            `treść zmieniona BEZ bumpu version (${before}), a ${stamped.length} wynik(ów) nosi stempel ${name}@${before} — ` +
              "stare i nowe oceny wyglądałyby na tę samą erę; podbij `version` (RUBRIC_AUTHORING.md)",
          );
        } else {
          g.messages.push("edycja przed pierwszymi wynikami — bez bumpu version w porządku");
        }
      } else {
        raise(g, "era");
        g.messages.push(
          `nowa era oceny dla: ${users.join(", ") || "(brak zadań)"}; ${stamped.length} wynik(ów) ze stemplem ${name}@${before} ` +
            "do RE-OCENY zachowanych prób (rate-attempt / bench evaluate) — bez nowego biegu",
        );
      }
      for (const c of list) {
        g.changes.push(c);
        claimed.add(c.path);
      }
    } else {
      const g = group(`guard:${ref}`, {
        title: `zmiana asercji ${ref}`,
        impact: "era",
        needs_pr: true,
        commit_message: `feat(scoring): asercja ${ref}`,
      });
      g.messages.push(
        `zmienia scoring zadań: ${users.join(", ") || "(brak)"} — asercje puli NIE wchodzą do stempli ery, ` +
          "więc wyniki sprzed i po tej zmianie wyglądałyby na porównywalne; re-oceń zachowane próby tych zadań i opisz to w PR",
      );
      for (const c of list) {
        g.changes.push(c);
        claimed.add(c.path);
      }
    }
  }

  // 3. Wyniki i metadane prób: re-oceny po bumpie rubryki jadą z bumpem.
  const bumpedRubricTasks = new Map<string, Group>();
  for (const g of groups.values()) {
    if (!g.key.startsWith("rubric:") || g.impact !== "era") continue;
    for (const t of tasksUsing(root, `judge/${g.key.slice("rubric:".length)}`)) bumpedRubricTasks.set(t, g);
  }
  for (const c of changes) {
    if (claimed.has(c.path)) continue;
    const m = c.path.match(/^(results|attempts)\/([^/]+)\//);
    if (!m) continue;
    const task = m[2] as string;
    if (c.path.includes("/workspace/")) {
      const g = group("blocked:workspace", {
        title: "workspace prób w gicie",
        impact: "blocked",
        needs_pr: false,
        commit_message: "",
      });
      g.messages.push("attempts/**/workspace/ żyje tylko na dysku (.gitignore) — nie commituj");
      g.changes.push(c);
      claimed.add(c.path);
      continue;
    }
    const rubricGroup = m[1] === "results" && c.status === "M" ? bumpedRubricTasks.get(task) : undefined;
    const g =
      rubricGroup ??
      group(`results:${task}`, {
        title: `wyniki ${task}`,
        impact: "data",
        needs_pr: false,
        commit_message: `chore(results): ${task}`,
      });
    g.changes.push(c);
    claimed.add(c.path);
  }
  for (const g of groups.values()) {
    if (!g.key.startsWith("results:")) continue;
    const results = g.changes.filter((c) => c.path.startsWith("results/") && c.path.endsWith("result.json"));
    const added = results.filter((c) => c.status === "A").length;
    const reevaluated = results.filter((c) => c.status === "M").length;
    const removed = results.filter((c) => c.status === "D").length;
    const parts = [added ? `nowe oceny: ${added}` : "", reevaluated ? `re-oceny: ${reevaluated}` : "", removed ? `usunięte: ${removed}` : ""].filter(Boolean);
    g.messages.push(parts.length ? parts.join(", ") : "metadane prób (attempt.json / patch.diff / metrics.json)");
    if (removed) g.messages.push("usunięte wyniki znikną z leaderboardu — próby opłacone są święte, ich oceny też");
    g.commit_message = `chore(results): ${g.key.slice("results:".length)} — ${parts.join(", ") || "metadane prób"}`;
  }

  // 4. Config: pola stempli ery vs ustawienia biegu.
  for (const c of changes) {
    if (c.path !== "bench.config.yaml") continue;
    claimed.add(c.path);
    let before: unknown = {};
    let after: unknown = {};
    try {
      before = parseYaml(git.showAtBase(c.path) ?? "") ?? {};
      after = existsSync(join(root, c.path)) ? (parseYaml(readFileSync(join(root, c.path), "utf8")) ?? {}) : {};
    } catch (err) {
      const g = group("config", { title: "bench.config.yaml", impact: "blocked", needs_pr: true, commit_message: "" });
      g.messages.push(`config nie parsuje się: ${err instanceof Error ? err.message : String(err)}`);
      g.changes.push(c);
      continue;
    }
    const eraChanged = ERA_CONFIG_FIELDS.filter((f) => JSON.stringify(getPath(before, f)) !== JSON.stringify(getPath(after, f)));
    // Zmienione klucze do drugiego poziomu (defaults.max_cost_usd, judge.max_tokens…).
    const settingsChanged: string[] = [];
    const keysOf = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : []);
    for (const k of new Set([...keysOf(before), ...keysOf(after)])) {
      const b = getPath(before, k);
      const a = getPath(after, k);
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      const nested = [...new Set([...keysOf(b), ...keysOf(a)])].filter(
        (n) => JSON.stringify(getPath(b, n)) !== JSON.stringify(getPath(a, n)),
      );
      if (nested.length) settingsChanged.push(...nested.map((n) => `${k}.${n}`).filter((f) => !ERA_CONFIG_FIELDS.includes(f)));
      else settingsChanged.push(k);
    }
    const g = group("config", {
      title: "bench.config.yaml",
      impact: eraChanged.length ? "era" : "neutral",
      needs_pr: true,
      commit_message: eraChanged.length ? `feat(config): ${eraChanged.join(", ")} — nowa era` : `chore(config): ${settingsChanged.join(", ")}`,
    });
    if (eraChanged.length) {
      g.messages.push(`zmienione pola ery: ${eraChanged.join(", ")} — wszystkie dotychczasowe wyniki zostają w poprzedniej erze`);
    }
    if (settingsChanged.length) {
      g.messages.push(`ustawienia biegu/wiringu (${settingsChanged.join(", ")}) — bez wpływu na porównywalność`);
    }
    g.changes.push(c);
  }

  // 5. Reszta: koordynacja, strefy kitu, inne.
  for (const c of changes) {
    if (claimed.has(c.path)) continue;
    let g: Group;
    if (c.path === "tasks/backlog.md" || c.path.startsWith("reports/")) {
      g = group("coordination", {
        title: "backlog i raporty",
        impact: "neutral",
        needs_pr: false,
        commit_message: "chore(backlog): zlecenia i raporty",
      });
    } else if (c.path.startsWith(".bench-kit/")) {
      const update = changes.some((x) => x.path === ".bench-kit/VERSION");
      g = group("tool", {
        title: "strefa narzędzia .bench-kit/",
        impact: update ? "neutral" : "blocked",
        needs_pr: false,
        commit_message: "chore(kit): bench-kit update",
      });
      if (!update && g.messages.length === 0) g.messages.push("ręczna edycja strefy narzędzia — zmienia ją wyłącznie `10x bench-kit update`");
    } else if (c.path === "AGENTS.md" || skillsPath(c.path)) {
      g = group("shared", {
        title: "strefa współdzielona (skille, AGENTS.md)",
        impact: "neutral",
        needs_pr: false,
        commit_message: "chore(skills): lokalne dostosowanie skilli",
      });
    } else {
      g = group("other", { title: "pozostałe", impact: "neutral", needs_pr: false, commit_message: "chore: pozostałe zmiany" });
    }
    g.changes.push(c);
    claimed.add(c.path);
  }

  const order = ["coordination", "task:", "pool:", "results:", "rubric:", "guard:", "config", "shared", "tool", "other", "blocked:"];
  const rank = (key: string) => order.findIndex((p) => key === p || key.startsWith(p));
  const sorted = [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  return { base: git.base, groups: sorted };
}

/**
 * Ścieżki do `git add`: katalog, gdy WSZYSTKIE zmiany pod nim należą do
 * tej grupy (krótsza komenda), inaczej pojedyncze pliki.
 */
function pathspecs(g: Group, all: Group[]): string[] {
  const owner = new Map<string, string>();
  for (const other of all) for (const c of other.changes) owner.set(c.path, other.key);
  const prefixOf = (p: string): string | null => {
    const m = p.match(/^(tasks\/[^/]+|results\/[^/]+|attempts\/[^/]+|evaluation-pool\/(?:static|tests|e2e)\/[^/]+)\//);
    return m ? (m[1] as string) : null;
  };
  const specs = new Set<string>();
  for (const c of g.changes) {
    const prefix = prefixOf(c.path);
    const whole = prefix && [...owner].every(([path, key]) => !path.startsWith(`${prefix}/`) || key === g.key);
    specs.add(whole ? (prefix as string) : c.path);
  }
  return [...specs];
}

const shell = (s: string) => (/^[\w./@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export async function changesCommand(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (!opts) {
    console.error("usage: bench changes [--base <ref>] [--json] [--root <dir>]");
    return 2;
  }
  const root = findInstanceRoot(opts.root);
  if (!root) {
    console.error(`error: nie znaleziono bench.config.yaml od ${opts.root} w górę — to nie jest instancja benchmarku`);
    return 1;
  }
  try {
    const { base, groups } = planChanges(root, opts.base);
    const blocked = groups.filter((g) => g.impact === "blocked");
    if (opts.json) {
      console.log(JSON.stringify({ base, groups: groups.map((g) => ({ ...g, pathspecs: pathspecs(g, groups) })) }, null, 2));
      return blocked.length > 0 ? 1 : 0;
    }
    if (groups.length === 0) {
      console.log(`bench changes: brak zmian względem ${opts.base}`);
      return 0;
    }
    const total = groups.reduce((acc, g) => acc + g.changes.length, 0);
    console.log(`bench changes: ${total} zmienionych plików względem ${opts.base} → ${groups.length} grup(y) wg intencji\n`);
    let n = 0;
    for (const g of groups) {
      const tags = [g.impact, g.needs_pr ? "PR" : ""].filter(Boolean).join(", ");
      console.log(`${g.impact === "blocked" ? "✗" : `${++n}.`} ${g.title}  [${tags}]  (${g.changes.length} plik(ów))`);
      for (const m of g.messages) console.log(`   - ${m}`);
      if (g.impact !== "blocked" && g.commit_message) {
        console.log(`   git add -- ${pathspecs(g, groups).map(shell).join(" ")}`);
        console.log(`   git commit -m ${shell(g.commit_message)}`);
      } else {
        for (const c of g.changes.slice(0, 5)) console.log(`   ${c.status} ${c.path}`);
      }
      console.log("");
    }
    const era = groups.filter((g) => g.impact === "era");
    console.log(
      `podsumowanie: ${blocked.length ? `${blocked.length} grup(y) zablokowanych (✗) — napraw przed commitem; ` : ""}` +
        `${era.length ? `${era.length} zamyka erę porównywalności — PR z notą o erze (AGENTS.md); ` : ""}` +
        "reszta to koordynacja i dane — commit bezpośredni.",
    );
    return blocked.length > 0 ? 1 : 0;
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
