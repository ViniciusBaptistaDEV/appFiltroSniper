const ALLOWED_LEAGUES = [
    39,   // Premier League
    140,  // La Liga
    135,  // Serie A
    78,   // Bundesliga
    94,   // Primeira Liga
    61,   // Ligue 1
    179,  // Premiership Escócia
    71,   // Brasileirão Serie A
    307,  // Saudi Pro League

    45,   // FA Cup (Inglaterra)
    143,  // Copa do Rei (Espanha)
    137,  // Coppa Italia
    66,   // Coupe de France

    1,    // Copa do Mundo
    4,    // Eurocopa
    6,    // Copa Africana
    9     // Copa América
];

const cachePorDia = new Map();
const cacheTeamStats = new Map();
const cacheLast5 = new Map();

// 🔥 Função para criar uma pausa e não estourar o limite por segundo da API
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function buscarJogos(date) {

    if (cachePorDia.has(date)) {
        console.log("⚡ A retornar do cache do dia");
        return cachePorDia.get(date);
    }

    const headers = {
        "x-apisports-key": process.env.API_FOOTBALL_KEY,
        "x-apisports-host": "v3.football.api-sports.io"
    };

    const res = await fetch(
        `https://v3.football.api-sports.io/fixtures?date=${date}`,
        { headers }
    );

    const data = await res.json();

    if (!data.response) {
        console.error("Erro ao buscar jogos do dia. Verifique a chave da API.");
        return [];
    }

    const jogosFiltrados = data.response
        .filter(j => ALLOWED_LEAGUES.includes(j.league.id))
        .slice(0, 5); // 🔥 5 JOGOS ANALISADOS

    const resultadoFinal = [];

    for (let jogo of jogosFiltrados) {

        const homeId = jogo.teams.home.id;
        const awayId = jogo.teams.away.id;
        const leagueId = jogo.league.id;
        const season = jogo.league.season;

        // 🔵 Busca os dados brutos primeiro
        const homeSeasonRaw = await getTeamStats(homeId, leagueId, season, headers);
        const awaySeasonRaw = await getTeamStats(awayId, leagueId, season, headers);
        const homeLast5 = await calcularLast5Metricas(homeId, headers);
        const awayLast5 = await calcularLast5Metricas(awayId, headers);

        // 🛡️ A TRAVA DE SEGURANÇA (As duas linhas essenciais)
        // Se a API barrar ou faltar dados de alguma equipa, ignora este jogo e passa ao próximo
        if (!homeSeasonRaw || !awaySeasonRaw || !homeLast5 || !awayLast5) {
            console.warn(`⚠️ A saltar o jogo ${jogo.teams.home.name} vs ${jogo.teams.away.name} devido a falha ou falta de dados.`);
            continue;
        }

        // Apenas processa as métricas se todos os dados existirem (evita erros fatais)
        const homeSeason = extrairSeasonMetricas(homeSeasonRaw);
        const awaySeason = extrairSeasonMetricas(awaySeasonRaw);

        const homeFinal = aplicarPeso(homeLast5, homeSeason);
        const awayFinal = aplicarPeso(awayLast5, awaySeason);

        resultadoFinal.push({
            liga: jogo.league.name,
            fixtureId: jogo.fixture.id,
            jogo: `${jogo.teams.home.name} x ${jogo.teams.away.name}`,
            home: homeFinal,
            away: awayFinal
        });
    }

    cachePorDia.set(date, resultadoFinal);

    console.log("===== JSON ENVIADO AO MODELO =====");
    console.log(JSON.stringify(resultadoFinal, null, 2));

    return resultadoFinal;
}

// =============================
// 🔵 TEAM STATS TEMPORADA
// =============================

