const ALLOWED_LEAGUES = [
    // --- Ligas Principais ---
    'eng.1',            // Premier League (Inglaterra)
    'esp.1',            // LaLiga (Espanha)
    'ita.1',            // Serie A (Itália)
    'ger.1',            // Bundesliga (Alemanha)
    'fra.1',            // Ligue 1 (França)
    'bra.1',            // Brasileirão Série A (Brasil)
    'por.1',            // Liga Portugal (Portugal)
    'tur.1',            // Süper Lig (Turquia)
    'sco.1',            // Scottish Premiership (Escócia)

    // --- Competições Continentais e Mundiais ---
    'uefa.champions',   // UEFA Champions League
    'fifa.world',       // Copa do Mundo da FIFA

    // --- Copas Nacionais (Knockout Cups) ---
    'eng.fa',           // FA Cup (Copa da Inglaterra)
    'esp.copa_del_rey', // Copa del Rey (Copa do Rei - Espanha)
    'fra.coupe_de_france', // Coupe de France (Copa da França)
    'ita.coppa_italia' // Coppa Italia (Copa da Itália)
];

const cachePorDia = new Map();
const cacheTeamStats = new Map();

export async function buscarJogos(date) {
    if (cachePorDia.has(date)) return cachePorDia.get(date);

    const dataESPN = date.replace(/-/g, "");
    console.log(`🔎 Sniper buscando Top 8 jogos e DESFALQUES para: ${dataESPN}...`);

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
    // Reduzido para 8 jogos para garantir que as 60+ chamadas de API caibam nos 10s da Vercel
    const jogosDoDia = resultadosLigas.flat().slice(0, 15);

    // MUDANÇA CHAVE: Promise.all no map para disparar todos os jogos ao mesmo tempo
    const promessasAnalise = jogosDoDia.map(async (jogo) => {
        const comp = jogo.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home').team;
        const away = comp.competitors.find(c => c.homeAway === 'away').team;
        const leagueSlug = jogo._leagueSlug;

        // Dispara a busca de home e away em paralelo
        const [homeStats, awayStats] = await Promise.all([
            getTeamMetrics(home.id, leagueSlug),
            getTeamMetrics(away.id, leagueSlug)
        ]);

        if (!homeStats || !awayStats) return null;

        return {
            liga: jogo._leagueName,
            fixtureId: jogo.id,
            jogo: `${home.name} x ${away.name}`,
            home: homeStats,
            away: awayStats
        };
    });

    const resultados = await Promise.all(promessasAnalise);
    const resultadoFinal = resultados.filter(j => j !== null);

    cachePorDia.set(date, resultadoFinal);
    console.log("\n===== 🧠 JSON COM DESFALQUES ENVIADO AO SNIPER =====");
    console.log(JSON.stringify(resultadoFinal, null, 2));
    return resultadoFinal;
}

// async function getTeamMetrics(teamId, leagueSlug) {
//     const key = `${teamId}-${leagueSlug}`;
//     if (cacheTeamStats.has(key)) return cacheTeamStats.get(key);

//     try {
//         // Mudança 1: Usamos blocos individuais ou Promise.all com catch para não quebrar tudo
//         const [resSchedule, resRoster] = await Promise.all([
//             fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`).then(r => r.json()).catch(() => ({})),
//             fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/roster`).then(r => r.json()).catch(() => ({}))
//         ]);

//         let desfalques = ["Informação de elenco indisponível"];

//         // Mudança 2: Verificação segura para não dar erro de "undefined"
//         if (resRoster && resRoster.athletes) {
//             const lista = resRoster.athletes
//                 .flatMap(pos => pos.items || [])
//                 .filter(player => player.injuries && player.injuries.length > 0)
//                 .map(player => `${player.displayName} (${player.injuries[0].status})`);

//             if (lista.length > 0) desfalques = lista;
//         }

//         const jogosEncerrados = (resSchedule.events || [])
//             .filter(e => e.competitions && e.competitions[0].status.type.completed)
//             .slice(-5);

//         if (jogosEncerrados.length === 0) return null;

//         let statsSomadas = { xG: 0, xGA: 0, cornersFor: 0, cornersAgainst: 0, pressure: 0 };
//         let jogosValidos = 0;

//         const promessasStats = jogosEncerrados.map(jogo =>
//             fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${jogo.id}`)
//                 .then(res => res.json()).catch(() => null)
//         );

//         const resumos = await Promise.all(promessasStats);

//         for (let resumo of resumos) {
//             if (!resumo || !resumo.boxscore || !resumo.boxscore.teams) continue;

//             const myTeam = resumo.boxscore.teams.find(t => t.team.id === teamId)?.statistics;
//             const oppTeam = resumo.boxscore.teams.find(t => t.team.id !== teamId)?.statistics;

