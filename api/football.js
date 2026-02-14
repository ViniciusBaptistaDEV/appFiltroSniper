// Os identificadores (Slugs) oficiais das ligas na API da ESPN
const ALLOWED_LEAGUES = [
    'eng.1',   // Premier League
    'esp.1',   // La Liga
    'ita.1',   // Serie A
    'ger.1',   // Bundesliga
    'fra.1',   // Ligue 1
    'bra.1',   // Brasileirão
    'por.1',   // Primeira Liga Portugal
    'uefa.champions' // Champions League
];

const cachePorDia = new Map();
const cacheTeamStats = new Map();

export async function buscarJogos(date) {

    if (cachePorDia.has(date)) {
        console.log("⚡ A retornar do cache do dia");
        return cachePorDia.get(date);
    }

    // A ESPN exige a data no formato YYYYMMDD (Ex: 20260214)
    const dataESPN = date.replace(/-/g, "");
    console.log(`🔎 A procurar jogos na ESPN para a data: ${dataESPN}...`);

    // Busca simultânea em todas as ligas para não causar Timeout na Vercel
    const promessasLigas = ALLOWED_LEAGUES.map(league =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dataESPN}`)
            .then(res => res.json())
            .then(data => {
                if (!data.events) return [];
                // Injetamos o nome e o slug da liga em cada jogo para facilitar a formatação
                return data.events.map(e => ({
                    ...e,
                    _leagueSlug: league,
                    _leagueName: data.leagues ? data.leagues[0].name : league
                }));
            })
            .catch(() => []) // Se uma liga não tiver jogos, ignora sem quebrar o código
    );

    const resultadosLigas = await Promise.all(promessasLigas);

    // Junta todos os jogos encontrados e limita a 5 para poupar os créditos da sua IA
    const jogosDoDia = resultadosLigas.flat().slice(0, 5);

    const resultadoFinal = [];

    for (let jogo of jogosDoDia) {

        const comp = jogo.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home').team;
        const away = comp.competitors.find(c => c.homeAway === 'away').team;
        const leagueSlug = jogo._leagueSlug;

        console.log(`\n⏳ A extrair Raio-X exato de: ${home.name} vs ${away.name}...`);

        // Puxa as estatísticas avançadas (xG real) dos últimos 5 jogos de cada equipa
        const homeStats = await getTeamMetrics(home.id, leagueSlug);
        const awayStats = await getTeamMetrics(away.id, leagueSlug);

        // A TRAVA DE SEGURANÇA: Se a ESPN não tiver o xG de alguma equipa, abortamos este jogo
        if (!homeStats || !awayStats) {
            console.warn(`⚠️ A saltar o jogo ${home.name} vs ${away.name} por falta de métricas avançadas (xG).`);
            continue;
        }

        resultadoFinal.push({
            liga: jogo._leagueName,
            fixtureId: jogo.id,
            jogo: `${home.name} x ${away.name}`,
            home: homeStats,
            away: awayStats
        });
    }

    cachePorDia.set(date, resultadoFinal);

    console.log("\n===== 🧠 JSON FINAL ENVIADO AO DEEPSEEK =====");
    console.log(JSON.stringify(resultadoFinal, null, 2));
    console.log("=================================================");

    return resultadoFinal;
}

// =============================
// 🟢 O MOTOR DE ESTATÍSTICAS DA ESPN (xG e Pressão Real)
// =============================

async function getTeamMetrics(teamId, leagueSlug) {
    const key = `${teamId}-${leagueSlug}`;
    if (cacheTeamStats.has(key)) return cacheTeamStats.get(key);

    try {
        // 1. Puxamos o calendário completo da equipa nesta liga
        const resSchedule = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`);
        const dataSchedule = await resSchedule.json();

        // Filtramos apenas os jogos já terminados e pegamos nos últimos 5
        const jogosEncerrados = (dataSchedule.events || [])
            .filter(e => e.competitions[0].status.type.completed)
            .slice(-5);

        if (jogosEncerrados.length === 0) return null;

        let totalXG = 0, totalXGA = 0, totalPressure = 0;
        let jogosValidos = 0;

        // 2. Extração em Paralelo: Puxa o resumo estatístico detalhado de todos os 5 jogos ao mesmo tempo
        const promessasStats = jogosEncerrados.map(jogo =>
            fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${jogo.id}`)
                .then(res => res.json())
                .catch(() => null)
        );

        const resumos = await Promise.all(promessasStats);

        for (let resumo of resumos) {
            if (!resumo || !resumo.boxscore || !resumo.boxscore.teams) continue;

            const myTeamStats = resumo.boxscore.teams.find(t => t.team.id === teamId)?.statistics;
            const oppTeamStats = resumo.boxscore.teams.find(t => t.team.id !== teamId)?.statistics;

            if (!myTeamStats || !oppTeamStats) continue;

            // Função ajudante para encontrar os números no array da ESPN
            const getStat = (statsArray, statName) => {
                const stat = statsArray.find(s => s.name === statName);
                return stat ? parseFloat(stat.displayValue) || 0 : 0;
            };

            // A MÁGICA: Obtemos o 'Expected Goals' oficial do jogo!
            let xg = getStat(myTeamStats, 'expectedGoals');
            let xga = getStat(oppTeamStats, 'expectedGoals');

            // Fallback de segurança: se for uma taça menor e a ESPN não fornecer o xG, calculamos nós com base nos remates à baliza
            if (xg === 0) xg = getStat(myTeamStats, 'shotsOnTarget') * 0.35;
            if (xga === 0) xga = getStat(oppTeamStats, 'shotsOnTarget') * 0.35;

            // Cálculo da métrica de pressão com os números REAIS do jogo
            const pressure = (getStat(myTeamStats, 'wonCorners') * 0.4) +
                (getStat(myTeamStats, 'shotsOnTarget') * 0.3) +
                (getStat(myTeamStats, 'possessionPct') * 0.03);

            totalXG += xg;
            totalXGA += xga;
            totalPressure += pressure;
            jogosValidos++;
        }

        if (jogosValidos === 0) return null;

        const finalMetrics = {
            xG: Number((totalXG / jogosValidos).toFixed(2)),
            xGA: Number((totalXGA / jogosValidos).toFixed(2)),
            pressure: Number((totalPressure / jogosValidos).toFixed(2))
        };

        cacheTeamStats.set(key, finalMetrics);
        return finalMetrics;

    } catch (error) {
        console.error(`🚨 Erro ao extrair métricas exatas da equipa ${teamId}:`, error.message);
        return null;
    }
}