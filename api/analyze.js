// Pipeline: ESPN (grade) -> Gemini (coleta) -> DeepSeek (análise estatística) -> Gemini (análise tática)
// -> Fusão determinística -> Saída para o front.
// Implementa cache com TTL de 10 minutos (idempotência em desktop/mobile).
// IMPORTANTE: defina GEMINI_API_KEY e OPENROUTER_API_KEY em Vercel.

import { buscarJogos } from "./football.js";
import {
  montarPromptColetor,
  montarPromptAnaliseDeepSeek,
  montarPromptAnaliseGemini
} from "./buildPrompt.js";

/* ========================================================================================
*                                      CACHE (TTL 10m)
* ====================================================================================== */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

const CACHE_GRADE = new Map();           // date -> { ts, value }
const CACHE_ENRICHED = new Map();        // date -> { ts, value }
const CACHE_DEEPSEEK = new Map();        // date -> { ts, value }
const CACHE_GEMINI_ANALYSIS = new Map(); // date -> { ts, value }
const CACHE_FUSED = new Map();           // date -> { ts, value }

function isFresh(entry) {
  return entry && (Date.now() - entry.ts) < CACHE_TTL_MS;
}
function setCache(map, key, value) {
  map.set(key, { ts: Date.now(), value });
}
function getCache(map, key) {
  const entry = map.get(key);
  return isFresh(entry) ? entry.value : null;
}

/* ========================================================================================
*                             HELPERS HTTP (OpenRouter / Gemini)
* ====================================================================================== */

/**
* Chama um modelo via OpenRouter (DeepSeek por padrão) e retorna o texto.
* jsonMode: quando true, solicita resposta em JSON (quando o modelo suporta).
*/
async function callOpenRouter(
  model,
  messages,
  { temperature = 0.1, top_p = 0.1, seed = 42, max_tokens = 8000, jsonMode = false } = {}
) {
  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };
  const body = { model, temperature, top_p, seed, max_tokens, messages };
  if (jsonMode) body.response_format = { type: "json_object" };

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error?.message || "OpenRouter error");
  const text = data?.choices?.[0]?.message?.content || "";
  return text;
}

// Modelos do Gemini controlados por variável de ambiente (com fallback seguro)
const MODEL_COLLECTOR = process.env.GEM_COLLECTOR_MODEL || "gemini-2.5-flash";
const MODEL_TACTICS = process.env.GEM_TACTICS_MODEL || "gemini-2.5-pro";

/**
* Chama o Gemini 2.5 (Flash/Pro) (Google AI Studio) forçando saída em JSON.
*/
async function callGeminiJSON(promptText, model = "gemini-2.5-flash", useSearch = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.1,
      topK: 32
      // Removemos o response_mime_type daqui para controlar dinamicamente
    },
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };

  // A MÁGICA ACONTECE AQUI:
  if (useSearch) {
    // 1. Liga a internet
    payload.tools = [{ googleSearch: {} }];
    // 2. Como não podemos forçar o JSON nativo, forçamos no texto:
    payload.contents[0].parts[0].text += "\n\n[AVISO CRÍTICO DE SISTEMA]: Retorne EXATAMENTE e APENAS o JSON. Não use blocos de formatação markdown (```json). Não escreva nenhum texto antes ou depois do JSON.";
  } else {
    // 1. Se NÃO usa internet, ativamos a trava nativa de JSON da API
    payload.generationConfig.response_mime_type = "application/json";
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();

  if (data.error) {
    console.error("🚨 ERRO DA API GEMINI:", JSON.stringify(data.error, null, 2));
    throw new Error(`API Gemini recusou: ${data.error.message}`);
  }

  const candidate = data?.candidates?.[0];

  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Geração bloqueada pelo Gemini. Motivo: ${candidate.finishReason}`);
  }

  let text =
    candidate?.content?.parts?.[0]?.text ||
    candidate?.content?.parts?.[0]?.inlineData?.data ||
    "";

  if (!text) {
    console.error("🚨 RESPOSTA SEM TEXTO:", JSON.stringify(data, null, 2));
    throw new Error("Gemini retornou resposta vazia");
  }

  // Limpeza de segurança extra: caso o Gemini teimoso coloque "```json" mesmo a gente pedindo para não colocar
  if (useSearch) {
    text = text.replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
  }

  return text;
}

