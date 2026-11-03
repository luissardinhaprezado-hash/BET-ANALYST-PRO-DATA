import { mkdir, writeFile } from "node:fs/promises";

const apiKey = process.env.BETTINGDATA_API_KEY;
if (!apiKey) throw new Error("Chave da API não configurada.");

const sports = [
  { key: "basketball_nba", name: "NBA" },
  { key: "americanfootball_nfl", name: "NFL" },
  { key: "baseball_mlb", name: "MLB" }
];

const events = [];
const errors = [];

for (const sport of sports) {
  const url = new URL("https://api.bettingdataapi.com/odds/");
  url.searchParams.set("sport_key", sport.key);
  url.searchParams.set("oddsFormat", "decimal");

  try {
    const response = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json();
    if (!body.success || !Array.isArray(body.data)) {
      throw new Error(body.message || "Resposta inválida da API");
    }

    for (const event of body.data) {
      events.push({
        ...event,
        sport_key: sport.key,
        sport_name: sport.name
      });
    }
  } catch (error) {
    errors.push({
      sport_key: sport.key,
      message: String(error.message || error)
    });
  }
}

if (events.length === 0) {
  throw new Error("Nenhum evento recebido: " + JSON.stringify(errors));
}

const output = {
  generated_at: new Date().toISOString(),
  source: "BettingDataAPI",
  sports,
  events,
  errors
};

await mkdir("data", { recursive: true });
await writeFile("data/odds.json", JSON.stringify(output, null, 2) + "\n");

console.log(`Atualizados ${events.length} eventos. Falhas: ${errors.length}.`);
