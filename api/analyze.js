// Pipeline Sniper V8.1: ESPN (grade) -> Gemini (Busca + Análise + Decisão) -> Saída para o front.
// Implementa cache global com Upstash Redis (TTL) para economizar requisições.

/* ===================  APIs  =================== */
// Usar apenas uma das duas opções:
// gemini-2.5-flash
// gemini-3-flash
/* ============================================== */

import { buscarJogos } from "./football.js";
import { montarPromptSniper } from "./buildPrompt.js";
import { obterOddsDoDia, buscarOddsParaCard } from "./oddsFetcher.js";

// Função para limpar as chaves da Vercel (evita erro de aspas invisíveis)
const cleanEnv = (key) => process.env[key]?.replace(/['"]/g, '').trim();

// Configurações de Banco de Dados e IA
const REDIS_URL = cleanEnv('UPSTASH_REDIS_REST_URL')?.replace(/\/$/, '');
const REDIS_TOKEN = cleanEnv('UPSTASH_REDIS_REST_TOKEN');
const MODEL_SNIPER = cleanEnv('GEM_COLLECTOR_MODEL');
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS);

/* ========================================================================================
  CACHE GLOBAL (REDIS UPSTASH)
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


/* =======================================================================================
  SISTEMA DE LOGS DE ERRO NO REDIS (COM AUTODESTRUIÇÃO)
======================================================================================= */
async function salvarLogErroRedis(contexto, erroDetalhe) {

  if (!REDIS_URL || !REDIS_TOKEN) return;

  try {

    const agora = new Date();
    const timestampMs = agora.getTime(); // Ex: 1775250000000 (Garante que nunca vai repetir a chave)

    // 🔥 MÁGICA DO HORÁRIO: Força o fuso do Brasil e formata para dd/mm/aaaa - 00:00:00
    const dataFormatada = agora.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).replace(', ', ' - '); // Troca a vírgula padrão do JS por um traço

    // 1. Chave Única (Não mistura os logs)
    const chaveLog = `LOG_ERRO_SNIPER:${contexto}:${timestampMs}`;

    // Extraindo os textos do erro antes de montar o payload
    const textoMensagem = erroDetalhe?.message || String(erroDetalhe);
    const textoStack = erroDetalhe?.stack || "Sem detalhes adicionais";

    // 2. O conteúdo que você vai ler depois
    const payloadLog = {
      dataErro: dataFormatada,
      origem: contexto, // Diz se foi o Gemini, a ESPN, as Odds ou um Crash Global
      // 🔥 MÁGICA: Corta o texto onde tem '\n' e transforma em uma lista organizada
      mensagem: textoMensagem.split('\n').map(linha => linha.trim()).filter(Boolean),
      stack: textoStack.split('\n').map(linha => linha.trim()).filter(Boolean)
    };

    // 3. Tempo de expiração em segundos (Ex: 3 dias = 259.200 segundos - 2 dias = 172800 segundos - 1 dia = 86400 segundos)
    const tempoExpiracaoSegundos = 172800;

    // Envia para o Upstash usando o parâmetro ?EX= para autodestruição
    await fetch(`${REDIS_URL}/set/${chaveLog}?EX=${tempoExpiracaoSegundos}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payloadLog)
    });

    console.log(`\n\n🚨 [SISTEMA] Falha no Lote ${contexto}. Log gravado no Redis: ${chaveLog}\n`);

  } catch (e) {

    console.error("\n\nFalha ao tentar salvar o log no Redis:", e);
    console.error("\n\nDetalhes do erro:", e.message);

  }
}


/* ========================================================================================
  CACHE DE ODDS REAIS (CACHE DE 10 MINUTOS INDEPENDENTE)
* ====================================================================================== */
async function getEnrichedSections(sections, date, jogosESPN) {
  const ODDS_CACHE_KEY = `SNIPER_ODDS_V3:${date}`;
  let oddsDoDia = await getCache(ODDS_CACHE_KEY);

  if (!oddsDoDia || !oddsDoDia.length) {
    // 🔥 Agora passamos a grade já pronta, acabando com a lentidão!
    oddsDoDia = await obterOddsDoDia(date, jogosESPN);

    if (oddsDoDia && oddsDoDia.length > 0 && REDIS_URL && REDIS_TOKEN) {
      await fetch(`${REDIS_URL}/set/${ODDS_CACHE_KEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(oddsDoDia)
      });

      // 600 (10 minutos) - 900 (15 minutos) - 1200 (20 minutos)
      await fetch(`${REDIS_URL}/expire/${ODDS_CACHE_KEY}/900`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
    }
  } else {
    // 🔥 Log informativo de leitura de cache das ODDS
    console.log(`⚡ [CACHE] Leitura instantânea das ODDS do Redis.\n`);
  }

  return sections.map(sec => {
    if (sec.group === "⛔ JOGOS ABORTADOS" || sec.flag === "VERMELHA" || sec.group === "🎫 BILHETE COMBINADO") {
      return { ...sec, odds: null };
    }

    return {
      ...sec,
      odds: buscarOddsParaCard(sec, oddsDoDia)
    };
  });
}


