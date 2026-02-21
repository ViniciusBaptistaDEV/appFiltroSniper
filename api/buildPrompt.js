// Construtores de prompts para: Coleta e Análise (Estatística e Tática).
// Implementa a Lógica Dedutiva de Escanteios baseada em estilo tático.

export function montarPromptColetor(date, jogosESPN) {
  const dataBR = date.split("-").reverse().join("/");
  const listaJogos = JSON.stringify(jogosESPN, null, 2);

  return `
AGENT DE INTELIGÊNCIA – COLETOR FILTRO SNIPER (DATA: ${dataBR})

SUA MISSÃO É CRÍTICA:
Você recebeu uma lista com ${jogosESPN.length} jogos. 
Você DEVE processar e retornar uma entrada no JSON para CADA UM desses jogos, sem exceção. 

INSTRUÇÕES DE PESQUISA:
1. Para cada jogo da lista, busque: notícias de última hora, desfalques (lesionados/suspensos), motivação e estilo tático (especialmente para escanteios).
2. Se não encontrar dados específicos de um jogo, retorne os campos como "null" ou "dados não encontrados", mas MANTENHA o fixtureId e os nomes dos times no JSON.
3. Não resuma. Não ignore jogos. Se eu te mandei 30 jogos, eu quero 30 objetos no array "enriched".

JOGOS ESPN (GRADE-MESTRA):
${listaJogos}

FORMATO DE SAÍDA (MANTENHA EXATAMENTE ESTE SCHEMA):
{
  "enriched": [
    {
      "fixtureId": "string",
      "homeTeam": { "name": "string", "style_tags": [], "table_context": { "home_position": 0 } },
      "awayTeam": { "name": "string", "style_tags": [], "table_context": { "away_position": 0 } },
      "noticias_recentes": "string"
    }
  ]
}
RETORNE APENAS O JSON.
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