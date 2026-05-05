import { buscarJogos } from './football.js';

// =====================================================================================
// SISTEMA DE OBTENÇÃO DAS ODDS EM MASSA
// =====================================================================================

const ODDS_API_KEY = process.env.ODDS_API_KEY?.trim();
const BASE_URL = "https://api.odds-api.io/v3";

if (!ODDS_API_KEY) {
    console.error("[oddsFetcher] ERRO: ODDS_API_KEY ausente. Configure no painel.");
}

async function safeFetch(url) {
    try {
        const resp = await fetch(url);
        const text = await resp.text(); 
        try { return JSON.parse(text); } catch (e) { return null; }
    } catch (err) { return null; }
}

function norm(str = "") {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// 🚀 PASSO 1: BUSCA TODAS AS ODDS DO DIA NA API
export async function obterOddsDoDia(dataAlvo, jogosESPN) {
    if (!ODDS_API_KEY) return [];

    console.log(`\n🎯 [Filtro Sniper] Buscando TODAS AS ODDS na odds-api.io para ${dataAlvo}...`);
    
    // Agora usamos a grade que o analyze.js já baixou, economizando segundos preciosos!
    if (!jogosESPN || jogosESPN.length === 0) return [];

    try {
        const urlEventos = `${BASE_URL}/events?sport=football&apiKey=${ODDS_API_KEY}`;
        const resEventos = await safeFetch(urlEventos);
        const listaEventos = Array.isArray(resEventos) ? resEventos : (resEventos?.data || []);

        if (listaEventos.length === 0) {
            console.log("⚠️ A API de odds não retornou nenhum jogo (Limite estourado ou sem eventos).");
        }

        const resultadoFinal = [];
        let matchCount = 0;

        for (const jogo of jogosESPN) {
            const espnHome = norm(jogo.homeTeam);
            const espnAway = norm(jogo.awayTeam);

            const eventoCorrespondente = listaEventos.find(ev => {
                const apiHome = norm(ev.home);
                const apiAway = norm(ev.away);
                return (apiHome.includes(espnHome) || espnHome.includes(apiHome)) && 
                       (apiAway.includes(espnAway) || espnAway.includes(apiAway));
            });

            if (eventoCorrespondente) {
                const urlOdds = `${BASE_URL}/odds?apiKey=${ODDS_API_KEY}&eventId=${eventoCorrespondente.id}&bookmakers=Betnacional,SportingBet`;
                const dadosOdds = await safeFetch(urlOdds);
                
                resultadoFinal.push({
                    ...jogo,
                    oddsApiId: eventoCorrespondente.id,
                    odds: dadosOdds ? (dadosOdds.bookmakers || dadosOdds) : null
                });
                matchCount++;
            } else {
                resultadoFinal.push({ ...jogo, odds: null });
            }
        }
        
        console.log(`✅ [Odds] Sucesso! ${matchCount} jogos cruzados com as casas de apostas.`);
        return resultadoFinal;
    } catch (erro) {
        console.error('\n❌ Falha no motor de odds:', erro.message);
        return [];
    }
}


// ===========================================================================
// MAPEAR MERCADOS E EXTRAIR (Turbinado e Blindado)
// ===========================================================================
function mapearMercado(card) {
    if (!card) return null;
    
    // 🔥 USAMOS norm() EM TUDO PARA ARRANCAR ACENTOS!
    const group = norm(card.group || '');
    
    const matchTarget = card.body.match(/\[TARGET\]\s*(.*?)\s*\|/i);
    const target = matchTarget ? norm(matchTarget[1]) : '';
    
    const matchOportunidade = card.body.match(/\[OPORTUNIDADE\]\s*(.*?)\s*\|/i);
    const oportunidade = matchOportunidade ? norm(matchOportunidade[1]) : '';

    const textoBusca = target + " " + oportunidade;

    // 🛑 1. BLOQUEIO IMEDIATO DE ESCANTEIOS (Protege o Over/Under de gols)
    if (group.includes('escanteios') || textoBusca.includes('escanteios')) {
        return { tipo: 'escanteios' }; // Retorna para cair no Indisponível com segurança
    }

    // ⚽ 2. MERCADO DE GOLS (Totals)
   // ⚽ 1. MERCADO DE GOLS (Totals)
    if (group.includes('mercado de gols') || textoBusca.includes('gols')) {
        
        // Palavras universais para OVER e UNDER (normalizadas)
        const isOver = textoBusca.includes('over') || textoBusca.includes('mais') || textoBusca.includes('acima');
        const isUnder = textoBusca.includes('under') || textoBusca.includes('menos') || textoBusca.includes('abaixo');
        
        // 🔥 BLINDAGEM DE LINHA: Procuramos especificamente por 0.5, 1.5, 2.5 ou 3.5
        const matchLinha = textoBusca.match(/(0\.5|1\.5|2\.5|3\.5)/);
        
        // Se a IA não citou a linha, usamos 2.5 como padrão (fallback)
        const linha = matchLinha ? parseFloat(matchLinha[1]) : 2.5;
        
        // Define o lado (over ou under) com base nas palavras encontradas
        let sideFinal = 'over'; // Padrão
        if (isUnder) sideFinal = 'under';
        if (isOver) sideFinal = 'over';

        return { market: 'Totals', line: linha, side: sideFinal, tipo: 'gols' };
    }

    // 🤝 3. AMBAS MARCAM (Both Teams To Score)
    if (group.includes('ambas marcam') || textoBusca.includes('btts')) {
        // Sem acento no "nao"
        const isNo = textoBusca.includes('nao') || textoBusca.includes('no');
        return { market: 'Both Teams To Score', side: isNo ? 'no' : 'yes', tipo: 'btts' };
    }

    // 🏆 4. RADAR DE VITÓRIAS E DUPLA CHANCE
    if (group.includes('radar de vitorias') || textoBusca.includes('vitoria') || textoBusca.includes('dupla chance') || textoBusca.includes('empate')) {
        if (textoBusca.includes('classifica')) return { tipo: 'especial' }; 
        
        if (textoBusca.includes('dupla chance') || textoBusca.includes('empate ou') || textoBusca.includes('ou empate')) {
            return { market: 'Double Chance', tipo: 'dupla_chance', textoBusca };
        }
        return { market: 'ML', tipo: 'vitoria', textoBusca };
    }
    
    return { market: 'ML', tipo: 'vitoria', textoBusca };
}

function extrairOddsBook(marketsArray, mapeado, card) {
    if (!marketsArray || !Array.isArray(marketsArray) || !mapeado) return null;
    try {
        // 🔥 norm() NOS TIMES PARA O MATCH BATER MESMO COM "ATLÉTICO" OU "GRÊMIO"
        const [rawHome, rawAway] = card.title.split(" vs ");
        const home = norm(rawHome.split(" (")[0] || "");
        const away = norm(rawAway.split(" (")[0] || "");
        
        if (mapeado.tipo === 'escanteios' || mapeado.tipo === 'especial') return null;

        const marketObj = marketsArray.find(m => m.name === mapeado.market);
        if (!marketObj || !marketObj.odds || !marketObj.odds[0]) return null;

        const odds = marketObj.odds[0];

        // --- AMBAS MARCAM ---
        if (mapeado.tipo === 'btts') {
            return mapeado.side === 'yes' ? odds.yes : odds.no;
        }

        // --- MERCADO DE GOLS ---
        if (mapeado.tipo === 'gols') {
            const oddMatch = marketObj.odds.find(o => o.hdp === mapeado.line) || marketObj.odds[0];
            return mapeado.side === 'over' ? oddMatch.over : oddMatch.under;
        }

        // --- VITÓRIA SECA (ML) ---
        if (mapeado.tipo === 'vitoria') {
            const tb = mapeado.textoBusca; // Já está normalizado sem acentos
            
            if (tb.includes('empate') || tb.includes('draw')) return odds.draw;
            
            if (tb.includes(home) || tb.includes('mandante') || tb.includes('casa')) return odds.home;
            if (tb.includes(away) || tb.includes('visitante') || tb.includes('fora')) return odds.away;
            
            const valores = [parseFloat(odds.home), parseFloat(odds.away)].filter(v => !isNaN(v));
            return valores.length ? Math.min(...valores).toFixed(2) : null;
        }

        // --- DUPLA CHANCE ---
        if (mapeado.tipo === 'dupla_chance') {
            const tb = mapeado.textoBusca;
            
            const falaDoMandante = tb.includes(home) || tb.includes('mandante') || tb.includes('casa');
            const falaDoVisitante = tb.includes(away) || tb.includes('visitante') || tb.includes('fora');

            if (falaDoMandante && !falaDoVisitante) return odds["1X"];
            if (falaDoVisitante && !falaDoMandante) return odds["X2"];
            
            return odds["12"]; 
        }

    } catch (e) { 
        return null; 
    }
    return null;
}


// 🚀 PASSO 2: FILTRO INSTANTÂNEO NA MEMÓRIA
export function buscarOddsParaCard(card, oddsDoDia) {
    // 🛑 Retorna NULL imediatamente se for Vermelha, Bilhete ou Abortado
    if (!card || card.flag === "VERMELHA" || card.group?.includes("BILHETE") || card.group?.includes("ABORTADOS")) {
        return null; 
    }

    const fallback = { sportingbet: "⚠️ Indisponível", betnacional: "⚠️ Indisponível" };

    try {
        const [home, away] = card.title.split(" vs ").map(t => t.split(" (")[0].trim());
        const h = norm(home);
        const a = norm(away);

        // Acha o jogo no Cache
        const jogoEncontrado = (oddsDoDia || []).find(jogo => {
            const jh = norm(jogo.homeTeam);
            const ja = norm(jogo.awayTeam);
            return (jh.includes(h) || h.includes(jh)) && (ja.includes(a) || a.includes(ja));
        });

        if (!jogoEncontrado || !jogoEncontrado.odds) return fallback;

        // O JSON gigante que você viu no Redis!
        const oddsObj = jogoEncontrado.odds;

        // Busca as casas de aposta lendo diretamente as chaves do objeto
        const keySB = Object.keys(oddsObj).find(k => k.toLowerCase().includes('sportingbet'));
        const keyBN = Object.keys(oddsObj).find(k => k.toLowerCase().includes('betnacional'));

        const mercadosSB = keySB ? oddsObj[keySB] : null;
        const mercadosBN = keyBN ? oddsObj[keyBN] : null;

        const mapeado = mapearMercado(card);

        // Extrai as odds dos arrays de mercado
        const valSB = mercadosSB ? extrairOddsBook(mercadosSB, mapeado, card) : null;
        const valBN = mercadosBN ? extrairOddsBook(mercadosBN, mapeado, card) : null;

        return {
            sportingbet: valSB || fallback.sportingbet,
            betnacional: valBN || fallback.betnacional
        };
    } catch (e) {
        console.error("Erro ao ler odds da memória:", e.message);
        return fallback;
    }
}