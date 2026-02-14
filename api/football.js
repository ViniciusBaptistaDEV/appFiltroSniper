const ALLOWED_LEAGUES = [
    'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'bra.1', 'por.1', 'uefa.champions'
];

const cachePorDia = new Map();
const cacheTeamStats = new Map();

export async function buscarJogos(date) {
    if (cachePorDia.has(date)) return cachePorDia.get(date);

    const dataESPN = date.replace(/-/g, "");
    console.log(`🔎 Puxando jogos e ESCANTEIOS da ESPN para: ${dataESPN}...`);

    const promessasLigas = ALLOWED_LEAGUES.map(league =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dataESPN}`)
            .then(res => res.json())
            .then(data => {
                if (!data.events) return [];
                return data.events.map(e => ({
                    ...e,
                    _leagueSlug: league,
                    _leagueName: data.leagues ? data.leagues[0].name : league
                }));
            })
            .catch(() => [])
    );

    const resultadosLigas = await Promise.all(promessasLigas);
    const jogosDoDia = resultadosLigas.flat().slice(0, 15); // Pente-fino de 15 jogos

    const resultadoFinal = [];

    for (let jogo of jogosDoDia) {
        const comp = jogo.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home').team;
        const away = comp.competitors.find(c => c.homeAway === 'away').team;
        const leagueSlug = jogo._leagueSlug;

        const homeStats = await getTeamMetrics(home.id, leagueSlug);
        const awayStats = await getTeamMetrics(away.id, leagueSlug);

        if (!homeStats || !awayStats) continue;

        resultadoFinal.push({
            liga: jogo._leagueName,
            fixtureId: jogo.id,
            jogo: `${home.name} x ${away.name}`,
            home: homeStats,
            away: awayStats
        });
    }

    cachePorDia.set(date, resultadoFinal);
    console.log("\n===== 🧠 JSON COM ESCANTEIOS ENVIADO AO DEEPSEEK =====");
    console.log(JSON.stringify(resultadoFinal, null, 2));
    return resultadoFinal;
}

async function getTeamMetrics(teamId, leagueSlug) {
    const key = `${teamId}-${leagueSlug}`;
    if (cacheTeamStats.has(key)) return cacheTeamStats.get(key);

    try {
        const resSchedule = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`);
        const dataSchedule = await resSchedule.json();

        const jogosEncerrados = (dataSchedule.events || [])
            .filter(e => e.competitions[0].status.type.completed)
            .slice(-5);

        if (jogosEncerrados.length === 0) return null;

        let statsSomadas = { xG: 0, xGA: 0, cornersFor: 0, cornersAgainst: 0, pressure: 0 };
        let jogosValidos = 0;

        const promessasStats = jogosEncerrados.map(jogo =>
            fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${jogo.id}`)
                .then(res => res.json()).catch(() => null)
        );

        const resumos = await Promise.all(promessasStats);

        for (let resumo of resumos) {
            if (!resumo || !resumo.boxscore || !resumo.boxscore.teams) continue;

            const myTeam = resumo.boxscore.teams.find(t => t.team.id === teamId)?.statistics;
            const oppTeam = resumo.boxscore.teams.find(t => t.team.id !== teamId)?.statistics;

            if (!myTeam || !oppTeam) continue;

            const getStat = (sArray, name) => {
                const s = sArray.find(x => x.name === name);
                return s ? parseFloat(s.displayValue) || 0 : 0;
            };

            // Coleta de dados reais
            let xg = getStat(myTeam, 'expectedGoals') || (getStat(myTeam, 'shotsOnTarget') * 0.3);
            let xga = getStat(oppTeam, 'expectedGoals') || (getStat(oppTeam, 'shotsOnTarget') * 0.3);
            let cornersF = getStat(myTeam, 'wonCorners');
            let cornersA = getStat(oppTeam, 'wonCorners');

            statsSomadas.xG += xg;
            statsSomadas.xGA += xga;
            statsSomadas.cornersFor += cornersF;
            statsSomadas.cornersAgainst += cornersA;
            statsSomadas.pressure += (cornersF * 0.4) + (getStat(myTeam, 'shotsOnTarget') * 0.3) + (getStat(myTeam, 'possessionPct') * 0.03);
            jogosValidos++;
        }

        if (jogosValidos === 0) return null;

        const metrics = {
            xG: Number((statsSomadas.xG / jogosValidos).toFixed(2)),
            xGA: Number((statsSomadas.xGA / jogosValidos).toFixed(2)),
            escanteiosFavor: Number((statsSomadas.cornersFor / jogosValidos).toFixed(2)),
            escanteiosContra: Number((statsSomadas.cornersAgainst / jogosValidos).toFixed(2)),
            pressure: Number((statsSomadas.pressure / jogosValidos).toFixed(2))
        };

        cacheTeamStats.set(key, metrics);
        return metrics;

    } catch (e) { return null; }
}