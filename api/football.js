// ESPN → lista real de jogos do dia (grade-mestra), estável e ordenada.
// Implementa cache com TTL de 10 minutos para reduzir chamadas à ESPN.
// O enriquecimento (escalação/lesões/xG/árbitro/estilo...) é tarefa do Gemini Coletor.

// ==========================================
// 🏆 SISTEMA DE TIERS E CORTES (MÁXIMO 15 JOGOS)
// ==========================================
const TIERED_LEAGUES = {
    // 🌟 TIER 1: Elite Absoluta (Prioridade Máxima)
    "eng.1": 1,                // Premier League (Inglaterra)
    "esp.1": 1,                // LaLiga (Espanha)
    "uefa.champions": 1,       // UEFA Champions League
    "conmebol.libertadores": 1,// CONMEBOL Libertadores
    "bra.1": 1,                // Brasileirão Série A
    "ger.1": 1,                // Bundesliga (Alemanha)


    // ⭐ TIER 2: Alto Nível Continental e Nacional
    "ita.1": 2,                // Serie A (Itália)
    "fra.1": 2,                // Ligue 1 (França)
    "por.1": 2,                // Primeira Liga (Portugal)
    "tur.1": 2,                // Süper Lig (Turquia)
    "uefa.europa": 2,          // UEFA Europa League
    "uefa.euro": 2,            // Eurocopa (UEFA Euro)
    "conmebol.america": 2,     // Copa América
    "fifa.world": 2,           // Copa do Mundo FIFA

    // ⚔️ TIER 3: Copas e Ligas Secundárias (Só entram se sobrar vaga)
    "eng.fa": 3,               // FA Cup (Copa da Inglaterra)
    "eng.league_cup": 3,       // Carabao Cup / EFL Cup (Inglaterra)
    "uefa.conf": 3,            // UEFA Conference League
    "esp.copa_del_rey": 3,     // Copa del Rey (Espanha)
    "ita.coppa_italia": 3,     // Coppa Italia (Itália)
    "ger.dfb_pokal": 3,        // DFB-Pokal (Copa da Alemanha)
    "fra.coupe_de_france": 3,  // Coupe de France (França)
    "conmebol.sudamericana": 3,// CONMEBOL Sudamericana
    "sco.1": 3,                // Scottish Premiership (Liga da Escócia)
    "caf.nations": 3           // Africa Cup of Nations (CAN)
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
    console.log('\n=================================================');
    console.log(`\n🔎 Grade de jogos encontrados na ESPN para: ${date}...`);

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
    console.log(`\n⚽ [ESPN] Encontrados ${simplificados.length} jogos.`);

    // 1. FILTRO DO RELÓGIO: Remove jogos que já começaram ou terminaram
    const agora = Date.now();
    const jogosFuturos = simplificados.filter(jogo => {
        const horarioJogo = new Date(jogo.kickoff).getTime();
        return horarioJogo > agora; // Só mantém na lista se o jogo ainda for acontecer
    });

    const jogosPassados = simplificados.length - jogosFuturos.length;
    if (jogosPassados > 0) {
        console.log(`\n⏰ [SISTEMA] Descartando ${jogosPassados} ${jogosPassados.length > 1 ? "jogos" : "jogo"}  que já começaram/terminaram.`);
    }

    // Atualiza a lista apenas com os jogos válidos
    simplificados = jogosFuturos;

    // 2. ORDENAÇÃO POR TIER: (Tier 1 no topo) e desempate por horário
    simplificados.sort((a, b) => {
        const tierA = TIERED_LEAGUES[a.leagueSlug] || 99; // 99 é segurança
        const tierB = TIERED_LEAGUES[b.leagueSlug] || 99;

        if (tierA !== tierB) {
            return tierA - tierB; // Menor número ganha prioridade
        }

        // Se for o mesmo Tier, o jogo mais cedo vem primeiro
        const timeA = new Date(a.kickoff).getTime();
        const timeB = new Date(b.kickoff).getTime();
        return timeA - timeB;
    });

    // 3. O CORTE FINAL: Garante o limite de 15 jogos
    const jogosCortados = simplificados.slice(LIMITE_JOGOS_POR_DIA);
    simplificados = simplificados.slice(0, LIMITE_JOGOS_POR_DIA);

    if (jogosCortados.length > 0) {
        console.log(`\n🚨 [SISTEMA] Grade da ESPN excedeu o limite de ${LIMITE_JOGOS_POR_DIA} jogos por análise. Selecionando os melhores jogos:`);
        console.log(`\n✂️ Cortando ${jogosCortados.length} ${jogosCortados.length > 1 ? "jogos" : "jogo"} de menor prioridade:`);
        jogosCortados.forEach(jogo => {
            console.log(`\n   ❌ Removido: ${jogo.homeTeam} vs ${jogo.awayTeam} (${jogo.league}) - Tier ${TIERED_LEAGUES[jogo.leagueSlug]}`);
        });
    }

    console.log(`\n🎯 [SISTEMA] Selecionados os ${simplificados.length} melhores jogos para análise.`);
    // ==========================================

    // Grava cache com timestamp
    gradeCache.set(date, { ts: Date.now(), value: simplificados });

    return simplificados;
}