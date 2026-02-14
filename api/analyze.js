import { buscarJogos } from "./football.js";
import { montarPrompt } from "./buildPrompt.js";

export default async function handler(req, res) {
  const { date } = req.body;

  try {
    const dadosEnriquecidos = await buscarJogos(date);
    const prompt = montarPrompt(date, dadosEnriquecidos);

    const payload = {
      model: "deepseek/deepseek-chat",
      temperature: 0.1,
      // 🔥 AUMENTO DE LIMITE: Permite que a IA escreva um relatório longo para os 15 jogos
      max_tokens: 7000,
      messages: [
        {
          role: "system",
          content: "Você é um algoritmo frio e matemático. Sua análise deve ser exaustiva: analise todos os jogos fornecidos sem resumir ou omitir dados qualificados."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    };

    console.log("========== ENVIANDO REQUISIÇÃO AO OPENROUTER ==========");

    const respostaIA = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await respostaIA.json();

    // 🛡️ TRAVA DO OPENROUTER: Verifica se a IA devolveu um erro
    if (data.error) {
      console.error("🚨 Erro retornado pelo OpenRouter:", data.error);
      return res.status(500).json({
        error: "O OpenRouter recusou a requisição",
        detalhe: data.error.message
      });
    }

    // 🛡️ TRAVA 2: Verifica se a resposta veio em um formato estranho
    if (!data.choices || data.choices.length === 0) {
      console.error("🚨 Resposta vazia da IA:", data);
      return res.status(500).json({
        error: "A IA não enviou nenhum texto de volta",
        detalhe: "Sem choices no retorno"
      });
    }

    // Se passou pelas travas, envia o resultado com sucesso!
    res.status(200).json({
      resultado: data.choices[0].message.content
    });

  } catch (error) {
    console.error("🚨 ERRO CRÍTICO NO BACKEND:", error);
    res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}