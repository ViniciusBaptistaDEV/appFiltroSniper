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
        const secoes = textoIA.split(/(?=💎|🥇|🏆|⚽|📝)/g);

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

function gerarPDF() {
    const elemento = document.getElementById("resultado");
    const dataSelecionada = document.getElementById("dateInput").value;

    // Criamos um clone para formatar apenas o PDF sem estragar o visual do site
    const clone = elemento.cloneNode(true);

    // Ajuste de estilo para o PDF ser legível (Fundo branco, texto preto)
    clone.style.backgroundColor = "#ffffff";
    clone.style.color = "#000000";
    clone.style.padding = "20px";

    // Ajusta todos os cards dentro do clone para terem fundo claro e bordas cinzas
    const cards = clone.querySelectorAll('.analysis-card');
    cards.forEach(card => {
        card.style.backgroundColor = "#f8fafc";
        card.style.color = "#1e293b";
        card.style.borderColor = "#cbd5e1";
        card.style.marginBottom = "15px";
    });

    // Ajusta as cores das fontes fortes (strong) para preto
    const strongs = clone.querySelectorAll('strong');
    strongs.forEach(s => s.style.color = "#000000");

    const options = {
        margin: [10, 10, 10, 10],
        filename: `Filtro_Sniper_Analise_${dataSelecionada}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            backgroundColor: "#ffffff", // Fundo branco oficial
            useCORS: true
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Gera o PDF a partir do clone formatado
    html2pdf().set(options).from(clone).save();
}