async function analisar() {
    const date = document.getElementById("dateInput").value;
    const resultado = document.getElementById("resultado");

    resultado.textContent = "🔎 Buscando dados...";

    try {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date })
        });

        const data = await response.json();

        resultado.textContent = data.resultado;
    } catch (error) {
        resultado.textContent = "❌ Erro na análise.";
    }
}
