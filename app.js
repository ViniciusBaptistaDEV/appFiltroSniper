// UI/UX do Frontend: chama /api/analyze e renderiza os cards.
// Cache/recálculo é totalmente controlado no backend (TTL=10 minutos).

async function analisar() {
    const dateEl = document.getElementById("dateInput");
    const date = dateEl.value;
    if (!date) {
        alert("Selecione uma data!");
        return;
    }

    const btn = document.getElementById("btnAnalisar");
    const btnText = document.getElementById("btnText");
    const loading = document.getElementById("loading");
    const resultCard = document.getElementById("resultCard");
    const resultado = document.getElementById("resultado");
    const progressText = document.getElementById("progressText");

    // Estado de carregamento inicial
    btn.disabled = true;
    dateEl.disabled = true;
    btnText.textContent = "Analisando...";
    loading.classList.remove("hidden");
    resultCard.classList.add("hidden");
    resultado.innerHTML = "";
    if (progressText) progressText.textContent = "1%";
    btnText.textContent = "Analisando...";

    // Variáveis de controle do progresso suave
    let displayPercent = 0;
    let targetPercent = 1;
    let isFinished = false; // Chave para saber se o servidor já respondeu

    // 🔥 ESCONDE O CRONÔMETRO DURANTE A ANÁLISE PARA NÃO POLUIR A TELA
    if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
    document.getElementById("timerContainer").style.display = "none";


    // 🕵️‍♂️ ESPPIÃO DE PROGRESSO (Polling do Redis)
    let progressInterval = setInterval(async () => {
        if (isFinished) return; // Se já acabou, para de perguntar
        try {
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date, checkProgress: true })
            });
            const d = await res.json();

            // Se o backend devolver um número maior que zero, atualiza a tela
            if (d.progress > targetPercent) targetPercent = d.progress;
        } catch (e) { }
    }, 1500); // Consulta a cada 1.5s para ser mais ágil

    // 🚀 MOTOR DE ANIMAÇÃO (Faz o número subir de 1 em 1 para ser suave)
    let animationInterval = setInterval(() => {
        // Regra 1: Se a resposta já chegou, sobe muito rápido (2% por vez)
        if (isFinished) {
            displayPercent += 5;
        }

        // Regra 2: Se o display está atrás do alvo, sobe rápido (1% por vez)
        else if (displayPercent < targetPercent) {
            displayPercent += 1;
        }

        // Regra 3: FALSO PROGRESSO CONTROLADO (A Mágica)
        // Só sobe sozinho se estiver no MÁXIMO 12% à frente do servidor.
        else if (displayPercent < targetPercent + 12 && displayPercent < 95) {
            // Sobe 1% de forma bem mais lenta (Math.random > 0.9 exige mais ciclos para passar)
            if (Math.random() > 0.9) displayPercent += 1;
        }

        // Limita em 100
        if (displayPercent > 100) displayPercent = 100;

        // Atualiza UI
        if (progressText) progressText.textContent = `${displayPercent}%`;

    }, 80); // Velocidade da subida (80ms = bem fluido)

    try {
        // Chamada simples (A PRINCIPAL QUE RODA A IA PESADA)
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // 🏁 O servidor respondeu (Cache ou Novo)
        isFinished = true;
        targetPercent = 100;
        clearInterval(progressInterval);

        // 🛡️ TRAVA DE SEGURANÇA: Espera a animação visual chegar em 100%
        // Isso evita o pulo. O código fica "preso" aqui até o número subir.
        while (displayPercent < 100) {
            await new Promise(res => setTimeout(res, 50));
        }

        // ✅ ANÁLISE CONCLUÍDA: Limpa os intervalos e mostra 100%
        clearInterval(progressInterval);
        clearInterval(animationInterval);

        // Crava 100% na tela
        displayPercent = 100;
        if (progressText) progressText.textContent = "100%";

        // 🕒 DELAY ESTRATÉGICO
        // 🕒 AGUARDA 2 SEGUNDOS (Para o usuário ver o 100% e respirar)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 🔥 ATUALIZA O CRONÔMETRO COM O TEMPO QUE VEIO DA IA
        atualizarDisplayCronometro(data.expiresAt);

        // Preferência: sections estruturadas (novo formato)
        if (Array.isArray(data.sections) && data.sections.length > 0) {
            renderSectionsAsCards(data.sections);
            resultCard.classList.remove("hidden");
            return;
        }

        // Fallback: texto único (compatibilidade)
        const textoIA = (typeof data.resultado === "string" && data.resultado.trim().length > 0)
            ? data.resultado
            : (data.error || "⚠️ Nenhum conteúdo retornado pela análise.");
        renderRawTextAsCards(textoIA);
        resultCard.classList.remove("hidden");

    } catch (error) {
        // Limpa intervalos em caso de erro
        clearInterval(progressInterval);
        clearInterval(animationInterval);
        console.error(error);
        document.getElementById("resultado").innerHTML = `
        <div class="analysis-card" style="border-left-color:#dc2626">
            <strong>❌ Erro na comunicação</strong>
            <div style="margin-top:8px;color:#94a3b8">
            Tente novamente em instantes.
        </div>
        </div>
    `;
        resultCard.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        dateEl.disabled = false;
        btnText.textContent = "Analisar Jogos";
        loading.classList.add("hidden");
    }
}

