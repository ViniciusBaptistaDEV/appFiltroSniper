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

    // 1. Criar o container visível, mas posicionado atrás do site
    const divTemporaria = document.createElement('div');
    divTemporaria.id = "temp-pdf-container";
    divTemporaria.style.position = "fixed";
    divTemporaria.style.top = "0";
    divTemporaria.style.left = "0";
    divTemporaria.style.width = "790px"; // Largura próxima ao A4
    divTemporaria.style.zIndex = "-1000"; // Fica atrás de tudo
    divTemporaria.style.backgroundColor = "#ffffff";
    divTemporaria.style.color = "#000000";
    divTemporaria.style.padding = "30px";
    divTemporaria.style.visibility = "visible";

    // 2. Título e cabeçalho
    const h1 = document.createElement('h1');
    h1.style.textAlign = "center";
    h1.style.color = "#1a202c";
    h1.style.marginBottom = "5px";
    h1.innerText = "🎯 RELATÓRIO FILTRO SNIPER";
    
    const p = document.createElement('p');
    p.style.textAlign = "center";
    p.style.marginBottom = "20px";
    p.style.color = "#4a5568";
    p.innerText = `Data da Rodada: ${dataSelecionada}`;
    
    divTemporaria.appendChild(h1);
    divTemporaria.appendChild(p);
    divTemporaria.appendChild(document.createElement('hr'));

    // 3. Clonar e aplicar estilos específicos de impressão
    const clone = elementoOriginal.cloneNode(true);
    const cards = clone.querySelectorAll('.analysis-card');
    
    cards.forEach(card => {
        card.style.backgroundColor = "#ffffff";
        card.style.color = "#1a202c";
        card.style.border = "1px solid #e2e8f0";
        card.style.borderLeft = "6px solid #22c55e";
        card.style.marginBottom = "15px";
        card.style.padding = "20px";
        card.style.borderRadius = "8px";
        card.style.display = "block";
        card.style.pageBreakInside = "avoid"; // Evita quebra no meio do card
        
        const strongs = card.querySelectorAll('strong');
        strongs.forEach(s => s.style.color = "#000000");

        const badges = card.querySelectorAll('.badge');
        badges.forEach(b => {
            b.style.display = "inline-block";
            b.style.padding = "2px 8px";
            b.style.color = "#ffffff";
            b.style.borderRadius = "4px";
            b.style.fontSize = "12px";
            b.style.fontWeight = "bold";
            if(b.classList.contains('verde')) b.style.backgroundColor = "#16a34a";
            if(b.classList.contains('amarela')) b.style.backgroundColor = "#ca8a04";
            if(b.classList.contains('vermelha')) b.style.backgroundColor = "#dc2626";
        });
    });

    divTemporaria.appendChild(clone);
    document.body.appendChild(divTemporaria);

    // 4. Configurações para forçar a captura correta
    const opt = {
        margin: [10, 5, 10, 5],
        filename: `Sniper_Analise_${dataSelecionada}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            scrollY: 0, // CRÍTICO: ignora onde a página real está scrollada
            windowWidth: 850 
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
        // Aguarda um pouco para o navegador "desenhar" a div no background
        await new Promise(resolve => setTimeout(resolve, 800));
        await html2pdf().set(opt).from(divTemporaria).save();
    } catch (e) {
        console.error("Erro no PDF:", e);
        alert("Erro ao gerar PDF. Tente novamente.");
    } finally {
        document.body.removeChild(divTemporaria);
        btnPDF.innerText = textoOriginal;
        btnPDF.disabled = false;
    }
}