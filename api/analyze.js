// Pipeline Sniper V8.1: ESPN (grade) -> Gemini (Busca + Análise + Decisão) -> Saída para o front.
// Implementa cache global com Upstash Redis (TTL) para economizar requisições.

/* ===================  APIs  =================== */
// Usar apenas uma das duas opções:
// gemini-2.5-flash
// gemini-3-flash
/* ============================================== */

import { buscarJogos } from "./football.js";
import { montarPromptSniper } from "./buildPrompt.js";

// Função para limpar as chaves da Vercel (evita erro de aspas invisíveis)
const cleanEnv = (key) => process.env[key]?.replace(/['"]/g, '').trim();

// Configurações de Banco de Dados e IA
const REDIS_URL = cleanEnv('UPSTASH_REDIS_REST_URL')?.replace(/\/$/, '');
const REDIS_TOKEN = cleanEnv('UPSTASH_REDIS_REST_TOKEN');
const MODEL_SNIPER = cleanEnv('GEM_COLLECTOR_MODEL');
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS);

/* ========================================================================================
* CACHE GLOBAL (REDIS UPSTASH)
* ====================================================================================== */

async function getCache(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch (err) {
    console.error("🚨 Redis GET error:", err);
    return null;
  }
}

async function setCache(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    await fetch(REDIS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["SET", key, JSON.stringify(value), "EX", CACHE_TTL])
    });
  } catch (err) {
    console.error("🚨 Redis SET error:", err);
  }
}

/* ========================================================================================
* GEMINI CORE (MOTOR DE BUSCA E ANÁLISE)
* ====================================================================================== */

const cleanVar = (val) => String(val || "").replace(/['"]/g, "").trim();

async function callGeminiJSON(promptText, model = "gemini-2.5-flash", useSearch = true) {
  const apiKey = cleanVar(process.env.GEMINI_API_KEY);
  const cleanModel = cleanVar(model);

  // LÓGICA CONDICIONAL DE VERSÃO (SISTEMA FLEX INFINITO)
  // Aceita 2.5 e qualquer Gemini do 3 ao 9 automaticamente.
  const isNextGen = /gemini-(2\.5|[3-9])/.test(cleanModel) || cleanModel.includes("preview");
  const apiVersion = (isNextGen || useSearch) ? "v1beta" : "v1";

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanModel}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.1,
    }
  };

  if (useSearch) {
    payload.tools = [{ googleSearch: {} }];
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();

  if (data.error) {
    console.error(`🚨 ERRO DA API GEMINI (${cleanModel} na rota ${apiVersion}):`, JSON.stringify(data.error, null, 2));
    throw new Error(`API Gemini recusou: ${data.error.message}`);
  }

  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text;
}

function safeJsonParseFromText(txt) {
  try {
    // 1. O ASPIRADOR: Remove os lixos de markdown (```json) que o Gemini adora colocar
    let textoLimpo = txt.replace(/```json/gi, '').replace(/```/g, '').trim();

    // 2. Encontra a primeira e a última chave
    const firstBrace = textoLimpo.indexOf("{");
    const lastBrace = textoLimpo.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      console.error("🚨 JSON não encontrado na resposta do Gemini.");
      return null;
    }

    // 3. Corta o texto EXATAMENTE onde precisa e faz o parse
    let cleanJson = textoLimpo.slice(firstBrace, lastBrace + 1);
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("🚨 ERRO NO PARSE:", e.message);
    return null;
  }
}

/* ========================================================================================
* FUNÇÕES AUXILIARES DO NOVO MOTOR TURBO
* ====================================================================================== */

// Fatiador de Array: Quebra a lista gigante de jogos em caixas menores.
function fatiarArray(array, tamanho) {
  const resultado = [];
  for (let i = 0; i < array.length; i += tamanho) {
    resultado.push(array.slice(i, i + tamanho));
  }
  return resultado;
}

