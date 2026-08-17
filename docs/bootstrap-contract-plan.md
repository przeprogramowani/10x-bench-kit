# Plan: przeniesienie logiki instancji z 10x-cli do bench-kitu

Status: **propozycja** (żadna faza nie rozpoczęta)
Dotyczy repozytoriów: `10x-bench-kit` (to repo) oraz `10x-cli`.

## Cel

W `10x-cli` zostają **wyłącznie** komendy `10x bench-kit init` i
`10x bench-kit update`: rozwiązanie tagu, klon template'u, wybór profilu
narzędzia, wywołanie bootstrapu i wyrenderowanie wyniku. Cała wiedza
o układzie plików kitu i semantyce jego treści żyje w tym repo.

Zasada podziału: **kit zna siebie, CLI zna maszynę użytkownika.**

Wsteczna zgodność nie obowiązuje — oba projekty są we wczesnej fazie.
Kontrakt dostaje numer wersji tylko po to, żeby niedopasowanie dawało
czytelny błąd zamiast dziwnego zachowania.

## Dlaczego (dowody, nie przeczucia)

Dzisiejszy podział sprzęga oba repa przez wiedzę o plikach, a dryf tej
wiedzy nie zapala się na czerwono w żadnym z nich:

1. **Przeciek `ci.yaml`.** `materialize` kopiował korzeń template'u,
   pomijając tylko katalog skilli, więc self-test template'u lądował
   w każdej instancji i padał na każdym PR-ze. Nie do cofnięcia:
   `installWorkflows` synchronizuje wyłącznie `.bench-kit/workflows/`,
   a `syncDir` nigdy nie kasuje.
2. **Dryf seda w self-teście.** `ci.yaml` podmieniał `- anthropic/claude-sonnet-5`
   długo po tym, jak default przeszedł na `- openrouter/anthropic/claude-sonnet-5`.
3. **`SHARED_ROOT_FILES` przybite w CLI.** Dodanie drugiego pliku
   współdzielonego w kicie wymaga wydania CLI.

Najmocniejsza korzyść jest jednak inna: po zmianie **`update` wykonuje
bootstrap z NOWEJ wersji kitu**. Dziś logika aktualizacji jest zamrożona
w wersji CLI, więc kit nie ma jak dowieźć własnej migracji. Po zmianie
template, który zmienia układ, przywozi ze sobą kod, który do tego
układu migruje.

## Kontrakt

Kit dostarcza `.bench-kit/bootstrap/index.mjs`. CLI klonuje tag do
katalogu tymczasowego i woła:

```
node <scratch>/.bench-kit/bootstrap/index.mjs   # żądanie JSON na stdin
```

### Żądanie (stdin)

```json
{
  "contractVersion": 1,
  "mode": "init",
  "templateDir": "/tmp/scratch-xyz",
  "targetDir": "/home/u/instancja",
  "tool": { "id": "claude-code", "skillRoot": ".claude/skills" },
  "cwd": "/home/u/produkt",
  "templateRef": "latest",
  "detectedBaseRepo": {
    "rootDir": "/home/u/produkt",
    "name": "produkt",
    "url": "https://github.com/org/produkt.git",
    "headCommit": "…",
    "httpsReachable": true
  },
  "now": "2026-08-17T10:00:00.000Z"
}
```

- `mode`: `init` | `update` | `repair`.
- `detectedBaseRepo`: `null`, gdy CLI nic nie wykryło.
- `now`: wstrzykiwane, żeby bootstrap był testowalny deterministycznie
  (odpowiednik dzisiejszego `deps.now()`).
- `templateVersion` **nie jest** przekazywana — bootstrap czyta ją
  z własnego `.bench-kit/VERSION` i zwraca w odpowiedzi.

### Odpowiedź (stdout, ostatnia linia)

```json
{
  "ok": true,
  "templateVersion": "0.10.0",
  "manifest": { "…": "zapisany instance.json" },
  "summary": [
    { "zone": ".bench-kit/", "action": "replaced" },
    { "zone": ".github/workflows/", "added": 2, "updated": 0, "unchanged": 0 }
  ],
  "baseRepoClone": { "name": "produkt", "url": "…", "dest": ".repos/produkt" },
  "warnings": [],
  "nextSteps": ["Uruchom 'bench validate'…"]
}
```

