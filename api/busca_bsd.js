// api/busca_bsd.js
import fs from 'fs';
import path from 'path';

const cleanEnv = (key) => process.env[key]?.replace(/['"]/g, '').trim();

const BSD_API_KEY = cleanEnv('BSD_API_KEY');
const BASE_URL = 'https://sports.bzzoiro.com/api';

const round2 = (num) => (typeof num === 'number' && !isNaN(num)) ? parseFloat(num.toFixed(2)) : num;

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

    const ultimos5 = history.results.slice(0, 5);
    let somaXgRecente = 0, somaPSxG = 0, somaXgBolaParada = 0, totalJogosValidos = 0;

    for (const jogo of ultimos5) {
        const detalhes = await fetchBSD(`/events/${jogo.id}/?full=true`);
        if (!detalhes) continue;

        const isHome = detalhes.home_team_obj.id === teamId;
        somaXgRecente += (isHome ? detalhes.actual_home_xg : detalhes.actual_away_xg) || 0;

        if (detalhes.shotmap) {
            detalhes.shotmap.filter(shot => shot.home === isHome).forEach(shot => {
                if (shot.xgot) somaPSxG += shot.xgot;
                if (shot.sit === 'corner' || shot.sit === 'free-kick') somaXgBolaParada += (shot.xg || 0);
            });
        }
        totalJogosValidos++;
    }

    const div = totalJogosValidos || 1;
    return {
        xg_recent_avg: round2(somaXgRecente / div),
        psxg_recent_total: round2(somaPSxG),
        xg_set_piece_avg: round2(somaXgBolaParada / div),
        sample_size: totalJogosValidos
    };
}

export async function buscarDadosMatematicosBSD(game) {
    try {
        const homeTraduzido = DICIONARIO[game.homeTeam.toLowerCase()] || game.homeTeam;
        const awayTraduzido = DICIONARIO[game.awayTeam.toLowerCase()] || game.awayTeam;
        const dateStr = game.kickoff.split('T')[0];

        // 🛡️ TRAVA 1 CORRIGIDA: Envia o nome INTEIRO codificado para a URL
        let search = await fetchBSD(`/events/?date_from=${dateStr}&date_to=${dateStr}&team=${encodeURIComponent(homeTraduzido)}`);

        if (!search?.results || search.results.length === 0) {
            search = await fetchBSD(`/events/?date_from=${dateStr}&date_to=${dateStr}&team=${encodeURIComponent(awayTraduzido)}`);
        }

        if (!search?.results || search.results.length === 0) return null;

        // 🛡️ TRAVA 2 CORRIGIDA: Varre a lista toda para achar o jogo exato
        const homeBuscado = homeTraduzido.toLowerCase();
        const awayBuscado = awayTraduzido.toLowerCase();

        const bsdMatch = search.results.find(jogo =>
            jogo.home_team_obj.name.toLowerCase() === homeBuscado ||
            jogo.away_team_obj.name.toLowerCase() === awayBuscado ||
            jogo.home_team_obj.name.toLowerCase().includes(homeBuscado) ||
            jogo.away_team_obj.name.toLowerCase().includes(awayBuscado)
        );

        // Se não achou o jogo certo na lista, aborta
        if (!bsdMatch) return null;

        const eventId = bsdMatch.id;
        const homeId = bsdMatch.home_team_obj.id;
        const awayId = bsdMatch.away_team_obj.id;

        // ✅ CORREÇÃO 1: Nomes das variáveis ajustadas para metricsHome e metricsAway
        const [detalhes, homeM, awayM, metricsHome, metricsAway] = await Promise.all([
            fetchBSD(`/events/${eventId}/?full=true`),
            fetchBSD(`/managers/?team_id=${homeId}`),
            fetchBSD(`/managers/?team_id=${awayId}`),
            calcularMetricasAvancadas(homeId),
            calcularMetricasAvancadas(awayId)
        ]);

        if (!detalhes) return null;

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
            liga: detalhes.league_obj?.name,

            estatisticas_temporada: {
                mandante: {
                    // DADOS GERAIS DA TEMPORADA
                    media_gols_marcados_temporada: round2(detalhes.home_form?.avg_goals_scored),
                    media_gols_sofridos_temporada: round2(detalhes.home_form?.avg_goals_conceded),
                    media_xg_criado_temporada: round2(detalhes.home_form?.avg_xg),
                    media_xg_concedido_temporada: round2(detalhes.home_form?.avg_xg_conceded),
                    media_finalizacoes_por_jogo: round2(detalhes.home_form?.avg_shots),
                    media_chutes_no_gol_por_jogo: round2(detalhes.home_form?.avg_shots_on_target),
                    xg_por_chute_eficiencia: calcXgPerShot(detalhes.home_form?.avg_xg, detalhes.home_form?.avg_shots),

                    // DADOS ESPECÍFICOS DO TREINADOR ATUAL (Crucial para a IA entender o peso)
                    btts_pct_com_treinador_atual: round2(homeM?.results?.[0]?.btts_pct),
                    clean_sheet_pct_com_treinador_atual: round2(homeM?.results?.[0]?.clean_sheet_pct),
                    over_25_pct_com_treinador_atual: round2(homeM?.results?.[0]?.over_25_pct),
                    media_posse_bola_treinador_atual: round2(homeM?.results?.[0]?.avg_possession),
                    media_escanteios_por_jogo: round2(homeM?.results?.[0]?.avg_corners),

                    // MÉTRICAS AVANÇADAS RECENTES (Últimos 5 jogos)
                    xg_medio_ultimos_5_jogos: metricsHome?.xg_recent_avg,
                    psxg_qualidade_chutes_ultimos_5_jogos: metricsHome?.psxg_recent_total,
                    xg_bola_parada_e_escanteios: metricsHome?.xg_set_piece_avg,
                    tamanho_amostra_jogos_recentes: metricsHome?.sample_size
                },
                visitante: {
                    media_gols_marcados_temporada: round2(detalhes.away_form?.avg_goals_scored),
                    media_gols_sofridos_temporada: round2(detalhes.away_form?.avg_goals_conceded),
                    media_xg_criado_temporada: round2(detalhes.away_form?.avg_xg),
                    media_xg_concedido_temporada: round2(detalhes.away_form?.avg_xg_conceded),
                    media_finalizacoes_por_jogo: round2(detalhes.away_form?.avg_shots),
                    media_chutes_no_gol_por_jogo: round2(detalhes.away_form?.avg_shots_on_target),
                    xg_por_chute_eficiencia: calcXgPerShot(detalhes.away_form?.avg_xg, detalhes.away_form?.avg_shots),

                    btts_pct_com_treinador_atual: round2(awayM?.results?.[0]?.btts_pct),
                    clean_sheet_pct_com_treinador_atual: round2(awayM?.results?.[0]?.clean_sheet_pct),
                    over_25_pct_com_treinador_atual: round2(awayM?.results?.[0]?.over_25_pct),
                    media_posse_bola_treinador_atual: round2(awayM?.results?.[0]?.avg_possession),
                    media_escanteios_por_jogo: round2(awayM?.results?.[0]?.avg_corners),

                    xg_medio_ultimos_5_jogos: metricsAway?.xg_recent_avg,
                    psxg_qualidade_chutes_ultimos_5_jogos: metricsAway?.psxg_recent_total,
                    xg_bola_parada_e_escanteios: metricsAway?.xg_set_piece_avg,
                    tamanho_amostra_jogos_recentes: metricsAway?.sample_size
                }
            },

            analise_h2h: {
                media_gols_confronto_direto: round2(h2h.avg_total_goals),
                vitorias_mandante_pct_historico: round2(h2h.home_win_rate),
                vitorias_visitante_pct_historico: round2(h2h.away_win_rate),
                empates_pct_historico: round2(h2h.draw_rate),
                total_jogos_historico_analisados: h2h.total_matches,
                ultimos_jogos_diretos_2_anos: recentMatches
            }
        };

    } catch (e) {
        return null;
    }
}