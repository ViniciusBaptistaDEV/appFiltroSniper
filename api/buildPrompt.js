// Construtores de prompts para: Coleta e Análise (Estatística e Tática).
// Implementa a Lógica Dedutiva de Escanteios baseada em estilo tático.

export function montarPromptColetor(date, jogosESPN) {
  const dataBR = date.split("-").reverse().join("/");
  const listaJogos = JSON.stringify(jogosESPN, null, 2);

  return `
AGENT DE INTELIGÊNCIA – COLETOR FILTRO SNIPER (DATA: ${dataBR})

SUA MISSÃO:
Você é um analista de dados. Além das estatísticas habituais, foque intensamente no ESTILO DE JOGO para o mercado de escanteios.

PRIORIDADE DE BUSCA PARA ESCANTEIOS:
1. O time ataca pelas alas/pontas?
2. O time tem como característica muitos cruzamentos na área?
3. O time tem jogadores que chutam muito de fora da área (gerando chutes bloqueados/desvios)?
4. O time costuma "abafar" o adversário em casa?

JOGOS ESPN (GRADE-MESTRA):
${listaJogos}

SCHEMA TÉCNICO OBRIGATÓRIO (JSON):
{
  "enriched": [
    {
      "fixtureId": "string",
      "homeTeam": {
        "name": "string",
        "coach": "string",
        "probableLineup": ["string"],
        "injuries": ["string"],
        "xG_last5": 0,
        "style_tags": ["ataque pelas alas", "muitos cruzamentos", "chutes de longe", "pressão alta", "retranca"],
        "table_context": { "position": 0, "motivation": "string" }
      },
      "awayTeam": { /* igual homeTeam */ },
      "noticias_recentes": "string"
    }
  ]
}
RETORNE APENAS JSON.
`;
}

export function montarPromptAnaliseDeepSeek(date, enrichedJson) {
  return `
ANALISADOR ESTATÍSTICO SNIPER (DATA: ${date})

REGRA MESTRE DE ESCANTEIOS (DEDUÇÃO TÁTICA):
1. Se os números de escanteios (corners_last5) estiverem zerados, você DEVE usar as "style_tags".
2. FLAG VERDE PARA CANTOS: Se um time for favorito (odds baixas) E tiver as tags "ataque pelas alas" ou "muitos cruzamentos" contra um adversário em "retranca" ou muito inferior na tabela.
3. LÓGICA: Favorito atacando pelas pontas contra time retrancado = Alto volume de escanteios.

GERAL:
- Use as odds do "footballDataStats" para validar o favoritismo.
- Não aborte o mercado de cantos se o estilo tático for claro.

JSON DE ENTRADA:
${JSON.stringify(enrichedJson, null, 2)}

SUA RESPOSTA DEVE SER OBRIGATORIAMENTE NESTE FORMATO JSON:
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
RETORNE APENAS O JSON.
`;
}

export function montarPromptAnaliseGemini(date, enrichedJson) {
  return `
ANALISADOR TÁTICO SNIPER (DATA: ${date})

MISSÃO ESCANTEIOS:
1. Valide a recomendação de cantos baseada na largura do campo. Times que jogam com pontas abertos (ex: 4-3-3 ou 4-2-3-1 com alas ofensivos) tendem a gerar mais cantos.
2. Se o "estilo tático" indicar "muitos cruzamentos", confirme a FLAG VERDE para o mercado de escanteios.

GERAL:
- Cruze notícias de desfalques (ex: se o ponta titular está fora, a média de cantos tende a cair).
- Siga o mesmo formato JSON do analisador estatístico.

JSON DE ENTRADA:
${JSON.stringify(enrichedJson, null, 2)}

SUA RESPOSTA DEVE SER OBRIGATORIAMENTE O JSON COMPLETO COM A CHAVE "games".
`;
}