// ATENÇÃO: Aumenta o tempo limite da Vercel para permitir processamento longo (até 60 segundos)
export const maxDuration = 60;



/* ========================================================================================
    HANDLER PRINCIPAL (O MAESTRO DO SISTEMA)
* ====================================================================================== */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const { date, limit, checkCacheOnly, checkProgress } = req.body || {};
  if (!date) return res.status(400).json({ error: "Parâmetro 'date' é obrigatório (YYYY-MM-DD)." });

  try {

    // =========================================================================
    // 🕵️‍♂️ ROTA EXPRESSA: APENAS VERIFICAR O CRONÔMETRO DO REDIS
    // =========================================================================
    if (checkCacheOnly) {
      if (!REDIS_URL || !REDIS_TOKEN) return res.status(200).json({ expiresAt: null });

      // ALERTA: Aqui usamos a mesma chave exata do cache!
      const cacheKey = `SNIPER_V12:${date}`;

      const resTtl = await fetch(`${REDIS_URL}/ttl/${cacheKey}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
      const dataTtl = await resTtl.json();

      // Se o result for maior que 0, são os segundos que faltam para o cache morrer
      if (dataTtl.result && dataTtl.result > 0) {
        const expiresAt = Date.now() + (dataTtl.result * 1000);
        return res.status(200).json({ status: "cached", expiresAt });
      } else {
        return res.status(200).json({ status: "nocache", expiresAt: null });
      }
    }
    // =========================================================================

    // =========================================================================
    // 🕵️‍♂️ ROTA ESPIÃ: APENAS LER A % DE PROGRESSO
    // =========================================================================
    if (checkProgress) {
      const progressoAtual = await getCache(`PROGRESS:${date}`);
      return res.status(200).json({ progress: progressoAtual || 0 });
    }

    // ---------------------------------------------------------
    // ETAPA 1: Buscar a lista de jogos da ESPN (Grade Mestra)
    // ---------------------------------------------------------
    await setCache(`PROGRESS:${date}`, 10); // 10% - Iniciou busca ESPN
    let grade = await getCache(`GRADE:${date}`);
    if (!grade) {
      grade = await buscarJogos(date, { limit });
      await setCache(`GRADE:${date}`, grade);
    }

    await setCache(`PROGRESS:${date}`, 25); // 25% - Grade carregada

    if (!Array.isArray(grade) || grade.length === 0) {
      return res.status(200).json({
        status: "ok",
        date,
        resultado: "🧭 Grade vazia ou sem jogos válidos no escopo.",
        sections: []
      });
    }

    console.log(`\n⚽ [ESPN] Grade carregada com sucesso: ${grade.length} jogos encontrados para a data ${date}.`);

    // ---------------------------------------------------------
    // ETAPA 2: Acionar o Motor de Inteligência Analítica em PARALELO
    // ---------------------------------------------------------
    let analisePronta = await getCache(`SNIPER_V12:${date}`);

    if (!analisePronta) {
      const tamanhoLote = 2; //quantos jogos analisa em cada lote
      const lotes = fatiarArray(grade, tamanhoLote);
      let lotesConcluidos = 0;

      console.log(`🚀 [SISTEMA] Iniciando fatiamento de ${grade.length} jogos em lotes de ${tamanhoLote} jogos cada...`);

      // Cria as "tarefas" para rodarem todas ao mesmo tempo (Processamento Paralelo)
      const tarefas = lotes.map(async (lote, index) => {
        // Pequeno atraso (stagger) de 1,5 segundo entre cada disparo para a Google não bloquear por "Spam"
        await new Promise(resolve => setTimeout(resolve, index * 1500));
        const prompt = montarPromptSniper(date, lote);

        console.log(`⏳ [GEMINI] Disparando Lote ${index + 1} de ${lotes.length}...`);

        try {
          const geminiResponse = await callGeminiJSON(prompt, MODEL_SNIPER, true);

          // 🔥 ADICIONE ESTAS 3 LINHAS AQUI PARA DEPURAR:
          console.log(`\n=== 🕵️‍♂️ RESPOSTA CRUA DA IA (LOTE ${index + 1}) ===`);
          console.log(geminiResponse);
          console.log(`=========================================\n`);
          
          const parsed = safeJsonParseFromText(geminiResponse);
          if (parsed && parsed.sections) {
            return parsed.sections; // Retorna os cards desse lote
          }
        } catch (err) {
          console.error(`🚨 Erro no Lote ${index + 1}:`, err.message);
        } finally {
          // 🔥 ATUALIZA O PROGRESSO REAL A CADA LOTE FINALIZADO
          lotesConcluidos++;
          const porcentagem = Math.round((lotesConcluidos / lotes.length) * 95);
          await setCache(`PROGRESS:${date}`, porcentagem);
        }
        return []; // Se um lote der erro, retorna vazio para não quebrar os outros
      });
      

      // 💥 A MÁGICA ACONTECE AQUI: Espera todos os lotes terminarem ao mesmo tempo!
      const resultadosParalelos = await Promise.all(tarefas);
      await setCache(`PROGRESS:${date}`, 98); // 98% - Processando múltiplas e filtros finais

      // Junta todas as respostas separadas em uma lista gigante única
      let todasAsSections = resultadosParalelos.flat();

      // --- Classificador automático de grupo (corrige Over/BTTS que viram RADAR)
      function classificarGrupoDoCard(card) {
        const body = (card?.body || "").toLowerCase();

        if (body.includes("escanteios")) return "💎 ANÁLISE DE ESCANTEIOS";
        if (body.includes("ambas marcam") || body.includes("btts")) return "⚽ AMBAS MARCAM";
        if (body.includes("over") || body.includes("under") || body.includes("gols")) return "⚽ MERCADO DE GOLS";
        if (card.flag === "MULTIPLA" || /bilhete/i.test(card.title || "")) return "🎫 BILHETE COMBINADO";
        if (body.includes("abortado") || body.includes("bloqueado")) return "⛔ JOGOS ABORTADOS";

        return "🏆 RADAR DE VITÓRIAS";
      }

      // --- Aplicar classificacao se o LLM mandar group errado
      todasAsSections = todasAsSections.map(s => ({
        ...s,
        group: s.group?.trim() ? s.group : classificarGrupoDoCard(s)
      }));

      // --- 🧠 MÁGICA DAS MÚLTIPLAS (FILTRO DE ELITE 80%+) ---
      // 1. Limpa lixos de múltiplas anteriores
      let sectionsLimpas = todasAsSections.filter(s => s && s.group !== "📝 MÚLTIPLAS" && s.group !== "RADAR DE MÚLTIPLAS");

      // 2. Filtro Rigoroso: Apenas VERDE E com CONFIANÇA >= 85%
      const jogosElite = sectionsLimpas.filter(s => {
        // Primeiro checa se é verde
        const isVerde = s && s.flag && s.flag.trim().toUpperCase() === "VERDE";
        if (!isVerde) return false;

        // Segundo, extrai a confiança e checa se é >= 85
        const match = s.body.match(/\[CONFIDENCA\] (\d+)%/);
        const valorConfianca = match ? parseInt(match[1]) : 0;

        return valorConfianca >= 85; // Filtra apenas os jogos com confiança de 85% ou mais
      });

      console.log(`🎯 [MULTIPLA] Encontrados ${jogosElite.length} jogos de elite para o bilhete.`);

      // 3. Só cria a múltipla se sobrarem 2 ou mais jogos após o filtro de 80%
      if (jogosElite.length >= 2) {

        const listaConfiancas = jogosElite.map(j => {
          const match = j.body.match(/(?:\[CONFIDENCA\]|Confiança:?)\s*(\d+)%/i);
          return match ? parseInt(match[1]) : 0;
        }).filter(n => n > 0);

        // --- 🧠 CÁLCULO DE PROBABILIDADE REAL (MULTIPLICAÇÃO) ---
        const probabilidadeReal = listaConfiancas.length > 0
          ? Math.round(
            listaConfiancas.reduce((acc, val) => acc * (val / 100), 1) * 100
          )
          : 0;

        // Formata a lista de apostas exatamente como você pediu: TIME - PALPITE
        const listaDeApostas = jogosElite.map(j => {
          const jogoNome = j.title.split(" (")[0].toUpperCase();
          let palpite = "Confirmado";
          try {
            // Extrai o palpite real de dentro do card verde
            palpite = j.body.split("|")[0].replace("[OPORTUNIDADE]", "").trim();
          } catch (e) { }
          return `${jogoNome} — ${palpite}`;
        }).join("\n\n"); // Pulo de linha duplo para organizar no card

        sectionsLimpas.push({
          // USAMOS O GRUPO "RADAR DE VITÓRIAS" PARA FORÇAR O LAYOUT DE CARD
          group: "RADAR DE VITÓRIAS",
          title: "🎫 BILHETE COMBINADO",
          // PREENCHEMOS AS TAGS PARA O JS DO SITE DISTRIBUIR NOS CAMPOS:
          body: `[OPORTUNIDADE] Múltipla de Segurança | [TARGET] Jogos verdes com probabilidade acima de 80% | [MOMENTO] ${listaDeApostas} | [CONTEXTO] Cruzamento tático dos cenários Verdes da rodada com alta probabilidade. | [CONFIDENCA] ${probabilidadeReal}%`,
          flag: "MULTIPLA" // Isso fará aparecer "MULTIPLA" na lateral. Se o seu CSS tiver a cor azul para essa classe, ficará perfeito!
        });
      }

      // --- 🔄 ORDENAÇÃO POR CORES (HIERARQUIA SOLICITADA) ---
      // 1º Verdes | 2º Amarelos | 3º Múltipla | 4º Vermelhos
      sectionsLimpas.sort((a, b) => {
        const getPeso = (card) => {
          // Jogo VERDE que não seja a múltipla
          if (card.flag === "VERDE" && card.group !== "RADAR DE VITÓRIAS" || (card.flag === "VERDE" && !card.title.includes("BILHETE"))) return 1;

          if (card.flag === "AMARELA") return 2;

          // A Múltipla (identificada pelo flag ou título)
          if (card.flag === "MULTIPLA" || card.title.includes("BILHETE")) return 3;

          if (card.flag === "VERMELHA") return 4;

          return 5;
        };
        return getPeso(a) - getPeso(b);
      });

      // Calcula o momento exato no futuro em que o cache expira (em milissegundos)
      const tempoExpiracao = Date.now() + (CACHE_TTL * 1000);

      analisePronta = {
        resultado: `Análise finalizada em modo turbo paralelo. Processados ${lotes.length} lotes de jogos.`,
        sections: sectionsLimpas,
        expiresAt: tempoExpiracao // 🔥 A mágica começa aqui
      };

      await setCache(`SNIPER_V12:${date}`, analisePronta); // Lembra de mudar a chave para V12 para testar!
      console.log(`✅ [SUCESSO] Grade completa analisada em PARALELO e salva no Redis.\n`);
    } else {
      console.log(`⚡ [CACHE] Leitura instantânea do Redis para a data ${date}.\n`);
    }

    // ---------------------------------------------------------
    // ETAPA 3: Devolver o resultado pronto para o front
    // ---------------------------------------------------------
    return res.status(200).json({
      status: "ok",
      date,
      generatedAt: new Date().toISOString(),
      expiresAt: analisePronta.expiresAt, // 🔥 Envia o tempo para o Front-end
      source: { grade: "ESPN", ai: `Motor IA: ${MODEL_SNIPER} + Lotes Turbo Paralelo` },
      sections: analisePronta.sections,
      resultado: analisePronta.resultado
    });

  } catch (error) {
    console.error("🚨 ERRO CRÍTICO NO PIPELINE:", error);
    return res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}
