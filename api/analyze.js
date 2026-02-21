// Pipeline: ESPN (grade) -> Gemini (coleta) + Football-Data -> DeepSeek (análise estatística) -> Gemini (análise tática)
// -> Fusão determinística -> Saída para o front.
// Implementa cache com TTL de 10 minutos (idempotência em desktop/mobile).
// IMPORTANTE: defina GEMINI_API_KEY, OPENROUTER_API_KEY e FOOTBALL_DATA_API_KEY em Vercel.

import { buscarJogos } from "./football.js";
import {
  montarPromptColetor,
  montarPromptAnaliseDeepSeek,
  montarPromptAnaliseGemini
} from "./buildPrompt.js";

// 1. Limpeza agressiva das variáveis de ambiente (Remove aspas e espaços invisíveis)
const cleanEnv = (key) => process.env[key]?.replace(/['"]/g, '').trim();

const REDIS_URL = cleanEnv('UPSTASH_REDIS_REST_URL')?.replace(/\/$/, '');
const REDIS_TOKEN = cleanEnv('UPSTASH_REDIS_REST_TOKEN');

// 2. Garante que os modelos usem o ID correto e limpo
const MODEL_COLLECTOR = cleanEnv('GEM_COLLECTOR_MODEL') || "gemini-2.5-flash";
const MODEL_TACTICS = cleanEnv('GEM_TACTICS_MODEL') || "gemini-2.5-flash";

/* ========================================================================================
* CACHE GLOBAL (REDIS UPSTASH) - TTL 10m
* ====================================================================================== */

const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS) || 600; // Default: 600s (10 min)

async function getCache(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await res.json();
    if (!data.result) return null;
    return JSON.parse(data.result);
  } catch (err) {
    console.error("Redis GET error:", err);
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
    console.error("Redis SET error:", err);
  }
}

/* ========================================================================================
* HELPERS HTTP (OpenRouter / Gemini / Football-Data)
* ====================================================================================== */

/**
* Chama o Gemini 2.5 (Flash/Pro) forçando saída em JSON.
*/
// Função de limpeza ultra-segura para variáveis da Vercel
const cleanVar = (val) => String(val || "").replace(/['"]/g, "").trim();

async function callGeminiJSON(promptText, model = "gemini-1.5-flash", useSearch = false) {
  const apiKey = cleanVar(process.env.GEMINI_API_KEY);
  const cleanModel = cleanVar(model);

  // LÓGICA SNIPER: 2.5 e Search exigem v1beta. O resto pode usar v1.
  const apiVersion = (cleanModel.includes("2.5") || useSearch) ? "v1beta" : "v1";

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanModel}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.1,
      // O Search Grounding não aceita response_mime_type: json
      ...(useSearch ? {} : { response_mime_type: "application/json" })
    }
  };

  // 2. Configuração da Ferramenta de Busca (Simplificada para 2026)
  if (useSearch) {
    // O Google agora exige 'googleSearch' em vez de 'googleSearchRetrieval'
    payload.tools = [{
      googleSearch: {}
    }];
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();

  if (data.error) {
    // Se der 404 na v1beta, tentamos um fallback rápido sem o prefixo models/ ou mudando o modelo
    console.error(`🚨 ERRO DA API GEMINI (${apiVersion}):`, JSON.stringify(data.error, null, 2));
    throw new Error(`API Gemini recusou: ${data.error.message}`);
  }

  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (useSearch) {
    text = text.replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
  }

  return text;
}

/**
 * Parse JSON ultra-resiliente: Aceita JSON sujo, com markdown e
 * corrige se o Gemini esquecer a chave "games".
 */
function safeJsonParseFromText(txt) {
  try {
    const firstBrace = txt.indexOf("{");
    const firstBracket = txt.indexOf("[");

    // Identifica onde começa o JSON de verdade (seja { ou [)
    let start = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) start = firstBrace;
    else if (firstBracket !== -1) start = firstBracket;

    const lastBrace = txt.lastIndexOf("}");
    const lastBracket = txt.lastIndexOf("]");
    const end = Math.max(lastBrace, lastBracket);

    if (start === -1 || end === -1) return null;

    let cleanJson = txt.slice(start, end + 1);
    let parsed = JSON.parse(cleanJson);

    // MÁGICA: Se o Gemini retornar um array direto [...], 
    // nós envelopamos em { "games": [...] } para não quebrar o pipeline
    if (Array.isArray(parsed)) {
      return { games: parsed };
    }
    return parsed;
  } catch (e) {
    console.error("🚨 ERRO NO PARSE:", e.message);
    return null;
  }
}

