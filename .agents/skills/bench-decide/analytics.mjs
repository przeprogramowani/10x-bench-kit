/**
 * analytics.mjs — statystyka decyzji nad wynikami (czyste funkcje, bez I/O).
 *
 * Zasada przewodnia: jednostką dowodu dla twierdzeń o KLASIE pracy jest
 * zadanie, nie próba. Pięć prób jednego zadania mierzy to zadanie; o klasie
 * mówi dopiero wiele zadań. Dlatego przedziały klas i porównania modeli
 * liczymy po zadaniach (bootstrap), a próby tylko uśredniają wynik zadania.
 *
 * Wszystko deterministyczne: bootstrap ma stałe ziarno — te same wyniki,
 * te same liczby.
 */

/** Generator liniowy z ziarnem — powtarzalny bootstrap. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 95% przedział percentylowy średniej przez bootstrap po elementach. */
export function bootstrapMean(values, { iterations = 2000, seed = 7 } = {}) {
  if (values.length === 0) return null;
  if (values.length === 1) return { mean: values[0], lo: values[0], hi: values[0] };
  const draw = rng(seed);
  const means = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) sum += values[Math.floor(draw() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(values), lo: means[Math.floor(0.025 * iterations)], hi: means[Math.ceil(0.975 * iterations) - 1] };
}

/** pass^k (τ-bench): estymator C(c,k)/C(n,k) — k prób z rzędu, wszystkie zaliczone. */
export function passHatK(n, c, k) {
  if (k < 1 || k > n) return null;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (c - i) / (n - i);
  return Math.max(0, p);
}

/**
 * Ile zadań potrzeba, żeby porównanie PAROWANE dwóch modeli (te same
 * zadania) rozstrzygnęło różnicę δ w odsetku rozwiązanych zadań
 * (α = 0.05 dwustronnie, moc 0.8). Przybliżenie McNemara z założeniem,
 * że modele rozjeżdżają się na ψ = δ + 0.1 zadań (część niezgodności
 * idzie w obie strony) — założenie jawne, nie ukryte.
 */
export function tasksNeeded(delta) {
  const za = 1.96;
  const zb = 0.8416;
  const psi = Math.min(1, delta + 0.1);
  return Math.ceil((za * Math.sqrt(psi) + zb * Math.sqrt(Math.max(0, psi - delta * delta))) ** 2 / (delta * delta));
}

/** Najmniejsza różnica (w punktach proc.), którą n zadań rozstrzyga parowo. */
export function resolvableGap(nTasks) {
  for (let pp = 5; pp <= 100; pp++) if (tasksNeeded(pp / 100) <= nTasks) return pp;
  return null;
}

/**
 * Widok klasa × model. `taskRates`: Map<task, Map<model, {passes, trials}>>,
 * `classOf`: Map<task, klasa>. Wynik per klasa: per model średni odsetek
 * zaliczeń zadań (każde zadanie waży tyle samo) z bootstrapem po zadaniach.
 */
export function classView(taskRates, classOf) {
  const byClass = new Map();
  for (const [task, models] of taskRates) {
    const klass = classOf.get(task) ?? "(bez klasy)";
    if (!byClass.has(klass)) byClass.set(klass, new Map());
    for (const [model, { passes, trials }] of models) {
      if (!trials) continue;
      const m = byClass.get(klass);
      if (!m.has(model)) m.set(model, []);
      m.get(model).push({ task, rate: passes / trials });
    }
  }
  return [...byClass].map(([klass, models]) => {
    const tasks = new Set([...models.values()].flatMap((rows) => rows.map((r) => r.task)));
    return {
      class: klass,
      tasks: tasks.size,
      // Poniżej 5 zadań klasa to hipoteza z kilku przypadków, nie twierdzenie.
      claim: tasks.size >= 5 ? "class" : "hypothesis",
      resolvable_gap_pp: resolvableGap(tasks.size),
      models: [...models]
        .map(([model, rows]) => ({ model, tasks: rows.length, ...bootstrapMean(rows.map((r) => r.rate)) }))
        .sort((a, b) => b.lo - a.lo),
    };
  });
}

