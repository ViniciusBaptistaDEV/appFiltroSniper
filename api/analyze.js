// Pipeline Sniper V8.1: ESPN (grade) -> Gemini 2.5 Flash (Busca + Análise + Decisão) -> Saída para o front.
// Implementa cache global com Upstash Redis (TTL 10 minutos) para economizar requisições.

import { buscarJogos } from "./football.js";
import { montarPromptSniper } from "./buildPrompt.js";

// Função para limpar as chaves da Vercel (evita erro de aspas invisíveis)
const cleanEnv = (key) => process.env[key]?.replace(/['"]/g, '').trim();

// Configurações de Banco de Dados e IA
const REDIS_URL = cleanEnv('UPSTASH_REDIS_REST_URL')?.replace(/\/$/, '');
const REDIS_TOKEN = cleanEnv('UPSTASH_REDIS_REST_TOKEN');
const MODEL_SNIPER = cleanEnv('GEM_COLLECTOR_MODEL') || "gemini-2.5-flash";
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS); // Tempo que o dado fica salvo (600s = 10min)

/* ========================================================================================
* CACHE GLOBAL (REDIS UPSTASH)
* Essa seção garante que se 10 pessoas acessarem o app ao mesmo tempo,
* o Gemini será chamado apenas 1 vez, e os outros 9 lerão do banco de dados instantaneamente.
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
      // Salva a chave com prazo de validade (EX = Expiry time)
      body: JSON.stringify(["SET", key, JSON.stringify(value), "EX", CACHE_TTL])
    });
  } catch (err) {
    console.error("🚨 Redis SET error:", err);
  }
}

/* ========================================================================================
* GEMINI CORE (MOTOR DE BUSCA E ANÁLISE)
* Esta é a ponte de comunicação direta com o cérebro da Google.
* ====================================================================================== */

const cleanVar = (val) => String(val || "").replace(/['"]/g, "").trim();

async function callGeminiJSON(promptText, model = "gemini-2.5-flash", useSearch = true) {
  const apiKey = cleanVar(process.env.GEMINI_API_KEY);
  const cleanModel = cleanVar(model);

  // Gemini 2.5 + Ferramenta de Busca exige a rota v1beta obrigatoriamente
  const apiVersion = "v1beta"; 
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanModel}:generateContent?key=${apiKey}`;

  // Monta a "encomenda" (Payload) com o prompt e configurações de criatividade (temperature baixa = mais rigoroso)
  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.1, 
    }
  };

  // Se a busca web estiver ativada, injeta a ferramenta de pesquisa do Google
  if (useSearch) {
    payload.tools = [{ googleSearch: {} }];
  }

  // Faz o disparo para a API
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();

  if (data.error) {
    console.error(`🚨 ERRO DA API GEMINI:`, JSON.stringify(data.error, null, 2));
    throw new Error(`API Gemini recusou: ${data.error.message}`);
  }

  // Extrai apenas o texto da resposta da IA
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text;
}

// Função de segurança: O Gemini as vezes devolve o JSON embrulhado em "```json ... ```".
// Essa função corta essa sujeira e garante que o app consiga ler os dados corretamente.
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
* HANDLER PRINCIPAL (O MAESTRO DO SISTEMA)
* Recebe a requisição do site, orquestra a coleta, a IA e devolve o resultado.
* ====================================================================================== */

export default async function handler(req, res) {
  // Trava de segurança: só aceita pedidos do tipo POST
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

    // 🔎 LOG PARA VOCÊ VER A SAÍDA DA ESPN:
    console.log(`\n⚽ [ESPN] Grade carregada com sucesso: ${grade.length} jogos encontrados para a data ${date}.`);
    console.log(`⚽ [ESPN] Exemplo do 1º jogo da lista: ${grade[0]?.homeTeam || 'Desconhecido'} vs ${grade[0]?.awayTeam || 'Desconhecido'}\n`);


    // ---------------------------------------------------------
    // ETAPA 2: Acionar o Gemini 2.5 Flash como Super Analista
    // ---------------------------------------------------------
    let analisePronta = await getCache(`SNIPER_V8:${date}`);
    if (!analisePronta) {
      
      // Monta o super prompt com suas regras e a lista de jogos
      const prompt = montarPromptSniper(date, grade);
      
      // 🔎 LOG PARA VER O QUE ESTÁ INDO PARA A IA:
      console.log(`🚀 [GEMINI] Iniciando Motor V8.1...`);
      console.log(`🚀 [GEMINI] Modelo: ${MODEL_SNIPER} | Busca Web: ATIVADA | Analisando: ${grade.length} jogos`);
      console.log(`🚀 [GEMINI] Tamanho do Prompt enviado: ${prompt.length} caracteres.\n`);

      // Envia para o Gemini pesquisar e pensar
      const geminiResponse = await callGeminiJSON(prompt, MODEL_SNIPER, true);
      
      // 🔎 LOG PARA VER O QUE A IA DEVOLVEU (Cortando em 300 caracteres para não poluir o painel todo):
      console.log(`📥 [GEMINI] RESPOSTA BRUTA RECEBIDA (Prévia):`);
      console.log(`${geminiResponse.substring(0, 300)}... [FIM DA PRÉVIA]\n`);

      // Tenta transformar o texto recebido no formato JSON que o site precisa
      const parsed = safeJsonParseFromText(geminiResponse);

      // Trava de segurança: Se ele não devolveu as "sections", o tiro falhou.
      if (!parsed || !parsed.sections) {
        console.error("🚨 [FALHA DE FORMATO] A IA respondeu, mas quebrou a estrutura do JSON. Resposta completa:", geminiResponse);
        throw new Error("Gemini não retornou o formato JSON exigido pelo frontend.");
      }

      // Tudo deu certo! Salva no banco de dados para a próxima vez ser instantâneo
      analisePronta = parsed;
      await setCache(`SNIPER_V8:${date}`, analisePronta);
      console.log(`✅ [SUCESSO] Análise V8.1 finalizada e salva no Redis.\n`);
    } else {
      console.log(`⚡ [CACHE] Leitura instantânea do Redis para a data ${date}. Poupando cota do Gemini.\n`);
    }

    // ---------------------------------------------------------
    // ETAPA 3: Devolver o resultado pronto para o seu site desenhar a tela
    // ---------------------------------------------------------
    return res.status(200).json({
      status: "ok",
      date,
      generatedAt: new Date().toISOString(),
      source: { grade: "ESPN", ai: "Gemini 2.5 Flash + Google Search" },
      sections: analisePronta.sections,
      resultado: analisePronta.resultado
    });

  } catch (error) {
    // Se der qualquer erro no caminho (API caiu, chave inválida, etc) cai aqui
    console.error("🚨 ERRO CRÍTICO NO PIPELINE:", error);
    return res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}