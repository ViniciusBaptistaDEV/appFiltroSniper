async function analisar() {
    const date = document.getElementById("dateInput").value;

    if (!date) {
        alert("Por favor, selecione uma data no calendário!");
        return;
    }

    const btn = document.getElementById("btnAnalisar");
    const btnText = document.getElementById("btnText");
    const loading = document.getElementById("loading");
    const resultCard = document.getElementById("resultCard");
    const resultado = document.getElementById("resultado");

    // 1. Prepara a tela (Modo Loading)
    btn.disabled = true;
    btnText.textContent = "A Analisar...";
    resultCard.classList.add("hidden"); // Esconde o resultado antigo
    loading.classList.remove("hidden"); // Mostra o spinner

    try {
        // 2. Chama a Vercel
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date })
        });

        const data = await response.json();

        // 3. Mostra o resultado
        resultado.textContent = data.resultado || data.error;
        resultCard.classList.remove("hidden"); // Revela a caixa de texto

    } catch (error) {
        resultado.textContent = "❌ Erro crítico de comunicação com o servidor.";
        resultCard.classList.remove("hidden");
    } finally {
        // 4. Desliga o Loading e reativa o botão
        btn.disabled = false;
        btnText.textContent = "Analisar Jogos";
        loading.classList.add("hidden");
    }
}