/* ========================================================================================
  GEMINI CORE (MOTOR DE BUSCA E ANÁLISE)
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
  FUNÇÕES AUXILIARES DO NOVO MOTOR TURBO
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
export const maxDuration = 300;



/* ========================================================================================
    HANDLER PRINCIPAL (O MAESTRO DO SISTEMA)
* ====================================================================================== */

export default async function handler(req, res) {

  // 🔒 1. TRAVA DE SEGURANÇA (LOGIN E SENHA)
  const reqUser = req.headers['x-admin-user'];
  const reqPass = req.headers['x-admin-pass'];

  if (reqUser !== process.env.ADMIN_USER || reqPass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Acesso negado. Credenciais inválidas.' });
  }

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
        resultado: "🧭 Grade de jogos vazia ou sem jogos válidos para análises.",
        sections: []
      });
    }

    // console.log(`\n⚽ [ESPN] Grade carregada com sucesso: ${grade.length} jogos encontrados para a data ${date}.`);

    // ---------------------------------------------------------
    // ETAPA 2: Acionar o Motor de Inteligência Analítica em PARALELO
    // ---------------------------------------------------------
    let analisePronta = await getCache(`SNIPER_V12:${date}`);

    if (!analisePronta) {

      let tamanhoLote = 3; //quantos jogos analisa em cada lote - VALOR PADRÃO

      // 🔥 LOTE INTELIGENTE: Distribui os jogos garantindo no máximo 5 lotes (5 RPM - GEMINI)
      if (grade.length > 10) {
        // De 11 a 15 jogos (Gera até 5 lotes de 3)
        tamanhoLote = 3;
        console.log(`\n🧠 [SISTEMA] Grade grande (${grade.length} jogos). Ajustando lote para 3 jogos.`);
      }
      else if (grade.length > 5 && grade.length <= 10) {
        // De 6 a 10 jogos (Gera até 5 lotes de 2)
        tamanhoLote = 2;
        console.log(`\n🧠 [SISTEMA] Grade média (${grade.length} jogos). Ajustando lote para 2 jogos.`);
      }
      else if (grade.length >= 1 && grade.length <= 5) {
        // De 1 a 5 jogos (Gera até 5 lotes de 1 - Foco Máximo da IA)
        tamanhoLote = 1;
        console.log(`\n🧠 [SISTEMA] Grade pequena (${grade.length} jogos). Ajustando lote para 1 jogo.`);
      }

      const lotes = fatiarArray(grade, tamanhoLote);
      let lotesConcluidos = 0;

      console.log(`🚀 [SISTEMA] Iniciando fatiamento de ${grade.length} jogos em lotes de ${tamanhoLote} jogos cada...`);



      // =========================================================================
      // 🔥 MOTOR SEQUENCIAL (FILA INDIANA) - TENTATIVAS AUTOMÁTICAS - 1 RETRY
      // =========================================================================
      
      // Array que vai guardar os cards prontos de todos os lotes em ordem
      const resultadosSequenciais = [];

      // Passa por cada lote de jogos (ex: Lote 1, Lote 2, Lote 3...)
      for (let index = 0; index < lotes.length; index++) {
        const lote = lotes[index];
        const prompt = montarPromptSniper(date, lote);

        console.log(`\n⏳ [GEMINI] Iniciando processamento do Lote ${index + 1} de ${lotes.length}...`);

        // Variáveis de controle do sistema de Repetição (Retry)
        let tentativas = 0;
        const maxTentativas = 2; // O sistema vai fazer 1 tentativa normal + 1 chance extra (retry)
        let sucessoNoLote = false; // Flag para avisar quando a IA responder corretamente

        // Fica rodando em loop enquanto não atingir o limite de tentativas E não tiver sucesso
        while (tentativas < maxTentativas && !sucessoNoLote) {
          try {
            tentativas++; // Conta em qual tentativa estamos (1 ou 2)
            
            // Se for a tentativa extra, avisa no log da Vercel
            if (tentativas > 1) {
                console.log(`🔄 [RETRY] Segunda e última tentativa para o Lote ${index + 1}...`);
            }

            // Dispara o texto para a IA do Google e aguarda a resposta
            const geminiResponse = await callGeminiJSON(prompt, MODEL_SNIPER, true);

            // Log de depuração para vermos o que a IA mandou antes de tratar os dados
            console.log(`\n=== 🕵️‍♂️ RESPOSTA CRUA DA IA (LOTE ${index + 1}) ===`);
            console.log(geminiResponse);
            console.log(`=========================================\n`);

            // Tenta transformar o texto da IA em um objeto JSON válido
            const parsed = safeJsonParseFromText(geminiResponse);

            // Se o JSON for válido e contiver os cards (sections)...
            if (parsed && parsed.sections) {
              resultadosSequenciais.push(parsed.sections); // Salva os cards gerados
              sucessoNoLote = true; // SUCESSO! A IA respondeu bem, isso quebra o loop 'while' e avança.
            } else {
              // Se o código chegou aqui, a IA respondeu, mas não mandou um JSON válido (mandou vazio ou texto solto)
              console.warn(`⚠️ [AVISO] IA retornou vazio no Lote ${index + 1}.`);
              
              if (tentativas === maxTentativas) {
                // Se já era a última tentativa, desiste e passa um array vazio para não quebrar o app
                console.log(`🚨 IA falhou na última tentativa. Desistindo do Lote ${index + 1}.`);
                resultadosSequenciais.push([]); 
              } else {
                // Se ainda tem tentativa sobrando, descansa 5 segundos para a IA "respirar" e tenta de novo
                console.log(`⏸️ Aguardando 5 segundos para a última tentativa...`);
                await new Promise(r => setTimeout(r, 5000));
              }
            }

          } catch (err) {
            // Se o código caiu aqui, foi erro de rede, erro 503 (Servidor Ocupado) ou a API caiu
            console.error(`🚨 Erro no Lote ${index + 1} (Tentativa ${tentativas}):`, err.message);

            if (tentativas >= maxTentativas) {
              // Se a rede falhou nas duas vezes, salva o erro no banco de dados (Redis) para vermos depois
              // e entrega um array vazio para o cliente não ficar travado na tela de loading
              await salvarLogErroRedis(`GEMINI_LOTE_${index + 1}`, err);
              resultadosSequenciais.push([]); 
            } else {
              // Deu erro na primeira tentativa, então aguarda 5s para o servidor do Google normalizar
              console.log(`⏳ Servidor ocupado. Aguardando 5s para tentar a última vez...`);
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        } // Fim do loop 'while' (O lote atual foi resolvido, seja com sucesso ou falha)



        // =========================================================================
        // ATUALIZAÇÃO DO PROGRESSO E TRANSIÇÃO DE LOTE
        // =========================================================================
        
        // Atualiza a barra de carregamento na tela do celular do cliente
        lotesConcluidos++;
        const porcentagem = Math.round((lotesConcluidos / lotes.length) * 95);
        await setCache(`PROGRESS:${date}`, porcentagem);

        // Se este NÃO for o último lote, faz uma pausa de 4 segundos antes de mandar o próximo.
        // Isso evita que o Google nos bloqueie por excesso de requisições contínuas.
        if (index < lotes.length - 1) {
          console.log(`⏸️ [SISTEMA] Pausa de transição (4 segundos) antes do próximo lote...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }

      await setCache(`PROGRESS:${date}`, 98); // 98% - Processando múltiplas e filtros finais

      // Junta todas as respostas sequenciais em uma lista gigante única
      let todasAsSections = resultadosSequenciais.flat();


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
      console.log(`\n✅ [SUCESSO] Grade completa analisada e salva no Redis.\n`);
    } else {
      console.log('\n=================================================');
      console.log(`⚡ [CACHE] Leitura instantânea do Redis para a data ${date}.\n`);
    }


    // ---------------------------------------------------------
    // ETAPA 3: Devolver o resultado pronto para o front
    // ---------------------------------------------------------
    // 🔥 MESCLANDO OS DADOS COM AS ODDS:
    const sectionsComOdds = await getEnrichedSections(analisePronta.sections, date, grade);

    return res.status(200).json({
      status: "ok",
      date,
      generatedAt: new Date().toISOString(),
      expiresAt: analisePronta.expiresAt, // 🔥 Envia o tempo para o Front-end
      source: { grade: "ESPN", ai: `Motor IA: ${MODEL_SNIPER} + Lotes Turbo Paralelo` },
      sections: sectionsComOdds, // Devolvemos os cards já com as Odds Reais embutidas!
      resultado: analisePronta.resultado
    });

  } catch (error) {

    console.error("🚨 ERRO CRÍTICO NO PIPELINE:", error);

    // 🔥 Captura falhas fatais do sistema e envia pro Redis
    await salvarLogErroRedis("CRASH_GLOBAL_SISTEMA", error);

    return res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });

  }
}
