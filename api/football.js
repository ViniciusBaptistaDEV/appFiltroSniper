// ESPN → lista real de jogos do dia (grade-mestra), estável e ordenada.
// Implementa cache com TTL de 10 minutos para reduzir chamadas à ESPN.
// O enriquecimento (escalação/lesões/xG/árbitro/estilo...) é tarefa do Gemini Coletor.

const ALLOWED_LEAGUES = [
  // 🏆 ELITE EUROPEIA E BRASIL (Conforme Prompt V8.1)
  "eng.1", // Premier League (Inglaterra)
  "esp.1", // LaLiga (Espanha)
  "ita.1", // Serie A (Itália)
  "ger.1", // Bundesliga (Alemanha)
  "fra.1", // Ligue 1 (França)
  "por.1", // Liga Portugal
  "sco.1", // Scottish Premiership (Escócia)
  "bra.1", // Brasileirão Série A

  // 🌍 CONTINENTAIS E SELEÇÕES OFICIAIS
  "uefa.champions",     // UEFA Champions League
  "uefa.europa",        // UEFA Europa League
  "conmebol.libertadores", // Copa Libertadores da América
  "conmebol.sudamericana", // Copa Sul-Americana
  "fifa.world",         // Copa do Mundo
  "uefa.euro",          // Eurocopa
  "caf.nations",        // Copa Africana de Nações
  "conmebol.america",   // Copa América

  // 🛡️ COPAS NACIONAIS (Apenas as principais da Elite)
  "eng.fa",             // FA Cup (Inglaterra)
  "esp.copa_del_rey",   // Copa del Rey (Espanha)
  "ita.coppa_italia",   // Coppa Italia
  "ger.dfb_pokal",      // Copa da Alemanha
  "fra.coupe_de_france" // Copa da França
];

// Cache em memória por data com TTL
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const gradeCache = new Map(); // date -> { ts, value: Array }

function isFresh(entry) {
    return entry && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

/**
* Busca e consolida a grade do dia a partir da ESPN em múltiplas ligas.
* @param {string} date - AAAA-MM-DD
* @param {object} options - { limit?: number }
* @returns {Promise<Array>} [{ league, leagueSlug, fixtureId, kickoff, homeTeam, awayTeam }]
*/
export async function buscarJogos(date, options = {}) {
    const { limit = Number(process.env.MAX_GAMES || 0) } = options;

    // Retorna cache válido (se existir)
    const cached = gradeCache.get(date);
    if (isFresh(cached)) return cached.value;

    const dataESPN = date.replace(/-/g, "");
    console.log(`🔎 ESPN grade-mestra para: ${dataESPN}...`);

    // 1) Scoreboards por liga (paralelo)
    const promessasLigas = ALLOWED_LEAGUES.map((league) =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dataESPN}`)
            .then((res) => res.json())
            .then((data) => {
                const events = Array.isArray(data?.events) ? data.events : [];
                const leagueName = data?.leagues?.[0]?.name || league;
                return events.map((e) => ({
                    ...e,
                    _leagueSlug: league,
                    _leagueName: leagueName
                }));
            })
            .catch(() => [])
    );

    const resultadosLigas = await Promise.all(promessasLigas);

    // 2) Flat + dedup por id
    const mapaPorEvento = new Map();
    for (const arr of resultadosLigas) {
        for (const ev of arr) {
            if (!mapaPorEvento.has(ev.id)) mapaPorEvento.set(ev.id, ev);
        }
    }

    let jogosDoDia = Array.from(mapaPorEvento.values());

    // 3) Ordenação determinística (datetime ↑, liga ↑, id ↑)
    jogosDoDia.sort((a, b) => {
        const da = new Date(a.date || a.startDate || 0).getTime();
        const db = new Date(b.date || b.startDate || 0).getTime();
        if (da !== db) return da - db;

        const la = String(a._leagueName || "");
        const lb = String(b._leagueName || "");
        if (la !== lb) return la.localeCompare(lb);

        return String(a.id).localeCompare(String(b.id));
    });

    // 4) Limite opcional
    if (Number.isFinite(limit) && limit > 0) {
        jogosDoDia = jogosDoDia.slice(0, limit);
    }

    // 5) Mapa simplificado para o coletor do Gemini
    const simplificados = jogosDoDia.map((jogo) => {
        const comp = jogo?.competitions?.[0];
        const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team;
        const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team;
        return {
            league: jogo._leagueName,
            leagueSlug: jogo._leagueSlug,
            fixtureId: jogo.id,
            kickoff: jogo.date || jogo.startDate || null,
            homeTeam: home?.name || "Home",
            awayTeam: away?.name || "Away"
        };
    }).filter(j => j.homeTeam && j.awayTeam);

    // Grava cache com timestamp
    gradeCache.set(date, { ts: Date.now(), value: simplificados });

    console.log("\n===== 🧭 ESPN/grade estável =====");
    console.log(JSON.stringify(simplificados, null, 2));

    return simplificados;
}