Błąd: `{ "ok": false, "code": "not_an_instance", "message": "…", "hint": "…" }`.
CLI mapuje `code` na swoje kody wyjścia i renderuje w swoim formacie
(tekst albo koperta `--json`).

### Podział operacji sieciowych

Sieć zostaje w CLI, semantyka w kicie:

- CLI klonuje template i wykrywa repo bazowe wokół `cwd` (wraz z sondą
  osiągalności https).
- Bootstrap **decyduje**, czy i jak zarejestrować repo w
  `bench.config.yaml`, pinuje zadania-demo i dopisuje `.repos/` do
  `.gitignore`, po czym zwraca `baseRepoClone`.
- CLI wykonuje klon do `.repos/<name>` na podstawie tej instrukcji.

## Inwentarz przenosin

Z `10x-cli/src/commands/bench-kit.ts`:

| Symbol | Cel |
|---|---|
| `TEMPLATE_ONLY_PATHS`, `isTemplateOnly` | → kit |
| `SHARED_ROOT_FILES`, `PLACEHOLDER_BASE_REPO`, `PLACEHOLDER_COMMIT`, `BASE_REPOS_DIR` | → kit |
| `materialize`, `syncDir`, `syncFile`, `addSync`, `describeSync` | → kit |
| `installWorkflows`, `templateSkillSource` | → kit |
| `readInstanceVersion`, `readManifest`, `writeManifest`, `readTemplateVersion` | → kit |
| `registerBaseRepo`, `toHttpsUrl`, `pinPlaceholderTasks`, `ensureIgnored` | → kit |
| `installRunnerDependencies`, `freshGitInit` | → kit |
| `registerBenchKitCommand`, `normalizeRef`, `preflight` | zostaje w CLI |
| `resolveInstanceTool`, `skillRootFor` | zostaje w CLI (środowisko użytkownika) |
| `TEMPLATE_REPO_URL`, klon template'u, klon repo bazowego | zostaje w CLI (sieć) |
| `runBenchKitInit`, `runBenchKitUpdate` | rozdzielone wzdłuż kontraktu |

---

## Fazy

### Faza 0 — decyzje przed kodem

- [ ] Zatwierdzić kształt kontraktu (żądanie/odpowiedź powyżej)
- [ ] Rozstrzygnąć układ bootstrapu: moduł z podziałem (rekomendacja)
      zamiast jednego pliku — `index.mjs` + `zones.mjs` + `content.mjs`
      + `manifest.mjs`
- [ ] Rozstrzygnąć kolejność `yaml`: `npm ci` w runnerze **przed**
      chirurgią na `bench.config.yaml`, żeby bootstrap mógł użyć
      `.bench-kit/runner/node_modules/yaml` bez nowej zależności
- [ ] Zapisać granicę zaufania: bootstrap wykonywany wyłącznie z klonu
      `TEMPLATE_REPO_URL` i wyłącznie z tagu

### Faza 1 — bootstrap w kicie

Katalog `.bench-kit/bootstrap/`.

- [ ] `zones.mjs` — strefy: template-only, shared root, źródło skilli,
      mapowanie `.bench-kit/workflows/` → `.github/workflows/`
- [ ] `zones.mjs` — `materialize`, `syncDir`, `syncFile`, liczniki
- [ ] `content.mjs` — placeholdery, `registerBaseRepo`, `pinPlaceholderTasks`,
      `toHttpsUrl`, `ensureIgnored`
- [ ] `manifest.mjs` — odczyt/zapis `instance.json`, odczyt `VERSION`
- [ ] `index.mjs` — parsowanie żądania, walidacja `contractVersion`,
      tryby `init`/`update`/`repair`, złożenie odpowiedzi
- [ ] `index.mjs` — `npm ci` w runnerze i `git init` + pierwszy commit
- [ ] Kontrakt błędów: kody `not_an_instance`, `dirty_tree`,
      `contract_mismatch`, `template_incomplete`

