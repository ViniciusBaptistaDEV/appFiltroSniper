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

    // Feedback visual
    const textoOriginal = btnPDF.innerText;
    btnPDF.innerText = "⏳ Processando...";
    btnPDF.disabled = true;

    // Criar um container para o PDF
    const divTemporaria = document.createElement('div');
    
    // Configuração de estilo forçado para evitar fundo branco/texto branco
    divTemporaria.style.backgroundColor = "#ffffff";
    divTemporaria.style.color = "#000000";
    divTemporaria.style.padding = "30px";
    divTemporaria.style.width = "800px";
    divTemporaria.style.position = "absolute";
    divTemporaria.style.left = "-9999px";
    
    // Título no PDF
    const h1 = document.createElement('h1');
    h1.style.textAlign = "center";
    h1.style.color = "#000";
    h1.innerText = `Filtro Sniper - Análise ${dataSelecionada}`;
    divTemporaria.appendChild(h1);
    divTemporaria.appendChild(document.createElement('hr'));

    // Clonar e limpar estilos dos cards para o PDF
    const clone = elementoOriginal.cloneNode(true);
    const cards = clone.querySelectorAll('.analysis-card');
    
    cards.forEach(card => {
        card.style.backgroundColor = "#f8fafc";
        card.style.color = "#000000";
        card.style.border = "1px solid #ddd";
        card.style.borderLeft = "6px solid #22c55e";
        card.style.marginBottom = "20px";
        card.style.padding = "20px";
        card.style.display = "block";
        card.style.borderRadius = "8px";
        
        // Garante que negritos apareçam
        const strongs = card.querySelectorAll('strong');
        strongs.forEach(s => s.style.color = "#000");

        // Estiliza os Badges manualmente para o PDF
        const badges = card.querySelectorAll('.badge');
        badges.forEach(b => {
            b.style.display = "inline-block";
            b.style.padding = "3px 8px";
            b.style.color = "#fff";
            b.style.borderRadius = "4px";
            if(b.classList.contains('verde')) b.style.backgroundColor = "#16a34a";
            if(b.classList.contains('amarela')) b.style.backgroundColor = "#ca8a04";
            if(b.classList.contains('vermelha')) b.style.backgroundColor = "#dc2626";
        });
    });

    divTemporaria.appendChild(clone);
    document.body.appendChild(divTemporaria);

    // Configurações do PDF
    const opt = {
        margin: 10,
        filename: `Analise_Sniper_${dataSelecionada}.pdf`,
        image: { type: 'jpeg', quality: 1.0 },
        html2canvas: { 
            scale: 2, 
            useCORS: true, 
            logging: false,
            letterRendering: true
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        // Pequena pausa para garantir que o DOM renderizou a divTemporaria
        await new Promise(resolve => setTimeout(resolve, 500));
        await html2pdf().set(opt).from(divTemporaria).save();
    } catch (e) {
        console.error("Erro no PDF:", e);
    } finally {
        document.body.removeChild(divTemporaria);
        btnPDF.innerText = textoOriginal;
        btnPDF.disabled = false;
    }
}