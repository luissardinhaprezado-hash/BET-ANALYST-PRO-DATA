import { mkdir, readFile, writeFile } from "node:fs/promises";

const key = process.env.PARLAY_API_KEY;
if (!key) throw new Error("Falta configurar PARLAY_API_KEY.");

const base = "https://parlay-api.com/v1";
const headers = { "X-API-Key": key };

const sr = await fetch(`${base}/sports`, { headers });
if (!sr.ok) throw new Error(`Erro ao consultar desportos: HTTP ${sr.status}`);

const sportsData = await sr.json();
if (!Array.isArray(sportsData)) throw new Error("Lista de desportos inválida.");

const sports = sportsData
  .filter(s => s.active !== false && s.key)
  .map(s => ({ key: s.key, name: s.title || s.key, group: s.group || "Outros" }));

if (!sports.length) throw new Error("Nenhum desporto ativo encontrado.");

const old = await readFile("data/odds.json", "utf8")
  .then(JSON.parse).catch(() => ({ events: [] }));

const slot = Math.floor(Date.now() / 21600000);
const batchSize = 2;
const start = (slot * batchSize) % sports.length;
const selected = Array.from(
  { length: Math.min(batchSize, sports.length) },
  (_, i) => sports[(start + i) % sports.length]
);

const updated = new Set(selected.map(s => s.key));
const previous = Array.isArray(old.events) ? old.events : [];
const fresh = [];
const errors = [];

for (const sport of selected) {
  const url = new URL(`${base}/sports/${encodeURIComponent(sport.key)}/odds`);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "decimal");

  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(45000)
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 250)}`);

    const body = await r.json();
    const rows = Array.isArray(body) ? body : body.data;

    if (!Array.isArray(rows)) throw new Error("Formato de resposta inválido.");

    for (const event of rows) {
      fresh.push({
        ...event,
        sport_key: sport.key,
        sport_name: sport.name,
        sport_group: sport.group
      });
    }

    console.log(`${sport.name}: ${rows.length} eventos recebidos.`);
  } catch (e) {
    errors.push({ sport_key: sport.key, message: String(e.message || e) });
    console.log(`${sport.name}: ERRO — ${e.message || e}`);
  }
}

if (errors.length === selected.length) {
  throw new Error("Todas as consultas falharam: " + JSON.stringify(errors));
}

const retained = previous.filter(e => !updated.has(e.sport_key));

const output = {
  generated_at: new Date().toISOString(),
  source: "ParlayAPI",
  coverage: {
    active_sports: sports.length,
    updated_this_run: selected.map(s => s.key),
    region: "eu",
    markets: ["h2h", "spreads", "totals"]
  },
  sports,
  events: [...retained, ...fresh],
  errors
};

await mkdir("data", { recursive: true });
await writeFile("data/odds.json", JSON.stringify(output, null, 2) + "\n");

console.log(`Concluído: ${fresh.length} eventos; ${sports.length} desportos disponíveis.`);