async function getTeamStats(teamId, leagueId, season, headers) {

    const key = `${teamId}-${leagueId}-${season}`;

    if (cacheTeamStats.has(key)) {
        return cacheTeamStats.get(key);
    }

    await delay(300); // ⏱️ Travão de segurança da API

    const res = await fetch(
        `https://v3.football.api-sports.io/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`,
        { headers }
    );

    const data = await res.json();

    // Proteção caso a API devolva vazio
    if (!data || !data.response || Object.keys(data.response).length === 0) {
        return null;
    }

    const stats = data.response;
    cacheTeamStats.set(key, stats);

    return stats;
}

function extrairSeasonMetricas(teamStats) {

    const jogos = teamStats.fixtures.played.total || 1;
    const golsPro = teamStats.goals.for.total.total || 0;
    const golsContra = teamStats.goals.against.total.total || 0;

    return {
        xG: golsPro / jogos,
        xGA: golsContra / jogos,
        pressure: 0 // Pode evoluir depois
    };
}

// =============================
// 🟢 ÚLTIMOS 5 JOGOS
// =============================

async function calcularLast5Metricas(teamId, headers) {

    if (cacheLast5.has(teamId)) {
        return cacheLast5.get(teamId);
    }

    await delay(300); // ⏱️ Travão de segurança da API

    const res = await fetch(
        `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5`,
        { headers }
    );

    const data = await res.json();

    if (!data || !data.response || data.response.length === 0) {
        return null;
    }

    const jogos = data.response;

    let totalXG = 0;
    let totalXGA = 0;
    let totalPressure = 0;
    let jogosValidos = 0; // Para garantir a média correta caso algum jogo falhe

    for (let jogo of jogos) {

        await delay(300); // ⏱️ Travão dentro do loop (CRUCIAL)

        const statsRes = await fetch(
            `https://v3.football.api-sports.io/fixtures/statistics?fixture=${jogo.fixture.id}`,
            { headers }
        );

        const statsData = await statsRes.json();

        if (!statsData || !statsData.response || statsData.response.length === 0) {
            continue; // Se este jogo específico não tiver dados, passa à frente
        }

        const stats = statsData.response;

        const teamStats = stats.find(s => s.team.id === teamId);
        const opponentStats = stats.find(s => s.team.id !== teamId);

        if (!teamStats || !opponentStats) continue;

        const xg = calculateXGFromStats(teamStats.statistics);
        const xga = calculateXGFromStats(opponentStats.statistics);
        const pressure = calculatePressureFromStats(teamStats.statistics);

        totalXG += xg;
        totalXGA += xga;
        totalPressure += pressure;
        jogosValidos++;
    }

    if (jogosValidos === 0) return null;

    const result = {
        xG: totalXG / jogosValidos,
        xGA: totalXGA / jogosValidos,
        pressure: totalPressure / jogosValidos
    };

    cacheLast5.set(teamId, result);

    return result;
}

// =============================
// 🧮 MÉTRICAS
// =============================

function parseStat(statsArray, type) {
    const stat = statsArray.find(s => s.type === type);
    if (!stat || stat.value === null) return 0;

    return typeof stat.value === "string"
        ? parseFloat(stat.value.replace("%", ""))
        : stat.value;
}

function calculateXGFromStats(statsArray) {
    const sot = parseStat(statsArray, "Shots on Goal");
    const shots = parseStat(statsArray, "Total Shots");
    return (sot * 0.35) + ((shots - sot) * 0.08);
}

function calculatePressureFromStats(statsArray) {
    const corners = parseStat(statsArray, "Corner Kicks");
    const shots = parseStat(statsArray, "Total Shots");
    const possession = parseStat(statsArray, "Ball Possession");

    return (corners * 0.4) + (shots * 0.3) + (possession * 0.03);
}

function aplicarPeso(last5, season) {
    return {
        xG: (last5.xG * 0.7) + (season.xG * 0.3),
        xGA: (last5.xGA * 0.7) + (season.xGA * 0.3),
        pressure: (last5.pressure * 0.7) + (season.pressure * 0.3)
    };
}