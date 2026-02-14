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
    const btnText = document.querySelector("#btnPDF");

    // Feedback visual simples no botão
    const textoOriginalBtn = btnText.innerText;
    btnText.innerText = "⏳ Gerando...";
    btnText.disabled = true;

    // Criar um container temporário invisível para o PDF
    const containerPDF = document.createElement('div');
    containerPDF.style.position = 'absolute';
    containerPDF.style.left = '-9999px';
    containerPDF.style.top = '0';
    containerPDF.style.width = '800px'; // Largura fixa para evitar quebras estranhas
    containerPDF.style.backgroundColor = '#ffffff';
    containerPDF.style.color = '#000000';
    containerPDF.style.padding = '20px';
    containerPDF.style.fontFamily = 'Arial, sans-serif';

    // Adicionar um título bonito no topo do PDF que não existe no site
    const titulo = document.createElement('h1');
    titulo.innerHTML = `🎯 Relatório Filtro Sniper<br><small style="color: #666;">Data da Rodada: ${dataSelecionada}</small><hr>`;
    titulo.style.textAlign = 'center';
    titulo.style.marginBottom = '20px';
    containerPDF.appendChild(titulo);

    // Clonar os cards e ajustar estilos para o PDF
    const cloneConteudo = elementoOriginal.cloneNode(true);
    const cards = cloneConteudo.querySelectorAll('.analysis-card');

    cards.forEach(card => {
        card.style.backgroundColor = '#f1f5f9';
        card.style.color = '#000000';
        card.style.border = '1px solid #cbd5e1';
        card.style.borderLeft = '5px solid #22c55e';
        card.style.marginBottom = '15px';
        card.style.padding = '15px';
        card.style.borderRadius = '8px';
        card.style.pageBreakInside = 'avoid'; // Evita que um card seja cortado entre páginas

        // Ajustar badges
        const badges = card.querySelectorAll('.badge');
        badges.forEach(b => {
            b.style.padding = '2px 5px';
            b.style.borderRadius = '3px';
            b.style.color = '#ffffff';
            if (b.classList.contains('verde')) b.style.backgroundColor = '#16a34a';
            if (b.classList.contains('amarela')) b.style.backgroundColor = '#ca8a04';
            if (b.classList.contains('vermelha')) b.style.backgroundColor = '#dc2626';
        });

        // Forçar cor do texto forte
        const strongs = card.querySelectorAll('strong');
        strongs.forEach(s => s.style.color = '#000000');
    });

    containerPDF.appendChild(cloneConteudo);
    document.body.appendChild(containerPDF);

    const options = {
        margin: 10,
        filename: `Sniper_Analise_${dataSelecionada}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            scrollY: 0,
            scrollX: 0
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
        await html2pdf().set(options).from(containerPDF).save();
    } catch (error) {
        console.error("Erro ao gerar PDF:", error);
    } finally {
        // Limpar o rastro e restaurar o botão
        document.body.removeChild(containerPDF);
        btnText.innerText = textoOriginalBtn;
        btnText.disabled = false;
    }
}