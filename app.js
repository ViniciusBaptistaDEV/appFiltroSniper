async function analisar() {
    const date = document.getElementById("dateInput").value;
    if (!date) { alert("Selecione uma data!"); return; }

    const btn = document.getElementById("btnAnalisar");
    const btnText = document.getElementById("btnText"); // Adicione esta linha!
    const loading = document.getElementById("loading");
    const resultCard = document.getElementById("resultCard");
    const resultado = document.getElementById("resultado");

    btn.disabled = true;
    loading.classList.remove("hidden");
    resultCard.classList.add("hidden");

    try {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date })
        });
        const data = await response.json();

        // 🪄 MÁGICA: Transforma o texto em Cards visuais
        const textoIA = data.resultado || data.error;

        // Dividimos o texto por seções (usando os títulos da IA como divisores)
        const secoes = textoIA.split(/(?=💎|🏆|⚽|📝)/g);

        resultado.innerHTML = secoes.map(secao => {
            if (secao.trim() === "") return "";
            return `<div class="analysis-card">${formatarTexto(secao)}</div>`;
        }).join("");

        resultCard.classList.remove("hidden");
    } catch (error) {
        resultado.innerHTML = "<div class='analysis-card error'>❌ Erro na comunicação.</div>";
        resultCard.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btnText.textContent = "Analisar Jogos"; // Garante que o texto volte ao normal
        loading.classList.add("hidden");
    }
}

// Função auxiliar para formatar negritos e cores dentro do card
function formatarTexto(texto) {
    return texto
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/🟢 VERDE/g, '<span class="badge verde">VERDE</span>')
        .replace(/🟡 AMARELA/g, '<span class="badge amarela">AMARELA</span>')
        .replace(/🔴 VERMELHA/g, '<span class="badge vermelha">VERMELHA</span>')
        .replace(/\n/g, '<br>');
}

// Define a data de hoje como padrão ao carregar a página
window.onload = () => {
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('dateInput').value = hoje;
};

async function gerarPDF() {
    const elementoOriginal = document.getElementById("resultado");
    const dataSelecionada = document.getElementById("dateInput").value;
    const btnPDF = document.querySelector("#btnPDF");

    if (!elementoOriginal || elementoOriginal.children.length === 0) {
        alert("Aguarde a análise carregar antes de baixar o PDF.");
        return;
    }

    const textoOriginal = btnPDF.innerText;
    btnPDF.innerText = "⏳ Gerando...";
    btnPDF.disabled = true;

    // 1. Criar o container (usando absolute em vez de fixed para não bugar o motor de captura)
    const divTemporaria = document.createElement('div');
    divTemporaria.style.position = "absolute";
    divTemporaria.style.top = "0";
    divTemporaria.style.left = "0";
    divTemporaria.style.width = "750px"; // Largura segura para A4
    divTemporaria.style.backgroundColor = "#ffffff";
    divTemporaria.style.color = "#000000";
    divTemporaria.style.padding = "40px";
    divTemporaria.style.zIndex = "-9999"; 
    divTemporaria.style.opacity = "1";

    // 2. Cabeçalho do PDF
    divTemporaria.innerHTML = `
        <div style="text-align: center; border-bottom: 2px solid #334155; margin-bottom: 20px; padding-bottom: 10px;">
            <h1 style="margin: 0; color: #1e293b; font-family: sans-serif;">🎯 RELATÓRIO FILTRO SNIPER</h1>
            <p style="margin: 5px 0; color: #64748b; font-family: sans-serif;">Análise Tática Avançada - Rodada: ${dataSelecionada}</p>
        </div>
    `;

    // 3. Clonar e Limpar Estilos (Removendo classes que podem ter background dark no CSS global)
    const clone = elementoOriginal.cloneNode(true);
    const cards = clone.querySelectorAll('.analysis-card');
    
    cards.forEach(card => {
        // Reset total de estilos para garantir fundo branco no PDF
        card.style.all = "unset"; 
        card.style.display = "block";
        card.style.backgroundColor = "#f8fafc";
        card.style.color = "#1e293b";
        card.style.border = "1px solid #e2e8f0";
        card.style.borderLeft = "8px solid #22c55e";
        card.style.marginBottom = "20px";
        card.style.padding = "25px";
        card.style.borderRadius = "12px";
        card.style.fontFamily = "sans-serif";
        card.style.pageBreakInside = "avoid";

        // Ajustar textos e badges dentro do card
        const strongs = card.querySelectorAll('strong');
        strongs.forEach(s => s.style.color = "#0f172a");

        const badges = card.querySelectorAll('.badge');
        badges.forEach(b => {
            b.style.display = "inline-block";
            b.style.padding = "4px 10px";
            b.style.margin = "5px 0";
            b.style.borderRadius = "6px";
            b.style.color = "#ffffff";
            b.style.fontWeight = "bold";
            b.style.fontSize = "12px";
            if(b.innerText.includes('VERDE')) b.style.backgroundColor = "#16a34a";
            else if(b.innerText.includes('AMARELA')) b.style.backgroundColor = "#ca8a04";
            else b.style.backgroundColor = "#dc2626";
        });
    });

    divTemporaria.appendChild(clone);
    document.body.appendChild(divTemporaria);

    // 4. Configuração da captura
    const opt = {
        margin: 10,
        filename: `Sniper_Analise_${dataSelecionada}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            letterRendering: true,
            scrollY: -window.scrollY, // Compensa o scroll atual da página
            windowWidth: 800
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        // Aumentei o tempo para 1 segundo para garantir a renderização
        await new Promise(resolve => setTimeout(resolve, 1000));
        await html2pdf().set(opt).from(divTemporaria).save();
    } catch (e) {
        console.error("Erro no PDF:", e);
    } finally {
        document.body.removeChild(divTemporaria);
        btnPDF.innerText = textoOriginal;
        btnPDF.disabled = false;
    }
}