**Kryterium akceptacji:** bootstrap wywołany ręcznie (`echo '<json>' |
node .bench-kit/bootstrap/index.mjs`) tworzy poprawną instancję
z lokalnego klonu template'u, bez udziału CLI.

### Faza 2 — testy bootstrapu w kicie

- [ ] Przenieść asercje na efekty dyskowe z `10x-cli/tests/bench-kit-command.test.ts`
- [ ] Test: pliki template-only nie trafiają do instancji
      (`.github/`, `benchkit.png`) — dziś broniony w CLI, przenieść tutaj
- [ ] Test: `update` zachowuje strefę firmy (`tasks/`, `evaluation-pool/`,
      `bench.config.yaml`) i nigdy nie kasuje plików firmy
- [ ] Test: `repair` (`skipExisting`) nie nadpisuje istniejących plików
- [ ] Test: rejestracja repo bazowego i pinowanie zadań-demo
- [ ] Test: `contractVersion` niedopasowana → `ok: false`, kod
      `contract_mismatch`

**Kryterium akceptacji:** każdy test przechodzi **i** czerwienieje po
cofnięciu odpowiadającej mu logiki (test nie może być pusty).

### Faza 3 — release kitu

Kolejność jest wymuszona: CLI bez bootstrapu w template'cie nie zadziała.

- [ ] Wpis w `CHANGELOG.md` (neutralny — nie dotyka scoringu)
- [ ] Bump `.bench-kit/VERSION`
- [ ] Tag

**Kryterium akceptacji:** tag zawiera `.bench-kit/bootstrap/` i jest
osiągalny dla `git clone --branch <tag>`.

### Faza 4 — odchudzenie CLI

- [ ] Usunąć przeniesione symbole z `src/commands/bench-kit.ts`
      (inwentarz wyżej)
- [ ] `runBenchKitInit` → klon, profil narzędzia, detekcja repo bazowego,
      wywołanie bootstrapu, klon `.repos/`, render
- [ ] `runBenchKitUpdate` → klon, bramka czystego drzewa, wywołanie
      bootstrapu, render
- [ ] Warstwa wywołania bootstrapu jako wstrzykiwalna zależność
      (`deps.runBootstrap`) — testowalna bez sieci i bez dysku
- [ ] Testy CLI zawężone do kontraktu: fake bootstrap, asercje na
      renderowanie tekstu, koperty `--json` i kody wyjścia
- [ ] Usunąć `TEMPLATE_ONLY_PATHS` i `isTemplateOnly` z CLI (wchłonięte
      przez `zones.mjs`) — gałąź `fix/bench-kit-template-only-paths`
      staje się zbędna i nie powinna być mergowana
- [ ] Podnieść minimalną wymaganą wersję template'u w CLI

**Kryterium akceptacji:** `src/commands/bench-kit.ts` nie zawiera ani
jednej ścieżki do wnętrza kitu poza `.bench-kit/bootstrap/index.mjs`
i `.bench-kit/VERSION`.

### Faza 5 — weryfikacja end-to-end

- [ ] `10x bench-kit init` na świeżym katalogu z lokalnego tagu kitu
- [ ] Sprawdzić, że instancja **nie** ma `.github/workflows/ci.yaml`
      ani `benchkit.png`
- [ ] `bench validate` na świeżej instancji
- [ ] `10x bench-kit update` z poprzedniego tagu na nowy — strefa firmy
      nietknięta, `git diff` czytelny jako propozycja
- [ ] Zaktualizować `AGENTS.md` i `README.md` kitu, jeśli opisują podział
      odpowiedzialności

**Kryterium akceptacji:** pełny cykl init → validate → update na czystej
maszynie, bez ręcznych poprawek.

---

## Ryzyka

