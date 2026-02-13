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

export async function buscarJogos(date) {

    if (cachePorDia.has(date)) {
        console.log("⚡ Retornando do cache do dia");
        return cachePorDia.get(date);
    }

    const headers = {
        "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
        "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com"
    };

    const res = await fetch(
        `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${date}`,
        { headers }
    );

    const data = await res.json();

    const jogosFiltrados = data.response
        .filter(j => ALLOWED_LEAGUES.includes(j.league.id))
        .slice(0, 5); // 🔥 5 JOGOS ANALISADOS

    const resultadoFinal = [];

    for (let jogo of jogosFiltrados) {

        const homeId = jogo.teams.home.id;
        const awayId = jogo.teams.away.id;
        const leagueId = jogo.league.id;
        const season = jogo.league.season;

        // 🔵 Estatísticas temporada
        const homeSeasonRaw = await getTeamStats(homeId, leagueId, season, headers);
        const awaySeasonRaw = await getTeamStats(awayId, leagueId, season, headers);

        const homeSeason = extrairSeasonMetricas(homeSeasonRaw);
        const awaySeason = extrairSeasonMetricas(awaySeasonRaw);

        // 🟢 Últimos 5 jogos com métricas
        const homeLast5 = await calcularLast5Metricas(homeId, headers);
        const awayLast5 = await calcularLast5Metricas(awayId, headers);

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

    const res = await fetch(
        `https://api-football-v1.p.rapidapi.com/v3/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`,
        { headers }
    );

    const data = await res.json();
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

    const res = await fetch(
        `https://api-football-v1.p.rapidapi.com/v3/fixtures?team=${teamId}&last=5`,
        { headers }
    );

    const data = await res.json();
    const jogos = data.response;

    let totalXG = 0;
    let totalXGA = 0;
    let totalPressure = 0;

    for (let jogo of jogos) {

        const statsRes = await fetch(
            `https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${jogo.fixture.id}`,
            { headers }
        );

        const statsData = await statsRes.json();
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
    }

    const divisor = jogos.length || 1;

    const result = {
        xG: totalXG / divisor,
        xGA: totalXGA / divisor,
        pressure: totalPressure / divisor
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