/**
* Parse seguro de texto -> JSON (tenta extrair o maior bloco JSON se a resposta vier com ruído).
*/
function safeJsonParseFromText(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    const first = txt.indexOf("{");
    const last = txt.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(txt.slice(first, last + 1));
      } catch { }
    }
    return null;
  }
}

/* ========================================================================================
*                         UTILIDADES DE FORMATAÇÃO (kickoff local BR)
* ====================================================================================== */

/**
* Converte o kickoff ISO do fixture para "HH:MM" no fuso America/Sao_Paulo (24h).
* Retorna null se não houver kickoff válido.
*/
function kickoffTimeLocalBR(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  try {
    // pt-BR, 24h, sem segundos, fuso fixo de São Paulo
    return date.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    // Fallback genérico
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

/* ========================================================================================
*                                  FUSÃO DETERMINÍSTICA
* ====================================================================================== */

/**
* Constrói listas de múltiplas a partir das sections já fundidas (somente flags VERDE).
* - Elite (Vitórias): somente RADAR DE VITÓRIAS, flag VERDE
* - Volume (Escanteios): somente RADAR DE ESCANTEIOS, flag VERDE
* - Segurança: qualquer recomendação VERDE (padrão conservador)
*/
function buildMultiplesFromSections(sections) {
  const isGreen = (s) => String(s.flag || "").toUpperCase().includes("VERDE");
  const isGroup = (s, name) => (s.group || "").toUpperCase().includes(name.toUpperCase());

  const vitoriasVerdes = sections.filter(s => isGroup(s, "RADAR DE VITÓRIAS") && isGreen(s));
  const escanteiosVerdes = sections.filter(s => isGroup(s, "RADAR DE ESCANTEIOS") && isGreen(s));
  const segurosVerdes = sections.filter(s => isGreen(s) && (
    isGroup(s, "RADAR DE VITÓRIAS") ||
    isGroup(s, "RADAR DE ESCANTEIOS") ||
    isGroup(s, "MERCADO DE GOLS") ||
    isGroup(s, "AMBAS MARCAM")
  ));

  // Título + primeira linha de recomendação
  const short = (s) => {
    const recLine = (s.body || "").split("\n").find(l => /Recomendação:/i.test(l)) || "";
    return `• ${s.title} — ${recLine.replace(/Recomendação:\s*/i, "")}`.trim();
  };

  return {
    elite: vitoriasVerdes.map(short),
    volume: escanteiosVerdes.map(short),
    seguranca: segurosVerdes.map(short)
  };
}

/**
* Funde as saídas do DeepSeek (estatística) e do Gemini (tática) por fixture, consolidando mercados e flags.
* - Não deixa as IAs “conversarem”; apenas realiza uma junção regrada.
* - Ordena internamente cada GRUPO por horário (kickoff) ascendente.
* - Ao final, ORDENA os grupos pela sequência pedida:
*   1) 🏆 RADAR DE VITÓRIAS
*   2) 💎 RADAR DE ESCANTEIOS
*   3) ⚽ MERCADO DE GOLS
*   4) ⚽ AMBAS MARCAM
*   5) 📝 MÚLTIPLAS (acrescentado por último)
* - NOVO: título inclui " — HH:MM" (kickoff local BR).
*/
function fuseAnalyses(deepObj, gemObj, enriched) {
  // Mapa de fixture -> dados enriquecidos (para obter kickoff, nomes etc.)
  const byId = new Map();
  for (const g of (enriched?.enriched || [])) byId.set(g.fixtureId, g);

  // Índices por fixtureId
  const mapDeep = new Map((deepObj?.games || []).map(g => [g.fixtureId, g]));
  const mapGem = new Map((gemObj?.games || []).map(g => [g.fixtureId, g]));

  // Coletores por GRUPO
  const victories = [];
  const corners = [];
  const goals = [];
  const btts = [];

  const groupsLabel = {
    VICTORY: "RADAR DE VITÓRIAS",
    CORNERS: "RADAR DE ESCANTEIOS",
    GOALS: "MERCADO DE GOLS",
    BTTS: "AMBAS MARCAM"
  };

  // --- Helpers de fusão e formatação ---
  const fuseFlag = (a, b) => {
    const A = (a || "RED").toUpperCase();
    const B = (b || "RED").toUpperCase();
    if (A === "RED" || B === "RED") return "VERMELHA";
    if (A === "GREEN" && B === "GREEN") return "VERDE";
    return "AMARELA";
  };

  const fuseDecision = (dA, dB) => {
    const A = String(dA || "NO_BET").toUpperCase();
    const B = String(dB || "NO_BET").toUpperCase();
    if (A === B) return A;
    return "NO_BET";
  };

  const fmtTitleWithKickoff = (fix) => {
    const e = byId.get(fix);
    const homeName = e?.homeTeam?.name || e?.homeTeam || "Casa";
    const awayName = e?.awayTeam?.name || e?.awayTeam || "Fora";
    const league = e?.league || "Liga";
    const hhmm = kickoffTimeLocalBR(e?.kickoff);
    return `${homeName} vs ${awayName} (${league})${hhmm ? ` — ${hhmm}` : ""}`;
  };

  const kickoffTsFor = (fix) => {
    const e = byId.get(fix);
    const t = e?.kickoff ? new Date(e.kickoff).getTime() : Number.MAX_SAFE_INTEGER;
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };

  // NOVO HELPER: Cria o layout estruturado do Card
  const formatCardBody = (rec, d, g, home, away, marketType) => {
    if (rec === "NO_BET") {
      return `❌ **ENTRADA ABORTADA**\n* **Motivo:** Filtro Sniper barrou. Risco alto ou falta de dados fortes.\n* **Check-up:**\n  * *Estatístico:* ${d?.rationale || "—"}\n  * *Tático:* ${g?.rationale || "—"}`;
    }

    let aposta = rec;
    let adv = "Adversário";

    // Formata o texto para o mercado de Vitória
    if (marketType === "VICTORY") {
      if (rec === "HOME") { aposta = `${home} Vence`; adv = away; }
      else if (rec === "AWAY") { aposta = `${away} Vence`; adv = home; }
      else if (rec === "DOUBLE_CHANCE_HOME") { aposta = `${home} ou Empate`; adv = away; }
      else if (rec === "DOUBLE_CHANCE_AWAY") { aposta = `${away} ou Empate`; adv = home; }
    } else {
      adv = rec.includes("HOME") ? away : home;
    }

    const conf = Math.max(d?.confidence || 0, g?.confidence || 0) || 75;

    return `✅ **Oportunidade:** **${aposta}** (vs ${adv})
* **Motivo:** Fusão de indicadores aponta valor e probabilidade alta nesta entrada.
* **Check-up:**
  * *Momento (xG/Stats):* ${d?.rationale || "Sem dados numéricos precisos."}
  * *Físico e Desfalques:* ${g?.rationale || "Sem informações de lesões na web."}
* **Probabilidade:** > ${conf}%`;
  };

  for (const fixtureId of new Set([...mapDeep.keys(), ...mapGem.keys()])) {
    const d = mapDeep.get(fixtureId)?.markets || {};
    const g = mapGem.get(fixtureId)?.markets || {};
    const e = byId.get(fixtureId);
    const hName = e?.homeTeam?.name || "Casa";
    const aName = e?.awayTeam?.name || "Fora";

    // Escanteios
    if (d.corners || g.corners) {
      const rec = fuseDecision(d.corners?.recommendation, g.corners?.recommendation);
      let flag = fuseFlag(d.corners?.flag, g.corners?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";

      corners.push({
        fixtureId, group: groupsLabel.CORNERS, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.corners, g.corners, hName, aName, "CORNERS"), flag
      });
    }

    // Vitórias
    if (d.victory || g.victory) {
      const rec = fuseDecision(d.victory?.recommendation, g.victory?.recommendation);
      let flag = fuseFlag(d.victory?.flag, g.victory?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";

      victories.push({
        fixtureId, group: groupsLabel.VICTORY, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.victory, g.victory, hName, aName, "VICTORY"), flag
      });
    }

    // Gols
    if (d.goals || g.goals) {
      const rec = fuseDecision(d.goals?.recommendation, g.goals?.recommendation);
      let flag = fuseFlag(d.goals?.flag, g.goals?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";

      goals.push({
        fixtureId, group: groupsLabel.GOALS, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.goals, g.goals, hName, aName, "GOALS"), flag
      });
    }

    // BTTS (Ambas Marcam)
    if (d.btts || g.btts) {
      const rec = fuseDecision(d.btts?.recommendation, g.btts?.recommendation);
      let flag = fuseFlag(d.btts?.flag, g.btts?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";

      btts.push({
        fixtureId, group: groupsLabel.BTTS, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.btts, g.btts, hName, aName, "BTTS"), flag
      });
    }
  }

  // === ORDENAR CADA GRUPO POR KICKOFF (ascendente) ===
  const sortByKickoff = (arr) => arr.sort((A, B) => kickoffTsFor(A.fixtureId) - kickoffTsFor(B.fixtureId));

  sortByKickoff(victories);
  sortByKickoff(corners);
  sortByKickoff(goals);
  sortByKickoff(btts);

  let sections = [...victories, ...corners, ...goals, ...btts];

  // --- Montagem das MÚLTIPLAS ---
  const multis = buildMultiplesFromSections(sections);
  const linhas = [];
  linhas.push("Apenas jogos com 🟢 FLAG VERDE podem ser incluídos.");
  linhas.push("");
  linhas.push("1️⃣ MÚLTIPLA DE ELITE (Vitórias)");
  if (multis.elite.length) { linhas.push(...multis.elite); } else { linhas.push("• (Sem entradas elegíveis)"); }
  linhas.push("");
  linhas.push("2️⃣ MÚLTIPLA DE VOLUME (Escanteios)");
  if (multis.volume.length) { linhas.push(...multis.volume); } else { linhas.push("• (Sem entradas elegíveis)"); }
  linhas.push("");
  linhas.push("3️⃣ MÚLTIPLA DE SEGURANÇA");
  if (multis.seguranca.length) { linhas.push(...multis.seguranca); } else { linhas.push("• (Sem entradas elegíveis)"); }

  const hasAnyMulti = multis.elite.length > 0 || multis.volume.length > 0 || multis.seguranca.length > 0;

  sections.push({
    group: "📝 MÚLTIPLAS",
    title: "Sugestão de montagem de bilhetes (conservador)",
    body: linhas.join("\n"),
    flag: hasAnyMulti ? "AMARELA" : "VERMELHA"
  });

  const formatFlagEmoji = (flag) => {
    if (flag === "VERDE") return "🟢 VERDE";
    if (flag === "AMARELA") return "🟡 AMARELA";
    return "🔴 VERMELHA";
  };

  const resultado = sections.map(s =>
    `🎯 ${s.group}\n**${s.title}**\n${s.body}\n🧪 **FLAG:** [${formatFlagEmoji(s.flag)}]\n`
  ).join("\n");

  return { sections, resultado };
}

/* ========================================================================================
*                                  HANDLER PRINCIPAL
* ====================================================================================== */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { date, limit } = req.body || {};
  if (!date) {
    return res.status(400).json({ error: "Parâmetro 'date' é obrigatório (YYYY-MM-DD)." });
  }

  try {
    // 1) ESPN grade (com TTL)
    let grade = getCache(CACHE_GRADE, date);
    if (!grade) {
      grade = await buscarJogos(date, { limit });
      setCache(CACHE_GRADE, date, grade);
    }
    if (!Array.isArray(grade) || grade.length === 0) {
      return res.status(200).json({
        status: "ok",
        date,
        generatedAt: new Date().toISOString(),
        source: { grade: "ESPN", collector: null, analyzers: [] },
        resultado: "🧭 Grade vazia ou sem jogos válidos no escopo."
      });
    }

    // 2) Coleta (Gemini) – enriquecimento (com TTL)
    let enriched = getCache(CACHE_ENRICHED, date);
    if (!enriched) {
      // CORREÇÃO: Usando a variável 'grade' correta!
      const promptCollector = montarPromptColetor(date, grade);
      console.log(`[Gemini][Collector] model=${MODEL_COLLECTOR} | Search=ON`);

      // O 'true' aqui liga a internet!
      const geminiRaw = await callGeminiJSON(promptCollector, MODEL_COLLECTOR, true);

      const parsed = safeJsonParseFromText(geminiRaw);
      if (!parsed || !Array.isArray(parsed.enriched)) {
        throw new Error("Coletor (Gemini) não retornou JSON válido com 'enriched'.");
      }

      // Garantia extra: apenas fixtures presentes na grade ESPN
      const validIds = new Set(grade.map(g => g.fixtureId));
      parsed.enriched = parsed.enriched.filter(x => validIds.has(x.fixtureId));
      enriched = parsed;
      setCache(CACHE_ENRICHED, date, enriched);
    }

    // 3) Análise (DeepSeek) – estatística (com TTL)
    let deepObj = getCache(CACHE_DEEPSEEK, date);
    if (!deepObj) {
      const promptDeep = montarPromptAnaliseDeepSeek(date, enriched);
      const deepText = await callOpenRouter(
        "deepseek/deepseek-chat",
        [
          { role: "system", content: "Você é um analista estatístico frio, segue regras matemáticas e retorna apenas JSON." },
          { role: "user", content: promptDeep }
        ],
        { jsonMode: true, max_tokens: 7000 }
      );
      deepObj = safeJsonParseFromText(deepText);
      if (!deepObj || !Array.isArray(deepObj.games)) {
        throw new Error("DeepSeek não retornou JSON válido com 'games'.");
      }
      setCache(CACHE_DEEPSEEK, date, deepObj);
    }

    // 4) Análise (Gemini) – tática/contexto (com TTL)
    let gemObj = getCache(CACHE_GEMINI_ANALYSIS, date);
    if (!gemObj) {
      const promptGem = montarPromptAnaliseGemini(date, enriched);
      console.log(`[Gemini][Tactics]   model=${MODEL_TACTICS}`);
      const gemText = await callGeminiJSON(promptGem, MODEL_TACTICS);
      gemObj = safeJsonParseFromText(gemText);
      if (!gemObj || !Array.isArray(gemObj.games)) {
        throw new Error("Gemini (análise) não retornou JSON válido com 'games'.");
      }
      setCache(CACHE_GEMINI_ANALYSIS, date, gemObj);
    }

    // 5) Fusão determinística + MÚLTIPLAS + ORDEM FIXA + ORDENAÇÃO POR KICKOFF + TÍTULO COM HH:MM
    let fused = getCache(CACHE_FUSED, date);
    if (!fused) {
      fused = fuseAnalyses(deepObj, gemObj, enriched);
      setCache(CACHE_FUSED, date, fused);
    }

    return res.status(200).json({
      status: "ok",
      date,
      generatedAt: new Date().toISOString(),
      source: { grade: "ESPN", collector: "Gemini", analyzers: ["DeepSeek", "Gemini"] },
      sections: fused.sections,
      resultado: fused.resultado // fallback textual
    });
  } catch (error) {
    console.error("🚨 ERRO CRÍTICO NO PIPELINE:", error);
    return res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}
