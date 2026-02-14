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

    // 1. Criar o container em uma posição que não bugará a captura
    const divTemporaria = document.createElement('div');
    // Forçamos a div a ficar bem longe da tela para não aparecer para o usuário
    divTemporaria.style.position = "absolute";
    divTemporaria.style.left = "-9999px"; 
    divTemporaria.style.top = "0";
    divTemporaria.style.width = "800px"; // Largura fixa ideal para A4
    divTemporaria.style.backgroundColor = "#ffffff";
    divTemporaria.style.color = "#000000";
    divTemporaria.style.padding = "20px";

    // 2. Formatar a data para o cabeçalho
    const dataBR = dataSelecionada.split('-').reverse().join('/');

    // 3. Montar o conteúdo do PDF manualmente para garantir limpeza total
    let conteudoHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: white;">
            <div style="text-align: center; border-bottom: 2px solid #000; margin-bottom: 20px; padding-bottom: 10px;">
                <h1 style="margin: 0; font-size: 24px;">🎯 RELATÓRIO FILTRO SNIPER</h1>
                <p style="margin: 5px 0; color: #666;">Data da Rodada: ${dataBR}</p>
            </div>
    `;

    // 4. Percorrer os cards originais e recriar no PDF (limpando o lixo do CSS dark)
    const cards = elementoOriginal.querySelectorAll('.analysis-card');
    cards.forEach(card => {
        // Limpamos o texto (removemos asteriscos se ainda existirem e ajustamos quebras)
        let textoLimpo = card.innerHTML
            .replace(/\*/g, '') // Remove asteriscos residuais
            .replace(/<br>/g, '\n'); 

        conteudoHtml += `
            <div style="
                border: 1px solid #ccc; 
                border-left: 10px solid #22c55e; 
                padding: 15px; 
                margin-bottom: 20px; 
                border-radius: 8px;
                background-color: #f9f9f9;
                page-break-inside: avoid;
            ">
                <div style="white-space: pre-wrap; color: #000; font-size: 13px; line-height: 1.5;">
                    ${textoLimpo}
                </div>
            </div>
        `;
    });

    conteudoHtml += `</div>`;
    divTemporaria.innerHTML = conteudoHtml;
    document.body.appendChild(divTemporaria);

    // 5. Configurações do html2pdf
    const opt = {
        margin: [10, 10],
        filename: `Filtro_Sniper_${dataSelecionada}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            logging: false,
            letterRendering: true,
            scrollY: 0,
            windowWidth: 800
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        // Aguarda a renderização completa dos textos
        await new Promise(resolve => setTimeout(resolve, 1500));
        await html2pdf().set(opt).from(divTemporaria).save();
    } catch (e) {
        console.error("Erro ao gerar PDF:", e);
        alert("Ocorreu um erro ao gerar o PDF.");
    } finally {
        document.body.removeChild(divTemporaria);
        btnPDF.innerText = textoOriginal;
        btnPDF.disabled = false;
    }
}