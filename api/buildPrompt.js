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
      "fixtureId": "string",
      "league": "string",
      "kickoff": "string",
      "homeTeam": {
        "name": "string",
        "coach": "string",
        "probableLineup": ["string"],
        "injuries": ["string"],
        "suspended": ["string"],
        "xG_last5": 0,
        "xGA_last5": 0,
        "bigChancesFor_last5": 0,
        "bigChancesAgainst_last5": 0,
        "shotsOnTarget_last5": 0,
        "possession_last5": 0,
        "cornersFor_last5": 0,
        "cornersAgainst_last5": 0,
        "attack_wings_level": "alto",
        "crosses_last5": 0,
        "blockedShots_last5": 0,
        "style_tags": ["string"]
      },
      "awayTeam": { /* preencher igual homeTeam */ },
      "referee": { "name": "string", "foulsPerGame": 0, "tendency": "string" },
      "h2h_last3": [{"home":"string","away":"string","score":"string","date":"string"}],
      "table_context": { "home_position": 0, "away_position": 0, "motivation_note": "string" },
      "home_away_form": { "home_points_last8": 0, "away_points_last8": 0 },
      "sources": ["string"],
      "missing": ["string"]
    }
  ]
}

Se um campo numérico não existir, retorne 0. Se uma string/array não existir, retorne "" ou [] vazio.

SAÍDA:
Retorne apenas JSON (application/json), sem comentários ou texto fora do JSON.
`;
}

export function montarPromptAnaliseDeepSeek(date, enrichedJson) {
  return `
ANALISADOR ESTATÍSTICO – DEEPSEEK (DATA: ${date})

REGRAS DE ANÁLISE (FLEXIBILIDADE DE DADOS):
1. ATENÇÃO: É normal que campos de estatísticas avançadas (xG, posse de bola, cantos) gerados pela web cheguem zerados ou nulos. 
2. NOVO E CRÍTICO: Você notará um nó chamado "footballDataStats" em alguns jogos. Ele contém DADOS OFICIAIS de APIs esportivas (odds, status, estatísticas puras). DÊ PRIORIDADE MÁXIMA a esses números para embasar suas decisões matemáticas e de probabilidade.
3. NÃO ABORTE a análise (NO_BET) apenas por falta de números da busca web. Use as odds e os dados do "footballDataStats" para suprir essa falta.
4. Baseie sua análise matemática no momento do time, ausências, posição na tabela, odds de mercado e qualquer dado qualitativo fornecido. 
5. Só recomende "NO_BET" por falta de dados se as equipes forem 100% desconhecidas, não houver NENHUM contexto sobre elas E o "footballDataStats" estiver ausente.

REGRA DE COMPENSAÇÃO (O FILTRO SNIPER):
Se os dados estatísticos precisos estiverem ausentes ou zerados, você SÓ PODE recomendar uma aposta se encontrar pelo menos DOIS destes fatores de alto impacto no contexto ou nos dados oficiais:
1. Lesões ou ausências críticas de jogadores chave confirmadas.
2. Disparidade enorme e clara na tabela (ex: 1º lutando pelo título vs 18º rebaixado) validada por Odds muito desiguais no mercado.
3. Fatores extra-campo muito fortes (crise, demissão de técnico recente).
Se não houver números exatos, sem apoio de odds E o contexto for fraco/morno, o rigor prevalece: retorne "NO_BET".

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
        "corners": { "recommendation": "HOME_OVER_X|AWAY_OVER_X|GAME_OVER_X|NO_BET", "line": "number|null", "flag": "GREEN|YELLOW|RED", "confidence": 0-100, "rationale": "string" }
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

REGRAS DE ANÁLISE TÁTICA (FLEXIBILIDADE OBRIGATÓRIA):
1. O coletor usa web search, então é NORMAL que dados estatísticos específicos (xG, posse, médias de escanteios) estejam nulos ou zerados.
2. NOVO E CRÍTICO: Você notará um nó "footballDataStats" em alguns jogos. Ele contém dados oficiais de mercado (como as "odds"). Use as odds para entender a EXPECTATIVA DO MERCADO. O mercado aponta um super favorito? Cruze isso com a sua análise de lesões e clima de vestiário. Será que o mercado está cego para uma crise tática?
3. PROIBIDO abortar (NO_BET) apenas por falta de números. Você é o analista TÁTICO, não o matemático.
4. Se os números não existirem, baseie sua decisão de apostar no contexto: lesões, motivação (luta contra rebaixamento), posição na tabela, mando de campo e notícias recentes.
5. Se o modelo estatístico (espelhado nas odds do mercado) sugerir favoritismo e você achar viável pelo contexto, ACOMPANHE a aposta.
6. Só use "NO_BET" se a partida for entre times completamente obscuros e não houver literalmente NENHUMA informação sobre o contexto, momento ou odds.

REGRA DE COMPENSAÇÃO (O FILTRO SNIPER):
Se os dados estatísticos precisos estiverem ausentes, você SÓ PODE recomendar uma aposta se encontrar pelo menos DOIS destes fatores de alto impacto no contexto:
1. Lesões ou ausências críticas de jogadores chave confirmadas.
2. Disparidade enorme e clara na tabela (ex: 1º lutando pelo título vs 18º rebaixado).
3. Fatores extra-campo muito fortes (crise, demissão de técnico recente).
Se não houver números exatos E o contexto for fraco/morno, o rigor prevalece: retorne "NO_BET".

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