| Ryzyko | Waga | Postępowanie |
|---|---|---|
| CLI wykonuje kod z klonu | średnia | granica zaufania i tak przekroczona (`npm ci` odpala lifecycle scripts); ograniczyć do `TEMPLATE_REPO_URL` i tagów |
| `yaml` niedostępny w bootstrapie | wysoka | kolejność z Fazy 0: `npm ci` przed chirurgią na configu |
| Przeprowadzka testów gubi pokrycie | średnia | Faza 2 wymaga, żeby każdy test czerwieniał po cofnięciu logiki |
| Node niedostępny dla bootstrapu | niska | runner i tak wymaga Node ≥ 22 (`--experimental-strip-types`) |
| Rozjazd wydań (CLI przed kitem) | wysoka | kolejność faz 3 → 4 jest nienegocjowalna |

## Poza zakresem

- Sprzątanie osieroconego `ci.yaml` w **istniejących** instancjach —
  świadomie pominięte, testujemy na nowych instancjach.
- Usunięcie sedów z self-testu template'u — opisane niżej jako aneks,
  wątek niezależny od tego planu i o niższym priorytecie.

---

## Aneks: `--config` w runnerze (odłożone)

Status: **backlog** — świadomie za naprawą werdyktów sędziego i za
fazami powyżej. Wątek niezależny: nie dotyka `init`/`update`, dotyczy
self-testu template'u.

### Przyczyna sedów

`loadConfig` ma ścieżkę przybitą na sztywno:

```ts
export function loadConfig(root: string): BenchConfig {
  const parsed = BenchConfigSchema.safeParse(readYamlFile(join(root, "bench.config.yaml")));
```

Skoro config może leżeć tylko tam, a zacommitowany config template'u to
z definicji placeholdery, to `.github/workflows/ci.yaml` chcąc odpalić
prawdziwy cykl **musi ten plik przepisać**. Cztery sedy nie są więc
niechlujstwem — są obejściem braku w runnerze.

Koszt tego obejścia jest realny: `ci.yaml` sprzęga się z dokładnymi
domyślnymi stringami `bench.config.yaml` i po cichu się rozjeżdża.
Zdarzyło się to co najmniej dwa razy (dryf `- anthropic/claude-sonnet-5`,
zmiana domyślnego sędziego). Tryb cichej awarii jest już zamknięty
funkcją `subst`, która twardo wymaga trafienia wzorca — zostaje brzydota
i sprzęgnięcie, nie ryzyko. Stąd niski priorytet.

### Zmiana

- [ ] `loadConfig(root, configPath?)` — ścieżka jawna, domyślnie
      `join(root, "bench.config.yaml")`
- [ ] Flaga `--config <ścieżka>` w komendach czytających config:
      `run`, `evaluate`, `assert`, `judge`, `calibrate`, `matrix`,
      `report`, `doctor` (9 miejsc wywołania w 8 komendach —
      przewleczenie argumentu, mechaniczne)
- [ ] `.github/fixtures/bench.config.ci.yaml` — realne wartości do CI
      (publiczne repo bazowe, tanie modele) jako zwykły, przeglądalny
      plik
- [ ] `ci.yaml` — trzy sedy na `bench.config.yaml` zastąpione flagą
      `--config`; `subst` zostaje tylko dla pina zadania-demo

Wariant tańszy: zmienna `BENCH_CONFIG` czytana wewnątrz `loadConfig` —
jedna linia, zero zmian w komendach, ale niewidoczna w `--help`.
Rekomendacja: flaga, bo przydaje się też człowiekowi (lokalny eksperyment
z innym sędzią bez ruszania prawdziwego configu).

### Czego `--config` NIE załatwia

Czwarty sed przepisuje `tasks/demo-hello-bench/task.yaml`, podmieniając
pin `0{40}`. To plik zadania, nie config — poza zasięgiem flagi. Opcje,
do rozstrzygnięcia osobno:

- zapinować zadanie-demo na realne publiczne repo — usuwa seda, ale
  rozbraja bramkę „placeholdery wymuszają świadomy wiring" (dziś
  `bench validate` pada, dopóki nie wypełnisz pina),
- zostawić ten jeden sed pod `subst` (stan po dzisiejszej zmianie).

### Kryterium akceptacji

`ci.yaml` nie zawiera żadnej podmiany tekstu w `bench.config.yaml`,
a e2e template'u przechodzi na zacommitowanym fixture.