/** Renderiza uma lista de sections [{group,title,body,flag}] como cards */
function renderSectionsAsCards(sections) {
    const container = document.getElementById("resultado");
    container.innerHTML = sections.map(sec => {
        const flagClass = flagToClass(sec.flag);

        // Parse do corpo que criamos no backend
        const parts = {};
        sec.body.split(" | ").forEach(p => {
            const m = p.match(/\[(.*?)\] ([\s\S]*)/);
            if (m) parts[m[1]] = m[2];
        });

        const isAbortado = parts["STATUS"] === "ABORTADO";

        // Normaliza o texto da flag para garantir que apareça "VERDE", "AMARELA" ou "VERMELHA"
        let badgeText = sec.flag || "";
        if (flagClass === "verde") badgeText = "VERDE";
        else if (flagClass === "amarela") badgeText = "AMARELA";
        else if (flagClass === "vermelha") badgeText = "VERMELHA";
        else if (flagClass === "multipla") badgeText = "MÚLTIPLA";

        return `
            <div class="sniper-card ${flagClass}">
                <div class="card-side-badge">${badgeText}</div>
                <div class="card-main">
                    <div class="match-league">${sec.group}</div>
                    <div class="match-title">${sec.title.split(' — ')[0]}</div>
                    <div class="match-time">
                        ${flagClass === "multipla" ? "" : (() => {
                const titleParts = sec.title.split(' — ');
                const timeStr = titleParts[1]; // Pega a parte do horário

                if (!timeStr) return '🕒 Início: --:--';

                // Captura os números da hora e minuto, independente de ter Z ou UTC
                const match = timeStr.match(/(\d{1,2}):(\d{2})/);

                if (match) {
                    const horasUTC = parseInt(match[1], 10);
                    const minutosUTC = parseInt(match[2], 10);

                    const data = new Date();
                    // Define a hora em UTC (Horário Mundial)
                    data.setUTCHours(horasUTC, minutosUTC, 0, 0);

                    // Converte automaticamente para o fuso do seu celular (Brasília)
                    const horaLocal = data.toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });

                    return `🕒 Início: ${horaLocal}`;
                }

                return `🕒 Início: ${timeStr.replace('Z', '').replace('UTC', '')}`;
            })()}
                    </div>
                    
                    ${isAbortado ? `
                        <div class="status-abort">❌ ENTRADA ABORTADA</div>
                        <div class="rationale-grid">
                            <div class="rat-item"><strong>Estatística:</strong> ${parts["ESTATISTICA"]}</div>
                            <div class="rat-item"><strong>Tático:</strong> ${parts["TACTICO"]}</div>
                        </div>
                    ` : `
                        <div class="status-success">🎯 ${parts["OPORTUNIDADE"]}</div>
                        <div class="target-info">${flagClass === "multipla" ? "Alvo" : "Alvo"}: ${parts["TARGET"]}</div>
                        <div class="rationale-grid">
                            <div class="rat-item"><strong>${flagClass === "multipla" ? "Lista" : "Momento"}:</strong> ${parts["MOMENTO"]}</div>
                            <div class="rat-item"><strong>Contexto:</strong> ${parts["CONTEXTO"]}</div>
                        </div>
                        <div class="confidence-bar-container">
                            <div class="confidence-label">Confiança: ${parts["CONFIDENCA"]}</div>
                            <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width: ${parts["CONFIDENCA"]}"></div></div>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join("");
}

/** Fallback: divide um texto longo em blocos usando cabeçalhos padrão */
function renderRawTextAsCards(texto) {
    const normalized = String(texto || "").trim();
    const blocos = normalized.split(/(?=^(\u{1F3AF}|\u{1F3C6}|⚽|📝)\s)/gmu).filter(Boolean);

    const cards = blocos.map(bloco => {
        const headerMatch = bloco.match(/^(\u{1F3AF}|\u{1F3C6}|⚽|📝)\s+([^\n]+)\n?/u);
        const header = headerMatch ? headerMatch[0].trim() : "";
        const body = bloco.replace(header, "");

        const flag = (body.match(/FLAG:\s*([^\n]+)/i) || [])[1]?.trim().toUpperCase() || "";
        const flagClass = flagToClass(flag);

        const titleLine = (body.match(/^\s*\*{0,2}\s*\*\*?(.+?)\*\*?/m) || [])[1] || "";
        const title = titleLine ? escapeHtml(titleLine) : "";

        return `
      <div class="analysis-card">
        ${header ? `<div style="opacity:.9;margin-bottom:6px">${escapeHtml(header)}</div>` : ""}
        ${title ? `<strong>${title}${flag ? ` <span class="badge ${flagClass}">${flag}</span>` : ""}</strong>` : ""}
        <div style="margin-top:10px">${escapeHtml(body).replace(/\n/g, "<br>")}</div>
      </div>
    `;
    });

    document.getElementById("resultado").innerHTML = cards.join("");
}

/** Utilitários de UI */
function flagToClass(flag) {
    const f = String(flag || "").toUpperCase();
    if (f.includes("VERDE")) return "verde";
    if (f.includes("AMARELA")) return "amarela";
    if (f.includes("VERMELHA")) return "vermelha";
    if (f.includes("MULTIPLA")) return "multipla";
    return "";
}
function emojiForGroup(group) {
    const g = (group || "").toUpperCase();
    if (g.includes("ESCANTEIOS")) return "💎";
    if (g.includes("VITÓRIAS")) return "🏆";
    if (g.includes("AMBAS MARCAM")) return "⚽";
    if (g.includes("MERCADO DE GOLS")) return "⚽";
    if (g.includes("RESUMO")) return "📝";
    return "🎯";
}
function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}


/* ====== MODELO PREMIUM - BOTÃO COPIAR ANALISE ======
/**
 * MODO PREMIUM — Texto profissional com:
 * ✔ Quadradinhos coloridos por flag
 * ✔ Emoji do tipo ao lado do grupo
 * ✔ Confiança com cor (🟢 🟡 🔴)
 * ✔ Separador premium sem gradiente (linha limpa)
 */
function copiarTexto() {
    const cards = document.querySelectorAll(".sniper-card");
    const dateInput = document.getElementById("dateInput").value;

    const dataFormatada = dateInput
        ? dateInput.split("-").reverse().join("/")
        : "DATA NÃO INFORMADA";

    // Cabeçalho Premium
    let textoFinal = `\n📅 𝐀𝐍𝐀́𝐋𝐈𝐒𝐄 𝐃𝐎 𝐃𝐈𝐀 — ${dataFormatada} \n`;
    textoFinal += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    cards.forEach(card => {

        // Dados básicos
        const flag = card.querySelector(".card-side-badge")?.innerText || "";
        const grupo = card.querySelector(".match-league")?.innerText || "";
        const titulo = card.querySelector(".match-title")?.innerText || "";
        const inicio = card.querySelector(".match-time")?.innerText || "";

        const oportunidade = card.querySelector(".status-success")?.innerText.replace("🎯 ", "") || "Abortado";
        const alvo = card.querySelector(".target-info")?.innerText || "";

        const ratItems = card.querySelectorAll(".rat-item");
        const momento = ratItems[0]?.innerText.replace(/^(Momento|Lista):/i, "").trim() || "";
        const contexto = ratItems[1]?.innerText.replace(/^Contexto:/i, "").trim() || "";

        let confianca = card.querySelector(".confidence-label")?.innerText.replace("Confiança:", "").trim() || "";

        // Converte confiança em número e aplica o emoji correto
        const confiancaNum = parseInt(confianca.replace("%", "").trim());
        let confEmoji = "🟢";
        if (confiancaNum < 70) confEmoji = "🔴";
        else if (confiancaNum < 85) confEmoji = "🟡";

        // Quadradinho colorido pela flag
        let quadrado = "⬜";
        if (flag.includes("VERDE")) quadrado = "🟩";
        if (flag.includes("AMARELA")) quadrado = "🟨";
        if (flag.includes("VERMELHA")) quadrado = "🟥";
        if (flag.includes("MÚLTIPLA")) quadrado = "🟦";

        // Emoji do tipo ao lado do grupo
        let emojiTipo = "🎯";
        if (grupo.toUpperCase().includes("VITÓRIAS")) emojiTipo = "🏆";
        if (grupo.toUpperCase().includes("GOLS")) emojiTipo = "⚽";
        if (grupo.toUpperCase().includes("AMBAS")) emojiTipo = "⚽";
        if (grupo.toUpperCase().includes("ESCANTEIOS")) emojiTipo = "💎";
        if (flag.includes("MÚLTIPLA")) emojiTipo = "🎫";
        if (flag.includes("VERMELHA")) emojiTipo = "⛔";

        // Bloco premium final
        textoFinal += `${quadrado} *${emojiTipo} ${grupo}*\n`;
        textoFinal += `*${titulo}*\n`;
        textoFinal += `${inicio}\n`;
        textoFinal += `🎯 *${oportunidade}*\n`;
        textoFinal += `🎯 *${alvo}*\n\n`;

        textoFinal += `📌 *Momento:* ${momento}\n`;
        textoFinal += `📊 *Contexto:* ${contexto}\n`;
        textoFinal += `📈 *Confiança:* ${confEmoji} ${confianca}\n`;

        // 🔥 Separador Premium (sem gradiente)
        textoFinal += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    });

    // Feedback no botão
    const btn = document.getElementById("btnCopiar");

    navigator.clipboard.writeText(textoFinal).then(() => {
        const original = btn.innerText;
        btn.innerText = "✅ Copiado!";
        btn.style.background = "#16a34a";
        setTimeout(() => {
            btn.innerText = original;
            btn.style.background = "";
        }, 3000);
    });
}

/* =========================================================
    FUNÇÕES DO CRONÔMETRO MINIMALISTA E COMUNICAÇÃO COM REDIS
   ========================================================= */
let timerInterval;

function atualizarDisplayCronometro(tempoExpiracao) {
    clearInterval(timerInterval);
    const container = document.getElementById('timerContainer');
    const display = document.getElementById('countdownTimer');

    // Se não tiver tempo ou já tiver vencido
    if (!tempoExpiracao || tempoExpiracao <= Date.now()) {
        container.style.display = 'block';
        display.innerHTML = "Nova Análise Liberada";
        display.style.color = "#10b981"; // Verde esmeralda elegante
        return;
    }

    container.style.display = 'block';

    timerInterval = setInterval(() => {
        const agora = Date.now();
        const distancia = tempoExpiracao - agora;

        if (distancia <= 0) {
            clearInterval(timerInterval);
            display.innerHTML = "Nova Análise Liberada";
            display.style.color = "#10b981";
            return;
        }

        const horas = Math.floor((distancia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((distancia % (1000 * 60 * 60)) / (1000 * 60));
        const segundos = Math.floor((distancia % (1000 * 60)) / 1000);

        display.innerHTML =
            String(horas).padStart(2, '0') + ":" +
            String(minutos).padStart(2, '0') + ":" +
            String(segundos).padStart(2, '0');

        display.style.color = "#10b981"; // Verde esmeralda elegante
    }, 1000);
}

// Pergunta ao Redis (Backend) quanto tempo falta para o cache expirar
async function verificarCacheRedis(dataSelecionada) {
    const container = document.getElementById('timerContainer');
    const display = document.getElementById('countdownTimer');

    container.style.display = 'block';
    display.innerHTML = "Sincronizando...";
    display.style.color = "#10b981";
    clearInterval(timerInterval);

    try {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: dataSelecionada, checkCacheOnly: true })
        });

        const data = await response.json();

        if (data.expiresAt) {
            atualizarDisplayCronometro(data.expiresAt);
        } else {
            display.innerHTML = "Nova Análise Liberada";
            display.style.color = "#10b981";
        }
    } catch (error) {
        display.innerHTML = "Sistema Pronto";
    }
}


/* =========================================================
    QUANDO CARREGAR A TELA ACONTECE ISSO AQUI EMBAIXO
   ========================================================= */

/** Preenche a data com "hoje" ao carregar */
window.onload = () => {
    const hoje = new Date().toISOString().split('T')[0];
    const el = document.getElementById('dateInput');
    el.value = hoje;

    // Verifica o cache diretamente no Redis logo ao abrir a página
    verificarCacheRedis(hoje);

    // Se você escolher outra data no calendário, ele pergunta pro Redis de novo
    el.addEventListener('change', (e) => {
        verificarCacheRedis(e.target.value);
    });
};
