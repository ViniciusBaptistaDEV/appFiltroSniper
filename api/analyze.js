
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
      messages: [
        {
          role: "system",
          content: "Você é um algoritmo frio e matemático."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    };

    console.log("========== PAYLOAD ENVIADO AO DEEPSEEK ==========");
    // console.log(JSON.stringify(payload, null, 2)); // Descomente se quiser ver o log gigante
    console.log("==================================================");

    const respostaIA = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await respostaIA.json();

    res.status(200).json({
      resultado: data.choices[0].message.content
    });

  } catch (error) {
    // ISSO AQUI VAI TE SALVAR HORAS DE DEBUG:
    console.error("🚨 ERRO CRÍTICO NO BACKEND:", error);
    res.status(500).json({ error: "Erro interno na análise", detalhe: error.message });
  }
}