// Construtores de prompts para: Coleta (Gemini), Análise (DeepSeek/Gemini).
// Mantém a profundidade técnica exigida pelo Filtro Sniper.

export function montarPromptColetor(date, jogosESPN) {
  const dataBR = date.split("-").reverse().join("/");
  const listaJogos = JSON.stringify(jogosESPN, null, 2);

  return `
AGENT DE INTELIGÊNCIA – COLETOR FILTRO SNIPER (DATA: ${dataBR})

SUA MISSÃO:
Você é um analista de dados esportivos. Use sua busca web para preencher o schema técnico abaixo. 
Se não encontrar o dado exato de xG em sites como Sofascore ou FBRef, busque por "estatísticas avançadas [Time] últimos jogos" e faça uma estimativa técnica baseada no volume de grandes chances criadas.

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
        "suspended": ["string"],
        "xG_last5": 0, // Média de Expected Goals nos últimos 5 jogos
        "xGA_last5": 0, // Média de xG contra nos últimos 5 jogos
        "bigChancesFor_last5": 0,
        "shotsOnTarget_last5": 0,
        "cornersFor_last5": 0,
        "cornersAgainst_last5": 0,
        "style_tags": ["string"] // ex: "posse de bola", "contra-ataque rápido"
      },
      "awayTeam": { /* igual homeTeam */ },
      "table_context": { "home_position": 0, "away_position": 0, "motivation_note": "string" },
      "noticias_recentes": "string" // Crises, demissões, salários atrasados, clima.
    }
  ]
}
RETORNE APENAS JSON.
`;
}

export function montarPromptAnaliseDeepSeek(date, enrichedJson) {
  return `
ANALISADOR ESTATÍSTICO – DEEPSEEK (DATA: ${date})

FONTE DE DADOS PRIORITÁRIA:
1. Verifique o nó "footballDataStats". Se ele contiver "odds" e "statistics", use-os como sua base matemática real.
2. Cruze esses dados com o xG e estatísticas do Coletor Web.

O RIGOR DO FILTRO SNIPER:
- Se o Coletor Web retornar 0 em xG ou cantos, mas o "footballDataStats" trouxer Odds de favorito (ex: 1.40), você DEVE considerar que o time é superior e usar a Posição na Tabela para validar a aposta.
- NÃO ABORTE se houver Odds oficiais. Use a probabilidade implícita das odds para preencher o vácuo de dados do xG.

CRITÉRIO DE FLAG VERDE:
- Probabilidade calculada > 70% OU 
- Odds de favorito + Disparidade de mais de 8 posições na tabela + Ausência de crises.

JSON DE ENTRADA:
${JSON.stringify(enrichedJson, null, 2)}

(Mantenha o schema de saída original com victory, goals, btts e corners)
`;
}

export function montarPromptAnaliseGemini(date, enrichedJson) {
  return `
ANALISADOR TÁTICO – GEMINI (DATA: ${date})

SUA MISSÃO:
Análise fria de contexto. O DeepSeek cuidou dos números; você cuida da "alma" do jogo.

REGRAS SNIPER:
1. Examine o "footballDataStats.odds". Se o mercado paga pouco (favorito), mas você detectou no Coletor que o time vai com reserva, ALERTE PARA RISCO e mude a recomendação para NO_BET.
2. Analise o impacto tático dos desfalques listados. A ausência de um camisa 10 destrói o xG positivo?
3. SÓ recomende VERDE se o momento tático e as notícias confirmarem o favoritismo estatístico.

JSON DE ENTRADA:
${JSON.stringify(enrichedJson, null, 2)}

(Mantenha o schema de saída original)
`;
}