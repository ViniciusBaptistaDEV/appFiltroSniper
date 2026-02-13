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


function parseStat(teamStats, type) {
    const stat = teamStats.statistics.find(s => s.type === type);
    if (!stat || stat.value === null) return 0;
    return typeof stat.value === "string"
        ? parseFloat(stat.value.replace("%", ""))
        : stat.value;
}

function calculateXG(stats) {
    const sot = parseStat(stats, "Shots on Goal");
    const shots = parseStat(stats, "Total Shots");
    return (sot * 0.35) + ((shots - sot) * 0.08);
}

function calculatePressure(stats) {
    const corners = parseStat(stats, "Corner Kicks");
    const shots = parseStat(stats, "Total Shots");
    const possession = parseStat(stats, "Ball Possession");
    return (corners * 0.4) + (shots * 0.3) + (possession * 0.03);
}

async function getStats(fixtureId, headers) {
    const res = await fetch(
        `https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`,
        { headers }
    );
    const data = await res.json();
    return data.response;
}

async function getLastGames(teamId, headers, limit = 5) {
    const res = await fetch(
        `https://api-football-v1.p.rapidapi.com/v3/fixtures?team=${teamId}&last=${limit}`,
        { headers }
    );
    const data = await res.json();
    return data.response;
}

async function calcularMediaUltimosJogos(teamId, headers, limit = 5) {
    const jogos = await getLastGames(teamId, headers, limit);

    let totalXG = 0;
    let totalXGA = 0;
    let totalPressure = 0;

    await Promise.all(
        jogos.map(async (jogo) => {
            const stats = await getStats(jogo.fixture.id, headers);

            const teamStats = stats.find(s => s.team.id === teamId);
            const opponentStats = stats.find(s => s.team.id !== teamId);

            const xg = calculateXG(teamStats);
            const xga = calculateXG(opponentStats);
            const pressure = calculatePressure(teamStats);

            totalXG += xg;
            totalXGA += xga;
            totalPressure += pressure;
        })
    );

    return {
        xG: totalXG / limit,
        xGA: totalXGA / limit,
        pressure: totalPressure / limit
    };
}

function aplicarPeso(last5, season10) {
    return {
        xG: (last5.xG * 0.7) + (season10.xG * 0.3),
        xGA: (last5.xGA * 0.7) + (season10.xGA * 0.3),
        pressure: (last5.pressure * 0.7) + (season10.pressure * 0.3)
    };
}

export async function buscarJogos(date) {

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
        .slice(0, 3); // limite proteção

    const resultadoFinal = [];

    for (let jogo of jogosFiltrados) {

        const homeId = jogo.teams.home.id;
        const awayId = jogo.teams.away.id;

        const last5Home = await calcularMediaUltimosJogos(homeId, headers, 5);
        const seasonHome = await calcularMediaUltimosJogos(homeId, headers, 10);

        const last5Away = await calcularMediaUltimosJogos(awayId, headers, 5);
        const seasonAway = await calcularMediaUltimosJogos(awayId, headers, 10);

        const homeFinal = aplicarPeso(last5Home, seasonHome);
        const awayFinal = aplicarPeso(last5Away, seasonAway);

        resultadoFinal.push({
            liga: jogo.league.name,
            jogo: `${jogo.teams.home.name} x ${jogo.teams.away.name}`,
            home: homeFinal,
            away: awayFinal
        });
    }

    return resultadoFinal;
}
