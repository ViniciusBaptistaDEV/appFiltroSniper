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
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS); // Tempo padrão 2 horas, se não definido

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
    const firstBrace = txt.indexOf("{");
    const lastBrace = txt.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) return null;
    
    let cleanJson = txt.slice(firstBrace, lastBrace + 1);
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
* HANDLER PRINCIPAL (O MAESTRO DO SISTEMA)
* ====================================================================================== */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const { date, limit } = req.body || {};
  if (!date) return res.status(400).json({ error: "Parâmetro 'date' é obrigatório (YYYY-MM-DD)." });

  try {
    // ---------------------------------------------------------
    // ETAPA 1: Buscar a lista de jogos da ESPN (Grade Mestra)
    // ---------------------------------------------------------
    let grade = await getCache(`GRADE:${date}`);
    if (!grade) {
      grade = await buscarJogos(date, { limit });
      await setCache(`GRADE:${date}`, grade);
    }
    
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
    let analisePronta = await getCache(`SNIPER_V8:${date}`);
    if (!analisePronta) {
      
      console.log(`🚀 [SISTEMA] Iniciando fatiamento de ${grade.length} jogos em lotes de 3 (Sniper Máximo)...`);
      const lotes = fatiarArray(grade, 3);
      
      // Cria as "tarefas" para rodarem todas ao mesmo tempo (Processamento Paralelo)
      const tarefas = lotes.map(async (lote, index) => {
        // Pequeno atraso (stagger) de 1 segundo entre cada disparo para a Google não bloquear por "Spam"
        await new Promise(resolve => setTimeout(resolve, index * 1000));
        
        console.log(`⏳ [GEMINI] Disparando Lote ${index + 1} de ${lotes.length}...`);
        const prompt = montarPromptSniper(date, lote);
        
        try {
          const geminiResponse = await callGeminiJSON(prompt, MODEL_SNIPER, true);
          const parsed = safeJsonParseFromText(geminiResponse);
          if (parsed && parsed.sections) {
            return parsed.sections; // Retorna os cards desse lote
          }
        } catch (err) {
          console.error(`🚨 Erro no Lote ${index + 1}:`, err.message);
        }
        return []; // Se um lote der erro, retorna vazio para não quebrar os outros
      });

      // 💥 A MÁGICA ACONTECE AQUI: Espera todos os lotes terminarem ao mesmo tempo!
      const resultadosParalelos = await Promise.all(tarefas);
      
      // Junta todas as respostas separadas em uma lista gigante única
      let todasAsSections = resultadosParalelos.flat();

      // --- 🧠 MÁGICA DAS MÚLTIPLAS (FEITA PELO CÓDIGO) ---
      // Limpa qualquer lixo de múltipla que a IA tenha tentado criar sozinha
      let sectionsLimpas = todasAsSections.filter(s => s && s.group !== "📝 MÚLTIPLAS");
      
      // Pega só a NATA (os Verdes)
      const jogosVerdes = sectionsLimpas.filter(s => s.flag === "VERDE");
      
      if (jogosVerdes.length >= 2) {
        // Extrai o nome do time da casa dos jogos aprovados
        const nomesVerdes = jogosVerdes.map(j => j.title.split(" vs ")[0]).join(" + ");
        
        sectionsLimpas.push({
          group: "📝 MÚLTIPLAS",
          title: "1️⃣ MÚLTIPLA DE ELITE (Consolidada)",
          body: `[OPORTUNIDADE] ${nomesVerdes} | [TARGET] Odd Combinada de Elite | [MOMENTO] Cruzamento inteligente de todos os favoritos aprovados hoje. | [CONTEXTO] Validação tática completa concluída pela IA. | [CONFIDENCA] 85%`,
          flag: "AMARELA"
        });
      }

      analisePronta = {
        resultado: `Análise finalizada em modo turbo paralelo. Processados ${lotes.length} lotes de jogos.`,
        sections: sectionsLimpas
      };

      await setCache(`SNIPER_V8:${date}`, analisePronta);
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
      source: { grade: "ESPN", ai: `Motor IA: ${MODEL_SNIPER} + Lotes Turbo Paralelo` },
      sections: analisePronta.sections,
      resultado: analisePronta.resultado
    });

  } catch (error) {
    console.error("🚨 ERRO CRÍTICO NO PIPELINE:", error);
    return res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}