//             if (!myTeam || !oppTeam) continue;

//             const getStat = (sArray, name) => {
//                 const s = sArray.find(x => x.name === name);
//                 return s ? parseFloat(s.displayValue) || 0 : 0;
//             };

//             let xg = getStat(myTeam, 'expectedGoals') || (getStat(myTeam, 'shotsOnTarget') * 0.3);
//             let xga = getStat(oppTeam, 'expectedGoals') || (getStat(oppTeam, 'shotsOnTarget') * 0.3);
//             let cornersF = getStat(myTeam, 'wonCorners');
//             let cornersA = getStat(oppTeam, 'wonCorners');

//             statsSomadas.xG += xg;
//             statsSomadas.xGA += xga;
//             statsSomadas.cornersFor += cornersF;
//             statsSomadas.cornersAgainst += cornersA;
//             statsSomadas.pressure += (cornersF * 0.4) + (getStat(myTeam, 'shotsOnTarget') * 0.3) + (getStat(myTeam, 'possessionPct') * 0.03);
//             jogosValidos++;
//         }

//         if (jogosValidos === 0) return null;

//         const metrics = {
//             xG: Number((statsSomadas.xG / jogosValidos).toFixed(2)),
//             xGA: Number((statsSomadas.xGA / jogosValidos).toFixed(2)),
//             escanteiosFavor: Number((statsSomadas.cornersFor / jogosValidos).toFixed(2)),
//             escanteiosContra: Number((statsSomadas.cornersAgainst / jogosValidos).toFixed(2)),
//             pressure: Number((statsSomadas.pressure / jogosValidos).toFixed(2)),
//             desfalques: desfalques
//         };

//         cacheTeamStats.set(key, metrics);
//         return metrics;

//     } catch (e) {
//         console.error("Erro ao buscar métricas:", e);
//         return null;
//     }
// }

async function getTeamMetrics(teamId, leagueSlug) {
    const key = `${teamId}-${leagueSlug}`;
    if (cacheTeamStats.has(key)) return cacheTeamStats.get(key);

    try {
        // Buscamos apenas o Schedule primeiro
        const resSchedule = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`);
        const dataSchedule = await resSchedule.json();

        const jogosEncerrados = (dataSchedule.events || [])
            .filter(e => e.competitions && e.competitions[0].status.type.completed)
            .slice(-5);

        if (jogosEncerrados.length === 0) return null;

        let statsSomadas = { xG: 0, xGA: 0, cornersFor: 0, cornersAgainst: 0, pressure: 0 };
        let jogosValidos = 0;
        let listaDesfalques = [];

        // Buscamos os resumos dos últimos jogos
        const promessasStats = jogosEncerrados.map(jogo =>
            fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${jogo.id}`)
                .then(res => res.json()).catch(() => null)
        );

        const resumos = await Promise.all(promessasStats);

        for (let resumo of resumos) {
            if (!resumo || !resumo.boxscore || !resumo.boxscore.teams) continue;

            // TENTATIVA DE PEGAR INJURIES NO SUMMARY (Mais estável que o Roster)
            if (resumo.injuries && resumo.injuries.length > 0) {
                resumo.injuries.forEach(inj => {
                    if (inj.team?.id === teamId) {
                        const nomes = inj.injuries.map(i => `${i.athlete.displayName} (${i.status})`);
                        listaDesfalques.push(...nomes);
                    }
                });
            }

            const myTeam = resumo.boxscore.teams.find(t => t.team.id === teamId)?.statistics;
            const oppTeam = resumo.boxscore.teams.find(t => t.team.id !== teamId)?.statistics;

            if (!myTeam || !oppTeam) continue;

            const getStat = (sArray, name) => {
                const s = sArray.find(x => x.name === name);
                return s ? parseFloat(s.displayValue) || 0 : 0;
            };

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

        // Limpar duplicatas de desfalques
        const desfalquesUnicos = [...new Set(listaDesfalques)];

        const metrics = {
            xG: Number((statsSomadas.xG / jogosValidos).toFixed(2)),
            xGA: Number((statsSomadas.xGA / jogosValidos).toFixed(2)),
            escanteiosFavor: Number((statsSomadas.cornersFor / jogosValidos).toFixed(2)),
            escanteiosContra: Number((statsSomadas.cornersAgainst / jogosValidos).toFixed(2)),
            pressure: Number((statsSomadas.pressure / jogosValidos).toFixed(2)),
            desfalques: desfalquesUnicos.length > 0 ? desfalquesUnicos : ["✅ Força Máxima ou Sem Informação de Lesão"]
        };

        cacheTeamStats.set(key, metrics);
        return metrics;
    } catch (e) { return null; }
}