/**
* Busca estatísticas na API Football-Data
*/
async function fetchFootballDataMatches(date) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ FOOTBALL_DATA_API_KEY não configurada. Pulando API Football-Data.");
    return { matches: [] };
  }

  try {
    const resp = await fetch(`https://api.football-data.org/v4/matches?date=${date}`, {
      headers: { "X-Auth-Token": apiKey }
    });
    if (!resp.ok) {
      console.warn(`⚠️ Football-Data retornou erro HTTP ${resp.status}`);
      return { matches: [] };
    }
    return await resp.json();
  } catch (error) {
    console.error("🚨 Falha ao conectar com Football-Data:", error.message);
    return { matches: [] };
  }
}

/**
* Cruza os dados da ESPN com o Football-Data (Versão Sniper Ultra-Agressiva)
*/
/**
 * Matcher de Times 4.1 (Seguro contra Derbys)
 * Remove APENAS siglas associativas e acentos, preservando a identidade do time.
 */
function matchFootballData(espnGame, fdMatches) {
  if (!fdMatches || !Array.isArray(fdMatches)) return null;

  // Limpeza cirúrgica: tira acentos e SÓ sufixos inúteis
  const cleanForMatch = (name) => {
    return String(name || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Tira acentos (ex: Atlético -> atletico)
      // Remove APENAS siglas de clubes esportivos
      .replace(/\b(fc|cf|fk|sc|cd|ud|rc|afc|fbc|fsv|vfl|vfb|1\.|sv)\b/g, "") 
      .replace(/[^a-z0-9]/g, "") // Remove espaços e traços, juntando tudo
      .trim();
  };

  const eH = cleanForMatch(espnGame.homeTeam);
  const eA = cleanForMatch(espnGame.awayTeam);

  return fdMatches.find(m => {
    const fH = cleanForMatch(m.homeTeam?.name || m.homeTeam?.shortName);
    const fA = cleanForMatch(m.awayTeam?.name || m.awayTeam?.shortName);

    // O nome precisa ter pelo menos 4 letras para evitar falsos positivos com siglas
    const homeMatch = (eH.length > 3 && fH.includes(eH)) || (fH.length > 3 && eH.includes(fH)) || eH === fH;
    const awayMatch = (eA.length > 3 && fA.includes(eA)) || (fA.length > 3 && eA.includes(fA)) || eA === fA;

    return homeMatch && awayMatch;
  });
}

/* ========================================================================================
* UTILIDADES DE FORMATAÇÃO (kickoff local BR)
* ====================================================================================== */

function kickoffTimeLocalBR(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  try {
    return date.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

/* ========================================================================================
* FUSÃO DETERMINÍSTICA
* ====================================================================================== */

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

function fuseAnalyses(deepObj, gemObj, enriched) {
  const byId = new Map();
  for (const g of (enriched?.enriched || [])) byId.set(g.fixtureId, g);

  const mapDeep = new Map((deepObj?.games || []).map(g => [g.fixtureId, g]));
  const mapGem = new Map((gemObj?.games || []).map(g => [g.fixtureId, g]));

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

  const formatCardBody = (rec, d, g, home, away, marketType) => {
    if (rec === "NO_BET") {
      return `[STATUS] ABORTADO | [MOTIVO] Risco alto ou falta de dados fortes. | [ESTATISTICA] ${d?.rationale || "—"} | [TACTICO] ${g?.rationale || "—"}`;
    }

    let aposta = rec;
    let adv = "Adversário";

    if (marketType === "VICTORY") {
      if (rec === "HOME") { aposta = `${home} Vence`; adv = away; }
      else if (rec === "AWAY") { aposta = `${away} Vence`; adv = home; }
      else if (rec === "DOUBLE_CHANCE_HOME") { aposta = `${home} ou Empate`; adv = away; }
      else if (rec === "DOUBLE_CHANCE_AWAY") { aposta = `${away} ou Empate`; adv = home; }
    } else {
      adv = rec.includes("HOME") ? away : home;
    }

    const conf = Math.max(d?.confidence || 0, g?.confidence || 0) || 75;

    // Retornamos o texto formatado com "Tags" para o frontend tratar
    return `[OPORTUNIDADE] ${aposta} | [TARGET] vs ${adv} | [MOMENTO] ${d?.rationale || "Análise baseada em posição de tabela e odds."} | [CONTEXTO] ${g?.rationale || "Análise baseada em notícias e estilo de jogo."} | [CONFIDENCA] ${conf}%`;
  };

  for (const fixtureId of new Set([...mapDeep.keys(), ...mapGem.keys()])) {
    const d = mapDeep.get(fixtureId)?.markets || {};
    const g = mapGem.get(fixtureId)?.markets || {};
    const e = byId.get(fixtureId);
    const hName = e?.homeTeam?.name || "Casa";
    const aName = e?.awayTeam?.name || "Fora";

    if (d.corners || g.corners) {
      const rec = fuseDecision(d.corners?.recommendation, g.corners?.recommendation);
      let flag = fuseFlag(d.corners?.flag, g.corners?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";
      corners.push({
        fixtureId, group: groupsLabel.CORNERS, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.corners, g.corners, hName, aName, "CORNERS"), flag
      });
    }

    if (d.victory || g.victory) {
      const rec = fuseDecision(d.victory?.recommendation, g.victory?.recommendation);
      let flag = fuseFlag(d.victory?.flag, g.victory?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";
      victories.push({
        fixtureId, group: groupsLabel.VICTORY, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.victory, g.victory, hName, aName, "VICTORY"), flag
      });
    }

    if (d.goals || g.goals) {
      const rec = fuseDecision(d.goals?.recommendation, g.goals?.recommendation);
      let flag = fuseFlag(d.goals?.flag, g.goals?.flag);
      if (rec === "NO_BET") flag = "VERMELHA";
      goals.push({
        fixtureId, group: groupsLabel.GOALS, title: fmtTitleWithKickoff(fixtureId),
        body: formatCardBody(rec, d.goals, g.goals, hName, aName, "GOALS"), flag
      });
    }

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

  const sortByKickoff = (arr) => arr.sort((A, B) => kickoffTsFor(A.fixtureId) - kickoffTsFor(B.fixtureId));

  sortByKickoff(victories);
  sortByKickoff(corners);
  sortByKickoff(goals);
  sortByKickoff(btts);

  let sections = [...victories, ...corners, ...goals, ...btts];

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
* HANDLER PRINCIPAL
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
    let grade = await getCache(`GRADE:${date}`);
    if (!grade) {
      grade = await buscarJogos(date, { limit });
      await setCache(`GRADE:${date}`, grade);
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

    // 2) Coleta Paralela (Gemini Notícias + Football-Data Estatísticas)
    let enriched = await getCache(`ENRICHED:${date}`);
    if (!enriched) {
      const promptCollector = montarPromptColetor(date, grade);
      console.log(`[Gemini][Collector] model=${MODEL_COLLECTOR} | Search=ON | +Football-Data`);

      // Dispara simultaneamente a pesquisa web e a API Football-Data
      const [geminiRaw, fdData] = await Promise.all([
        callGeminiJSON(promptCollector, MODEL_COLLECTOR, true),
        fetchFootballDataMatches(date)
      ]);

      const parsed = safeJsonParseFromText(geminiRaw);
      if (!parsed || !Array.isArray(parsed.enriched)) {
        throw new Error("Coletor (Gemini) não retornou JSON válido com 'enriched'.");
      }

      // NOVO: Log para verificar o que o coletor achou antes de filtrar
      console.log("===== 🔍 DADOS BRUTOS DO COLETOR =====");
      parsed.enriched.forEach(j => {
        console.log(`${j.homeTeam?.name || j.homeTeam} vs ${j.awayTeam?.name || j.awayTeam}: Position H:${j.table_context?.home_position} V:${j.table_context?.away_position}`);
      });

      const validIds = new Set(grade.map(g => g.fixtureId));
      let enrichedArray = parsed.enriched.filter(x => validIds.has(x.fixtureId));

      // Injeta os dados do Football-Data no JSON enriquecido
      enrichedArray = enrichedArray.map(jogo => {
        const fdMatch = matchFootballData(jogo, fdData.matches);
        if (fdMatch) {
          jogo.footballDataStats = {
            status: fdMatch.status,
            score: fdMatch.score,
            odds: fdMatch.odds || null,
            // A API pode retornar estatísticas avançadas dependendo do endpoint/plano
            statistics: fdMatch.statistics || null
          };
        }
        return jogo;
      });

      enriched = { enriched: enrichedArray };

      // === COMANDO DE TESTE: VALIDAÇÃO MUNIÇÃO SNIPER ===
      console.log("===== 🎯 VALIDAÇÃO: MUNIÇÃO SNIPER (API DATA) =====");
      enrichedArray.forEach(j => {
        const stats = j.footballDataStats;
        const status = stats ? "✅ CARREGADA" : "❌ VAZIA (Sem match)";
        const odds = stats?.odds ? `| Odds: H:${stats.odds.homeWin} E:${stats.odds.draw} V:${stats.odds.awayWin}` : "| Sem Odds";
        console.log(`- ${j.homeTeam?.name || j.homeTeam}: ${status} ${odds}`);
      });
      // ================================================

      await setCache(`ENRICHED:${date}`, enriched);
    }

    // 3) Análise (Gemini Estatístico)
    let deepObj = await getCache(`DEEPSEEK:${date}`);
    if (!deepObj) {
      const promptDeep = montarPromptAnaliseDeepSeek(date, enriched);
      console.log(`[Gemini][Statistics] model=${MODEL_COLLECTOR}`);

      // Forçamos o aviso de JSON no final do prompt aqui também
      const finalPrompt = promptDeep + "\n\nResponda APENAS o objeto JSON, sem markdown e sem explicações.";
      const deepText = await callGeminiJSON(finalPrompt, MODEL_COLLECTOR);

      deepObj = safeJsonParseFromText(deepText);
      if (!deepObj || !Array.isArray(deepObj.games)) {
        // Se falhar, tentamos um fallback de objeto vazio para não travar o pipeline
        console.warn("⚠️ Fallback: Gemini falhou no JSON, gerando estrutura vazia.");
        deepObj = { games: grade.map(g => ({ fixtureId: g.fixtureId, markets: {}, overallFlag: "RED" })) };
      }
      await setCache(`DEEPSEEK:${date}`, deepObj);
    }

    // 4) Análise (Gemini) – tática/contexto
    let gemObj = await getCache(`GEMINI_ANALYSIS:${date}`);
    if (!gemObj) {
      const promptGem = montarPromptAnaliseGemini(date, enriched);
      console.log(`[Gemini][Tactics]   model=${MODEL_TACTICS}`);
      const gemText = await callGeminiJSON(promptGem, MODEL_TACTICS);
      gemObj = safeJsonParseFromText(gemText);
      if (!gemObj || !Array.isArray(gemObj.games)) {
        throw new Error("Gemini (análise) não retornou JSON válido com 'games'.");
      }
      await setCache(`GEMINI_ANALYSIS:${date}`, gemObj);
    }

    // 5) Fusão determinística
    let fused = await getCache(`FUSED:${date}`);
    if (!fused) {
      fused = fuseAnalyses(deepObj, gemObj, enriched);
      await setCache(`FUSED:${date}`, fused);
    }

    return res.status(200).json({
      status: "ok",
      date,
      generatedAt: new Date().toISOString(),
      source: { grade: "ESPN", collector: "Gemini + Football-Data", analyzers: ["DeepSeek", "Gemini"] },
      sections: fused.sections,
      resultado: fused.resultado
    });
  } catch (error) {
    console.error("🚨 ERRO CRÍTICO NO PIPELINE:", error);
    return res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}