/** Dokładny dwustronny test znaków: p dla `wins` wygranych z `n` niezremisowanych. */
export function signTestP(wins, n) {
  if (n === 0) return 1;
  const k = Math.min(wins, n - wins);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/**
 * Porównanie parowe dwóch modeli na WSPÓLNYCH zadaniach: różnica odsetków
 * per zadanie, bilans wygranych/remisów/przegranych, bootstrap wielkości
 * różnicy. Rozstrzygnięte = dokładny test znaków po zadaniach p < 0.05 —
 * przy kilku zadaniach bootstrap percentylowy jest zbyt pewny siebie,
 * a test znaków nie zakłada nic poza niezależnością zadań.
 */
export function pairedComparisons(taskRates, tasksFilter = null) {
  const models = [...new Set([...taskRates.values()].flatMap((m) => [...m.keys()]))].sort();
  const out = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const [a, b] = [models[i], models[j]];
      const diffs = [];
      for (const [task, m] of taskRates) {
        if (tasksFilter && !tasksFilter.has(task)) continue;
        const ra = m.get(a);
        const rb = m.get(b);
        if (!ra?.trials || !rb?.trials) continue;
        diffs.push(ra.passes / ra.trials - rb.passes / rb.trials);
      }
      if (!diffs.length) continue;
      const ci = bootstrapMean(diffs, { seed: 11 });
      out.push({
        a,
        b,
        shared_tasks: diffs.length,
        a_wins: diffs.filter((d) => d > 0).length,
        ties: diffs.filter((d) => d === 0).length,
        b_wins: diffs.filter((d) => d < 0).length,
        mean_diff: ci.mean,
        lo: ci.lo,
        hi: ci.hi,
        sign_test_p: signTestP(diffs.filter((d) => d > 0).length, diffs.filter((d) => d !== 0).length),
        resolved: signTestP(diffs.filter((d) => d > 0).length, diffs.filter((d) => d !== 0).length) < 0.05,
        resolvable_gap_pp: resolvableGap(diffs.length),
      });
    }
  }
  return out;
}

/**
 * Horyzont czasowy (METR): przy jakiej długości zadania (minuty pracy
 * CZŁOWIEKA) model zalicza w 50% / 80% przypadków. Regresja logistyczna
 * P(zaliczenie) = σ(a + b·log2(minuty)) po próbach, z lekką regularyzacją
 * (mało danych). Wyznaczalny tylko przy ≥5 zadaniach z czasem człowieka,
 * rozpiętości ≥4× i spadku sukcesu z długością (b < 0) — inaczej null
 * z powodem, nigdy liczba z sufitu.
 */
export function timeHorizon(observations) {
  const tasks = new Set(observations.map((o) => o.task));
  const minutes = observations.map((o) => o.minutes);
  if (tasks.size < 5) return { horizon50_min: null, horizon80_min: null, reason: `${tasks.size} zadań z czasem człowieka (potrzeba ≥5)` };
  if (Math.max(...minutes) / Math.min(...minutes) < 4) return { horizon50_min: null, horizon80_min: null, reason: "za mała rozpiętość długości zadań (<4×)" };
  let a = 0;
  let b = 0;
  const lambda = 0.1;
  for (let iter = 0; iter < 50; iter++) {
    let ga = -lambda * a;
    let gb = -lambda * b;
    let haa = -lambda;
    let hab = 0;
    let hbb = -lambda;
    for (const o of observations) {
      const x = Math.log2(o.minutes);
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const y = o.passed ? 1 : 0;
      ga += y - p;
      gb += (y - p) * x;
      const w = p * (1 - p);
      haa -= w;
      hab -= w * x;
      hbb -= w * x * x;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  if (!(b < 0)) return { horizon50_min: null, horizon80_min: null, reason: "sukces nie spada z długością zadania — brak horyzontu w tym zakresie" };
  const at = (p) => 2 ** ((Math.log(p / (1 - p)) - a) / b);
  return { horizon50_min: Math.round(at(0.5)), horizon80_min: Math.round(at(0.8)), tasks: tasks.size, reason: null };
}

/** Pola zlecenia z tasks/backlog.md: klasa i czas człowieka per zadanie. */
export function parseBacklogMeta(text) {
  const meta = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^## +(.+?)\s*$/);
    if (heading) {
      current = { class: null, human_minutes: null };
      meta.set(heading[1], current);
      continue;
    }
    if (!current) continue;
    const klass = line.match(/^- \*\*Class\*\*:\s*(.+)$/);
    if (klass && !klass[1].startsWith("<")) current.class = klass[1].split(/\s+[—–-]\s+|\(|;/)[0].trim().toLowerCase();
    const human = line.match(/^- \*\*Human time\*\*:\s*~?\s*(\d+(?:\.\d+)?)\s*(min|h)/i);
    if (human) current.human_minutes = Number(human[1]) * (human[2].toLowerCase() === "h" ? 60 : 1);
  }
  return meta;
}
