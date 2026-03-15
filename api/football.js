// ESPN → lista real de jogos do dia (grade-mestra), estável e ordenada.
// Implementa cache com TTL de 10 minutos para reduzir chamadas à ESPN.
// O enriquecimento (escalação/lesões/xG/árbitro/estilo...) é tarefa do Gemini Coletor.

// ==========================================
// 🏆 SISTEMA DE TIERS E CORTES (MÁXIMO 15 JOGOS)
// ==========================================
const TIERED_LEAGUES = {
    // 🌟 TIER 1: Elite Absoluta (Prioridade Máxima)
    "eng.1": 1,
    "esp.1": 1,
    "uefa.champions": 1,
    "conmebol.libertadores": 1,
    "bra.1": 1,
    "fifa.world": 1,

    // ⭐ TIER 2: Alto Nível Continental e Nacional
    "ita.1": 2,
    "ger.1": 2,
    "fra.1": 2,
    "por.1": 2,
    "uefa.europa": 2,
    "uefa.euro": 2,
    "conmebol.america": 2,

    // ⚔️ TIER 3: Copas e Ligas Secundárias (Só entram se sobrar vaga)
    "eng.fa": 3,
    "esp.copa_del_rey": 3,
    "ita.coppa_italia": 3,
    "ger.dfb_pokal": 3,
    "fra.coupe_de_france": 3,
    "conmebol.sudamericana": 3,
    "sco.1": 3,
    "caf.nations": 3
};

const LIMITE_JOGOS_POR_DIA = 15;

// Extrai apenas as chaves (os nomes das ligas) para o mapa de busca da ESPN
const ALLOWED_LEAGUES = Object.keys(TIERED_LEAGUES);

// Cache em memória por data com TTL
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const gradeCache = new Map(); // date -> { ts, value: Array }

function isFresh(entry) {
    return entry && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

/**
* Busca e consolida a grade do dia a partir da ESPN em múltiplas ligas.
* Aplica o filtro de Tiers para respeitar o limite gratuito da API.
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

    // 3) Filtro Mestre: Mapeamento Simples para a saída
    let simplificados = jogosDoDia.map((jogo) => {
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

    // ==========================================
    // 🔪 A FACA DO SNIPER: APLICAÇÃO DOS TIERS E CORTE
    // ==========================================
    console.log(`\n⚽ [ESPN] Grade inicial carregada: ${simplificados.length} jogos encontrados para a data ${date}.`);

    // Ordena os jogos pelo Tier (Tier 1 no topo) e, em caso de empate de Tier, ordena por horário
    simplificados.sort((a, b) => {
        const tierA = TIERED_LEAGUES[a.leagueSlug] || 99; // 99 é segurança caso uma liga não tenha peso
        const tierB = TIERED_LEAGUES[b.leagueSlug] || 99;

        if (tierA !== tierB) {
            return tierA - tierB; // Menor número ganha prioridade
        }

        // Se for o mesmo Tier, o jogo mais cedo vem primeiro
        const timeA = new Date(a.kickoff).getTime();
        const timeB = new Date(b.kickoff).getTime();
        return timeA - timeB;
    });

    // Faz o corte final
    const jogosCortados = simplificados.slice(LIMITE_JOGOS_POR_DIA);
    simplificados = simplificados.slice(0, LIMITE_JOGOS_POR_DIA); // Reduz a lista aos 15 melhores

    if (jogosCortados.length > 0) {
        console.log(`\n🚨 [SISTEMA] Grade excedeu o limite seguro de (${LIMITE_JOGOS_POR_DIA} jogos por análise).`);
        console.log(`✂️ Cortando ${jogosCortados.length} jogos de menor prioridade:`);
        jogosCortados.forEach(jogo => {
            console.log(`   ❌ Removido: ${jogo.homeTeam} vs ${jogo.awayTeam} (${jogo.league}) - Tier ${TIERED_LEAGUES[jogo.leagueSlug]}`);
        });
    }

    console.log(`\n🎯 [SISTEMA] Selecionados os ${simplificados.length} melhores jogos para análise.`);
    // ==========================================

    // Grava cache com timestamp
    gradeCache.set(date, { ts: Date.now(), value: simplificados });

    return simplificados;
}