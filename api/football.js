// IDs oficiais das ligas no FotMob
const ALLOWED_LEAGUES = [
    47,   // Premier League
    87,   // La Liga
    55,   // Serie A
    54,   // Bundesliga
    53,   // Ligue 1
    130,  // Brasileirão Serie A
    42,   // Champions League
    73    // Europa League
];

const cachePorDia = new Map();
const cacheLast5 = new Map();

// 🔥 Função para criar uma pausa e não estourar proteções do site
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


// Finge ser um navegador real
const fotmobHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json"
};

// 🔥 NOVA FUNÇÃO: O "Túnel" AllOrigins (Mais focado em JSON)
async function fetchFotMobSeguro(urlOriginal) {
    // Usamos o AllOrigins no modo 'raw' para forçar a entrega do JSON puro
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(urlOriginal)}`;

    try {
        const res = await fetch(proxyUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        });

        const text = await res.text();

        try {
            return JSON.parse(text);
        } catch (parseError) {
            console.error("🚨 BLOQUEIO DETETADO! O site não devolveu JSON. Trecho da resposta:");
            console.error(text.substring(0, 150) + "...");
            return null;
        }
    } catch (fetchError) {
        console.error("🚨 Erro de conexão com o Proxy:", fetchError.message);
        return null;
    }
}

export async function buscarJogos(date) {

    if (cachePorDia.has(date)) {
        console.log("⚡ A retornar do cache do dia");
        return cachePorDia.get(date);
    }

    // O FotMob usa a data no formato YYYYMMDD (ex: 20260214)
    const dataFotMob = date.replace(/-/g, "");

    console.log(`🔎 A procurar jogos no FotMob para a data: ${dataFotMob}...`);

    // COLOQUE ISTO:
    const urlBusca = `https://www.fotmob.com/api/matches?date=${dataFotMob}`;
    const data = await fetchFotMobSeguro(urlBusca);

    if (!data || !data.leagues) {
        console.error("Falha ao puxar ligas. O JSON veio vazio ou bloqueado.");
        return [];
    }

    // LOG PARA VOCÊ VER COMO VEM O JSON DO FOTMOB (Limitado a 1000 caracteres para não travar o log)
    console.log("=== 📦 RAW JSON FOTMOB (LIGAS) ===");
    console.log(JSON.stringify(data.leagues || {}).substring(0, 1000) + "...\n==================================");

    if (!data.leagues) {
        console.error("Erro ao buscar jogos do dia no FotMob.");
        return [];
    }

    // Filtra apenas as ligas permitidas e extrai os jogos
    let jogosFiltrados = [];
    for (let league of data.leagues) {
        if (ALLOWED_LEAGUES.includes(league.primaryId)) {
            jogosFiltrados = jogosFiltrados.concat(league.matches);
        }
    }

    // Limita a 5 jogos para não sobrecarregar o servidor
    jogosFiltrados = jogosFiltrados.slice(0, 5);

    const resultadoFinal = [];

    for (let jogo of jogosFiltrados) {

        const homeId = jogo.home.id;
        const awayId = jogo.away.id;

        console.log(`\n⏳ A processar estatísticas para: ${jogo.home.name} vs ${jogo.away.name}...`);

        // Busca o histórico recente das equipas direto da página de detalhes das equipas do Fotmob
        const homeLast5 = await calcularMetricasEquipa(homeId);
        const awayLast5 = await calcularMetricasEquipa(awayId);

        if (!homeLast5 || !awayLast5) {
            console.warn(`⚠️ A saltar o jogo ${jogo.home.name} vs ${jogo.away.name} por falta de dados históricos.`);
            continue;
        }

        resultadoFinal.push({
            liga: jogo.leagueName || "Liga Premium",
            fixtureId: jogo.id,
            jogo: `${jogo.home.name} x ${jogo.away.name}`,
            home: homeLast5,
            away: awayLast5
        });
    }

    cachePorDia.set(date, resultadoFinal);

    console.log("\n===== 🧠 JSON FINAL ENVIADO AO MODELO (DEEPSEEK) =====");
    console.log(JSON.stringify(resultadoFinal, null, 2));
    console.log("========================================================\n");

    return resultadoFinal;
}

// =============================
// 🟢 EXTRAÇÃO DE MÉTRICAS FOTMOB
// =============================

async function calcularMetricasEquipa(teamId) {
    if (cacheLast5.has(teamId)) {
        return cacheLast5.get(teamId);
    }

    await delay(500); // ⏱️ Travão de segurança


    // COLOQUE ISTO:
    const urlEquipa = `https://www.fotmob.com/api/teams?id=${teamId}`;
    const data = await fetchFotMobSeguro(urlEquipa);

    if (!data || !data.fixtures || !data.fixtures.allFixtures) {
        return null;
    }

    if (!data || !data.fixtures || !data.fixtures.allFixtures) {
        return null;
    }

    // Pegar apenas os jogos já terminados e extrair os últimos 5
    const jogosTerminados = data.fixtures.allFixtures.filter(f => f.status.finished).slice(-5);

    if (jogosTerminados.length === 0) return null;

    let totalGolsPro = 0;
    let totalGolsContra = 0;
    let jogosValidos = 0;

    for (let jogo of jogosTerminados) {
        // Verifica se a equipa era a da casa (home) ou visitante (away) para somar os golos certos
        if (jogo.home.id === teamId) {
            totalGolsPro += jogo.home.score;
            totalGolsContra += jogo.away.score;
        } else {
            totalGolsPro += jogo.away.score;
            totalGolsContra += jogo.home.score;
        }
        jogosValidos++;
    }

    if (jogosValidos === 0) return null;

    // Como o FotMob exige navegação complexa para achar xG e Pressão exatos de jogos passados,
    // usamos uma aproximação baseada na conversão de golos reais e saldo para alimentar a IA de forma segura.
    const mediaGolsPro = totalGolsPro / jogosValidos;
    const mediaGolsContra = totalGolsContra / jogosValidos;

    const result = {
        // Simulador de xG baseado no desempenho real recente (Golos + Bónus de ataque)
        xG: mediaGolsPro * 1.15,
        xGA: mediaGolsContra * 1.10,
        // Simulador de pressão com base no domínio de saldo de golos
        pressure: 45 + (mediaGolsPro * 10) - (mediaGolsContra * 5)
    };

    cacheLast5.set(teamId, result);

    return result;
}