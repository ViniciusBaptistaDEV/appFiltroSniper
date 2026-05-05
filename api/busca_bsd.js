// api/busca_bsd.js
import fs from 'fs';
import path from 'path';

const cleanEnv = (key) => process.env[key]?.replace(/['"]/g, '').trim();

const BSD_API_KEY = cleanEnv('BSD_API_KEY');
const BASE_URL = 'https://sports.bzzoiro.com/api';

const round2 = (num) => (typeof num === 'number' && !isNaN(num)) ? parseFloat(num.toFixed(2)) : num;

const traduzirForma = (forma) => {
    if (!forma) return null;

    const traduzido = forma.split('').reverse().map(char => {
        if (char === 'W') return 'Vitória';
        if (char === 'D') return 'Empate';
        if (char === 'L') return 'Derrota';
        return char;
    }).join(' - ');

    // 🔥 PULO DO GATO: Explicando a direção do tempo para a IA
    return `(Mais antigo) ${traduzido} (Mais recente)`;
};

const getDicionario = () => {
    try {
        const filePath = path.join(process.cwd(), 'api', 'dicionario_times.json');
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.log("⚠️ Dicionário não encontrado. Usando nomes originais.");
        return {};
    }
};

const DICIONARIO = getDicionario();

async function fetchBSD(endpoint) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Token ${BSD_API_KEY}` },
            signal: AbortSignal.timeout(6000)
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        return null;
    }
}


async function calcularMetricasAvancadas(teamId) {

    const hoje = new Date();
    const sessentaDiasAtras = new Date(hoje.setDate(hoje.getDate() - 60)).toISOString().split('T')[0];

    const history = await fetchBSD(`/events/?team_id=${teamId}&status=finished&date_from=${sessentaDiasAtras}`);
    if (!history || !history.results || history.results.length === 0) return null;

    // Assim pegamos os 5 mais recentes!
    const ultimos5 = history.results.reverse().slice(0, 5);

    let somaXgRecente = 0, somaPSxG = 0, somaXgBolaParada = 0, somaEscanteios = 0, totalJogosValidos = 0;

    // 🔥 ADICIONE ISTO 1: A variável para guardar os resultados
    const lista_jogos_recentes = [];

    for (const jogo of ultimos5) {
        const detalhes = await fetchBSD(`/events/${jogo.id}/?full=true`);
        if (!detalhes) continue;

        lista_jogos_recentes.unshift({ // 🔥 Troque push por unshift
            torneio: jogo.league?.name || "Desconhecido",
            placar: `${jogo.home_team_obj?.name || "Casa"} ${jogo.home_score ?? '-'} x ${jogo.away_score ?? '-'} ${jogo.away_team_obj?.name || "Fora"}`
        });

        const isHome = detalhes.home_team_obj.id === teamId;
        somaXgRecente += (isHome ? detalhes.actual_home_xg : detalhes.actual_away_xg) || 0;

        let escanteiosDesteJogo = 0;

        if (detalhes.shotmap) {
            detalhes.shotmap.filter(shot => shot.home === isHome).forEach(shot => {
                if (shot.xgot) somaPSxG += shot.xgot;
                if (shot.sit === 'corner' || shot.sit === 'free-kick') somaXgBolaParada += (shot.xg || 0);
                if (shot.sit === 'corner') escanteiosDesteJogo++;
            });
        }
        somaEscanteios += escanteiosDesteJogo;
        totalJogosValidos++;
    }

    const div = totalJogosValidos || 1;
    return {
        xg_recent_avg: round2(somaXgRecente / div),
        psxg_recent_avg: round2(somaPSxG / div),
        xg_set_piece_avg: round2(somaXgBolaParada / div),
        media_escanteios_recentes: round2(somaEscanteios / div), // Nova métrica salva aqui
        sample_size: totalJogosValidos,
        historico_resultados_geral: lista_jogos_recentes
    };
}

// 🔥 NOVA FUNÇÃO: Busca dados isolados de Casa ou Fora sem mexer no motor principal
async function calcularMetricasSplitCasaFora(teamId, isHomeTeam) {
    const hoje = new Date();
    // 120 dias garantem que acharemos pelo menos 5 jogos na condição específica (casa ou fora)
    const janelaDias = new Date(hoje.setDate(hoje.getDate() - 120)).toISOString().split('T')[0];

    const history = await fetchBSD(`/events/?team_id=${teamId}&status=finished&date_from=${janelaDias}`);
    if (!history || !history.results || history.results.length === 0) return null;

    // Filtra a lista da API: Pega só jogos em casa (se isHomeTeam for true) ou só fora (se false)
    const jogosFiltrados = history.results.filter(jogo => {
        if (isHomeTeam) {
            // 🔥 ESCUDO ADICIONADO: Copiando a lógica segura da função anterior
            return jogo.home_team_obj?.id === teamId;
        } else {
            // 🔥 ESCUDO ADICIONADO
            return jogo.away_team_obj?.id === teamId;
        }
    });

    // Inverte para pegar os mais novos e corta nos 5 primeiros
    const ultimos5 = jogosFiltrados.reverse().slice(0, 5);

    let somaXg = 0, validos = 0;

    for (const jogo of ultimos5) {
        const detalhes = await fetchBSD(`/events/${jogo.id}/?full=true`);
        if (!detalhes) continue;

        const xgDoJogo = isHomeTeam ? detalhes.actual_home_xg : detalhes.actual_away_xg;

        if (xgDoJogo !== undefined && xgDoJogo !== null) {
            somaXg += xgDoJogo;
            validos++;
        }
    }

    return validos > 0 ? round2(somaXg / validos) : null;
}


export async function buscarDadosMatematicosBSD(game) {

    try {
        const homeTraduzido = DICIONARIO[game.homeTeam.toLowerCase()] || game.homeTeam;
        const awayTraduzido = DICIONARIO[game.awayTeam.toLowerCase()] || game.awayTeam;

        // Cria o objeto de data real a partir da string UTC da ESPN
        const dataObj = new Date(game.kickoff);

        // Converte a data para o fuso do Brasil e extrai no formato exato da BSD (YYYY-MM-DD)
        // 'en-CA' é usado aqui porque é o padrão oficial para extrair datas com traços (YYYY-MM-DD)
        const dateStr = dataObj.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        // 🛡️ TRAVA 1 CORRIGIDA: Envia o nome INTEIRO codificado para a URL
        let search = await fetchBSD(`/events/?date_from=${dateStr}&date_to=${dateStr}&team=${encodeURIComponent(homeTraduzido)}&tz=America/Sao_Paulo`);

        if (!search?.results || search.results.length === 0) {
            search = await fetchBSD(`/events/?date_from=${dateStr}&date_to=${dateStr}&team=${encodeURIComponent(awayTraduzido)}&tz=America/Sao_Paulo`);
        }

        if (!search?.results || search.results.length === 0) return null;

        // 🛡️ TRAVA 2 CORRIGIDA: Varre a lista toda para achar o jogo exato
        const homeBuscado = homeTraduzido.toLowerCase();
        const awayBuscado = awayTraduzido.toLowerCase();

        const bsdMatch = search.results.find(jogo => {
            const hApi = jogo.home_team_obj.name.toLowerCase();
            const aApi = jogo.away_team_obj.name.toLowerCase();

            const mandanteBate = hApi.includes(homeBuscado) || homeBuscado.includes(hApi);
            const visitanteBate = aApi.includes(awayBuscado) || awayBuscado.includes(aApi);

            return mandanteBate && visitanteBate; // 🔥 Aqui é && (Ambos têm que ser verdadeiros)
        });

        // Se não achou o jogo certo na lista, aborta
        if (!bsdMatch) return null;

        const eventId = bsdMatch.id;
        const homeId = bsdMatch.home_team_obj.id;
        const awayId = bsdMatch.away_team_obj.id;
        const leagueId = bsdMatch.league.id; // 🔥 NOVO: Pegando o ID da Liga

        // ✅ CORREÇÃO 1: Nomes das variáveis ajustadas para metricsHome e metricsAway
        const [detalhes, homeM, awayM, metricsHome, metricsAway, standingsData, contextoV2, xgSplitHome, xgSplitAway] = await Promise.all([
            fetchBSD(`/events/${eventId}/?full=true`),
            fetchBSD(`/managers/?team_id=${homeId}`),
            fetchBSD(`/managers/?team_id=${awayId}`),
            calcularMetricasAvancadas(homeId),
            calcularMetricasAvancadas(awayId),
            fetchBSD(`/leagues/${leagueId}/standings/`),
            fetchBSD(`/v2/events/${eventId}/`), // 🔥 NOVO: V2 (Apenas para contexto externo)
            calcularMetricasSplitCasaFora(homeId, true),
            calcularMetricasSplitCasaFora(awayId, false)
        ]);

        if (!detalhes) return null;

        // 🔥 NOVO: SEGUNDO MOTOR (V2) - Buscando o Contexto Frio e Preciso
        const [eventoV2, oddsV2, metadataV2, lineupsV2] = await Promise.all([
            fetchBSD(`/v2/events/${eventId}/`),
            fetchBSD(`/v2/events/${eventId}/odds/`),
            fetchBSD(`/v2/events/${eventId}/metadata/`),
            fetchBSD(`/v2/events/${eventId}/lineups/`)
        ]);

        // 🔥 NOVO: Buscando dados matemáticos do Árbitro se o ID dele existir
        let arbitroV2 = null;
        if (eventoV2 && eventoV2.referee_id) {
            arbitroV2 = await fetchBSD(`/v2/referees/${eventoV2.referee_id}/`);
        }

        // 🔥 NOVO: Filtramos o array de standings para achar exatamente os dois times
        const classifHome = standingsData?.standings?.find(t => t.team_id === homeId) || {};
        const classifAway = standingsData?.standings?.find(t => t.team_id === awayId) || {};

        const h2h = detalhes.head_to_head || {};
        const limiteAno = new Date().getFullYear() - 2;
        const recentMatches = (h2h.recent_matches || [])
            .filter(m => new Date(m.date).getFullYear() >= limiteAno)
            .slice(0, 4);

        // ✅ CORREÇÃO 2: Cálculo do xG por chute que faltava
        const calcXgPerShot = (xg, shots) => round2((xg || 0) / (shots || 1));

        return {
            id_evento: eventId,
            confronto: `${bsdMatch.home_team_obj.name} vs ${bsdMatch.away_team_obj.name}`,
            liga: detalhes.league?.name || "Competição Internacional ou Copa",

            // 🔥 AJUSTE NA RODADA: Deixa claro que pode ser a rodada do campeonato ou da temporada
            fase_ou_rodada: detalhes.round_number ? `Rodada/Semana ${detalhes.round_number}` : "Fase de Mata-Mata",

            // 🔥 NOVO: Dados de Contexto (Árbitro e Desfalques)
            contexto_do_jogo: {
                // Fatores de Jogo
                classico_local_derby: eventoV2?.is_local_derby || false,
                campo_neutro: eventoV2?.is_neutral_ground || false,
                distancia_viagem_visitante_km: eventoV2?.travel_distance_km || 0,
                clima_partida: eventoV2?.weather?.description || "Desconhecido",
                condicao_gramado_nivel: eventoV2?.pitch_condition || "Desconhecido", // 1 (Ótimo) a 5 (Péssimo)

                // Árbitro Matemático
                arbitro: {
                    nome: arbitroV2?.name || (detalhes.referee ? detalhes.referee.name : "N/A"),
                    media_cartoes_amarelos: arbitroV2?.avg_yellow_per_match ?? "Sem dados",
                    media_cartoes_vermelhos: arbitroV2?.avg_red_per_match ?? "Sem dados",
                    media_faltas_marcadas: arbitroV2?.avg_fouls_per_match ?? "Sem dados",
                },

                // Mercado de Apostas (Consenso)
                odds_consenso: {
                    vitoria_mandante: oddsV2?.odds?.home_win || "Desconhecido",
                    empate: oddsV2?.odds?.draw || "Desconhecido",
                    vitoria_visitante: oddsV2?.odds?.away_win || "Desconhecido",
                    over_25_gols: oddsV2?.odds?.over_25_goals || "Desconhecido",
                    under_25_gols: oddsV2?.odds?.under_25_goals || "Desconhecido",
                    ambas_marcam_sim: oddsV2?.odds?.btts_yes || "Desconhecido",
                },

                // Desfalques Reais
                desfalques_confirmados: {
                    mandante: lineupsV2?.unavailable_players?.home?.map(p => `${p.name} (${p.reason})`) || [],
                    visitante: lineupsV2?.unavailable_players?.away?.map(p => `${p.name} (${p.reason})`) || []
                },

                // Fatos Relevantes (Apenas as sentenças matemáticas)
                fatos_historicos_pre_jogo: metadataV2?.trivia?.map(t => t.sentence) || []

            },

            estatisticas_temporada: {
                mandante: {

                    // 🔥 NOVO: DADOS DA TABELA DE CLASSIFICAÇÃO
                    base_dos_dados: `Tabela da ${detalhes.league?.name || "Competição Atual"}`,
                    posicao_nesta_competicao: classifHome.position || "Desconhecido",
                    pontos_nesta_competicao: classifHome.pts || "Desconhecido",
                    forma_recente_nesta_competicao: traduzirForma(classifHome.form) || "Desconhecido",
                    saldo_gols_nesta_competicao: classifHome.gd || "Desconhecido",

                    // 🔥 NOVO: DADOS TÁTICOS
                    formacao_preferida: detalhes.home_coach?.preferred_formation || "Desconhecido",

                    // DADOS GERAIS DA TEMPORADA
                    media_gols_marcados_temporada: round2(detalhes.home_form?.avg_goals_scored),
                    media_gols_sofridos_temporada: round2(detalhes.home_form?.avg_goals_conceded),
                    media_xg_criado_temporada: round2(detalhes.home_form?.avg_xg),
                    media_xg_concedido_temporada: round2(detalhes.home_form?.avg_xg_conceded),
                    media_finalizacoes_por_jogo: round2(detalhes.home_form?.avg_shots),
                    media_chutes_no_gol_por_jogo: round2(detalhes.home_form?.avg_shots_on_target),
                    xg_por_chute_eficiencia: calcXgPerShot(detalhes.home_form?.avg_xg, detalhes.home_form?.avg_shots),

                    // DADOS ESPECÍFICOS DO TREINADOR ATUAL (Crucial para a IA entender o peso)
                    btts_pct_com_treinador_atual: `${round2(homeM?.results?.[0]?.btts_pct)}%`,
                    clean_sheet_pct_com_treinador_atual: `${round2(homeM?.results?.[0]?.clean_sheet_pct)}%`,
                    over_25_pct_com_treinador_atual: `${round2(homeM?.results?.[0]?.over_25_pct)}%`,
                    media_posse_bola_treinador_atual: `${round2(homeM?.results?.[0]?.avg_possession)}%`,
                    // A linha falsa de escanteios do treinador foi removida daqui

                    // MÉTRICAS AVANÇADAS RECENTES (Últimos 5 jogos)
                    xg_medio_ultimos_5_jogos_gerais: metricsHome?.xg_recent_avg,
                    xg_medio_ultimos_5_jogos_como_mandante: xgSplitHome,
                    psxg_qualidade_chutes_medio_ultimos_5_jogos: metricsHome?.psxg_recent_avg,
                    xg_bola_parada_e_escanteios: metricsHome?.xg_set_piece_avg,
                    media_escanteios_perigosos_recentes: metricsHome?.media_escanteios_recentes, // Dados reais da equipe inseridos aqui
                    tamanho_amostra_jogos_recentes: metricsHome?.sample_size,
                    ultimos_jogos_gerais_todas_competicoes: metricsHome?.historico_resultados_geral || [] // 🔥 AQUI

                },

                visitante: {

                    // 🔥 NOVO: DADOS DA TABELA DE CLASSIFICAÇÃO
                    base_dos_dados: `Tabela da ${detalhes.league?.name || "Competição Atual"}`,
                    posicao_nesta_competicao: classifAway.position || "Desconhecido",
                    pontos_nesta_competicao: classifAway.pts || "Desconhecido",
                    forma_recente_nesta_competicao: traduzirForma(classifAway.form) || "Desconhecido",
                    saldo_gols_nesta_competicao: classifAway.gd || "Desconhecido",

                    // 🔥 NOVO: DADOS TÁTICOS
                    formacao_preferida: detalhes.away_coach?.preferred_formation || "Desconhecido",

                    // DADOS GERAIS DA TEMPORADA
                    media_gols_marcados_temporada: round2(detalhes.away_form?.avg_goals_scored),
                    media_gols_sofridos_temporada: round2(detalhes.away_form?.avg_goals_conceded),
                    media_xg_criado_temporada: round2(detalhes.away_form?.avg_xg),
                    media_xg_concedido_temporada: round2(detalhes.away_form?.avg_xg_conceded),
                    media_finalizacoes_por_jogo: round2(detalhes.away_form?.avg_shots),
                    media_chutes_no_gol_por_jogo: round2(detalhes.away_form?.avg_shots_on_target),
                    xg_por_chute_eficiencia: calcXgPerShot(detalhes.away_form?.avg_xg, detalhes.away_form?.avg_shots),

                    // DADOS ESPECÍFICOS DO TREINADOR ATUAL (Crucial para a IA entender o peso)
                    btts_pct_com_treinador_atual: `${round2(awayM?.results?.[0]?.btts_pct)}%`,
                    clean_sheet_pct_com_treinador_atual: `${round2(awayM?.results?.[0]?.clean_sheet_pct)}%`,
                    over_25_pct_com_treinador_atual: `${round2(awayM?.results?.[0]?.over_25_pct)}%`,
                    media_posse_bola_treinador_atual: `${round2(awayM?.results?.[0]?.avg_possession)}%`,

                    // MÉTRICAS AVANÇADAS RECENTES (Últimos 5 jogos)
                    xg_medio_ultimos_5_jogos_gerais: metricsAway?.xg_recent_avg,
                    xg_medio_ultimos_5_jogos_como_visitante: xgSplitAway,
                    psxg_qualidade_chutes_medio_ultimos_5_jogos: metricsAway?.psxg_recent_avg,
                    xg_bola_parada_e_escanteios: metricsAway?.xg_set_piece_avg,
                    media_escanteios_perigosos_recentes: metricsAway?.media_escanteios_recentes, // Dados reais da equipe inseridos aqui
                    tamanho_amostra_jogos_recentes: metricsAway?.sample_size,
                    ultimos_jogos_gerais_todas_competicoes: metricsAway?.historico_resultados_geral || [] // 🔥 AQUI
                }
            },

            analise_h2h: {
                media_gols_confronto_direto: round2(h2h.avg_total_goals),
                vitorias_mandante_pct_historico: `${round2((h2h.home_win_rate || 0) * 100)}%`,
                vitorias_visitante_pct_historico: `${round2((h2h.away_win_rate || 0) * 100)}%`,
                empates_pct_historico: `${round2((h2h.draw_rate || 0) * 100)}%`, // Adicionei o * 100 aqui que faltava
                total_jogos_historico_analisados: h2h.total_matches,
                ultimos_jogos_diretos_2_anos: recentMatches
            }
        };

    } catch (e) {
        console.error("🚨 ERRO CRÍTICO NO MOTOR BSD:", e);
        return null;
    }
    
}