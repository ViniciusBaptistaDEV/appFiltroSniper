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

    // Estado de carregamento
    btn.disabled = true;
    dateEl.disabled = true;
    btnText.textContent = "Analisando...";
    loading.classList.remove("hidden");
    resultCard.classList.add("hidden");
    resultado.innerHTML = "";

    try {
        // Chamada simples; backend decide usar cache válido (<10min) ou recalcular
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

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

/** Preenche a data com "hoje" ao carregar */
window.onload = () => {
    const hoje = new Date().toISOString().split('T')[0];
    const el = document.getElementById('dateInput');
    el.value = hoje;
    // el.setAttribute("data-placeholder", "Escolha a data da rodada");
};

/** Copiar texto visível dos cards */
function copiarTexto() {
    const el = document.getElementById("resultado");
    const texto = el.innerText || "";
    const btn = document.getElementById("btnCopiar");

    navigator.clipboard.writeText(texto).then(() => {
        const original = btn.innerText;
        btn.innerText = "✅ Copiado!";
        btn.style.background = "#16a34a";
        setTimeout(() => {
            btn.innerText = original;
            btn.style.background = "";
        }, 3000);
    }).catch(err => {
        alert("Erro ao copiar: " + err);
    });
}
