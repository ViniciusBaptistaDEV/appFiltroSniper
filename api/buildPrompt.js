// Construtores de prompts para: Coleta (Gemini), Análise (DeepSeek/Gemini).
// O coletor deve retornar JSON estrito com todas as chaves necessárias.
// Os analisadores retornam JSON por jogo/mercado (para fusão determinística).

export function montarPromptColetor(date, jogosESPN) {
  const dataBR = date.split("-").reverse().join("/");
  const listaJogos = JSON.stringify(jogosESPN, null, 2);

  return `
COLETOR OFICIAL – FILTRO SNIPER (DATA-ALVO: ${dataBR})
REGRAS CRÍTICAS:
1) Enriquecer APENAS os jogos fornecidos no array a seguir (ESPN é a grade-mestra).
2) NÃO adicionar, NÃO remover, NÃO renomear jogos/times.
3) Buscar em múltiplas fontes confiáveis (ex.: Sofascore, WhoScored, Transfermarkt, Opta, Flashscore, GloboEsporte).
4) Se um campo não estiver presente em nenhuma fonte, use null e adicione o nome do campo em "missing".
5) A data-alvo é ${dataBR}. Ignorar “hoje/amanhã/ontem”.

JOGOS ESPN (FONTE-MESTRA):
${listaJogos}

SCHEMA DE SAÍDA (JSON estrito - application/json):
{
  "date": "YYYY-MM-DD",
  "enriched": [
    {
      "fixtureId": "string (ESPN ID)",
      "league": "string",
      "kickoff": "ISO date-time",
      "homeTeam": {
        "name": "string",
        "coach": "string|null",
        "probableLineup": ["Nomes..."]|null,
        "injuries": ["Nome (status)"]|[],
        "suspended": ["Nome"]|[],
        "xG_last5": number|null,
        "xGA_last5": number|null,
        "bigChancesFor_last5": number|null,
        "bigChancesAgainst_last5": number|null,
        "shotsOnTarget_last5": number|null,
        "possession_last5": number|null,
        "cornersFor_last5": number|null,
        "cornersAgainst_last5": number|null,
        "attack_wings_level": "alto|medio|baixo|null",
        "crosses_last5": number|null,
        "blockedShots_last5": number|null,
        "style_tags": ["transicao","controle","pressao","bloco_baixo", "..."]
      },
      "awayTeam": { /* mesmas chaves do homeTeam */ },
      "referee": { "name": "string|null", "foulsPerGame": number|null, "tendency": "rigoroso|permissivo|null" },
      "h2h_last3": [{"home":"A","away":"B","score":"x-y","date":"YYYY-MM-DD"}]|[],
      "table_context": { "home_position": number|null, "away_position": number|null, "motivation_note": "string|null" },
      "home_away_form": { "home_points_last8": number|null, "away_points_last8": number|null },
      "sources": ["Lista de fontes utilizadas..."],
      "missing": ["lista de campos que não foram encontrados em nenhuma fonte"]
    }
  ]
}

SAÍDA:
Retorne apenas JSON (application/json), sem comentários ou texto fora do JSON.
`;
}

export function montarPromptAnaliseDeepSeek(date, enrichedJson) {
  return `
ANALISADOR ESTATÍSTICO – DEEPSEEK (DATA: ${date})
Você receberá um JSON com dados enriquecidos dos jogos. Analise APENAS esse JSON.
NUNCA invente, NUNCA complemente números ausentes.
Aplique as TRAVAS do Filtro Sniper para: Radar de Vitórias, Mercado de Gols (Over/Under), Ambas Marcam (BTTS) e Escanteios.
Saída: JSON por jogo com mercados e flags. Não inclua texto fora do JSON.

JSON DE ENTRADA:
${JSON.stringify(enrichedJson, null, 2)}

JSON DE SAÍDA (OBRIGATÓRIO):
{
  "games": [
    {
      "fixtureId": "string",
      "markets": {
        "victory": { "recommendation": "HOME|AWAY|NO_BET|DOUBLE_CHANCE_HOME|DOUBLE_CHANCE_AWAY", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string" },
        "goals":   { "recommendation": "OVER_2_5|UNDER_2_5|NO_BET", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string" },
        "btts":    { "recommendation": "YES|NO|NO_BET", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string" },
        "corners": { "recommendation": "HOME_OVER_X|AWAY_OVER_X|GAME_OVER_X|NO_BET", "line":  "number|null", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string" }
      },
      "overallFlag": "GREEN|YELLOW|RED"
    }
  ]
}
Retorne apenas JSON.
`;
}

export function montarPromptAnaliseGemini(date, enrichedJson) {
  return `
ANALISADOR TÁTICO – GEMINI (DATA: ${date})
Use APENAS o JSON fornecido. Sem inventar.
Foque em: escalações prováveis, ausências críticas, estilo (ataque pelos lados, transição), árbitro (ritmo), contexto de tabela e motivação.
Aplique as mesmas TRAVAS do Filtro Sniper. Saída deve ser JSON com os mesmos campos do DeepSeek, mas com racional tático.

JSON DE ENTRADA:
${JSON.stringify(enrichedJson, null, 2)}

JSON DE SAÍDA (OBRIGATÓRIO) – MESMO SCHEMA DO DEEPSEEK:
{
  "games": [
    {
      "fixtureId": "string",
      "markets": {
        "victory": { "recommendation": "HOME|AWAY|NO_BET|DOUBLE_CHANCE_HOME|DOUBLE_CHANCE_AWAY", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string (tático/contexto)" },
        "goals":   { "recommendation": "OVER_2_5|UNDER_2_5|NO_BET", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string (tático/contexto)" },
        "btts":    { "recommendation": "YES|NO|NO_BET", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string (tático/contexto)" },
        "corners": { "recommendation": "HOME_OVER_X|AWAY_OVER_X|GAME_OVER_X|NO_BET", "line": "number|null", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string (tático/contexto)" }
      },
      "overallFlag": "GREEN|YELLOW|RED"
    }
  ]
}
Retorne apenas JSON.
`;
}

