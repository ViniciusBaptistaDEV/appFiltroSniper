const dataInput = document.getElementById('data');
const btnBuscar = document.getElementById('btnBuscar');
const btnAnalisar = document.getElementById('btnAnalisar');
const dadosTxt = document.getElementById('dados');
const saida = document.getElementById('saida');

// 1) Buscar dados via backend /api/buscar
btnBuscar.onclick = async () => {
    const data = (dataInput.value || '').trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) {
        alert('Informe a data no formato DD/MM/AAAA');
        return;
    }

    saida.textContent = 'Buscando dados...';
    dadosTxt.value = '';

    try {
        const res = await fetch(`/api/buscar?data=${encodeURIComponent(data)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        dadosTxt.value = JSON.stringify(json, null, 2);
        saida.textContent = 'Busca concluída. Revise o JSON acima.';
    } catch (err) {
        saida.textContent = 'Erro na busca: ' + err.message;
    }
};

// 2) Rodar análise com DeepSeek (OpenRouter) e seu prompt V8.1
btnAnalisar.onclick = async () => {
    const data = (dataInput.value || '').trim();
    if (!dadosTxt.value) {
        alert('Faça a busca primeiro. O JSON precisa estar preenchido.');
        return;
    }

    saida.textContent = 'Analisando com FILTRO SNIPER... (pode levar alguns segundos)';
    try {
        const res = await fetch('/api/analisar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dataAlvo: data,
                dados: JSON.parse(dadosTxt.value)
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const out = await res.json();
        saida.textContent = out.content || '(sem conteúdo)';
    } catch (err) {
        saida.textContent = 'Erro na análise: ' + err.message;
    }
};

