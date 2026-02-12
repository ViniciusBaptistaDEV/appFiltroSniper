export default async function handler(req, res) {
    try {
        const { data } = req.query;
        if (!data) return res.status(400).json({ error: 'Parâmetro "data" é obrigatório (DD/MM/AAAA).' });

        const query =
            `football fixtures, probable lineups, injuries, xG stats for ${data} ` +
            `(Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Liga Portugal, Brasileirao Serie A ` +
            `Scottish Premiership, Saudi Pro League PIF clubs: Al-Hilal, Al-Nassr, Al-Ittihad, Al-Ahli)`;

        const payload = {
            query,
            search_depth: "advanced",
            max_results: 15,
            include_answer: false,
            include_raw_content: false,
            topic: "news",
            time_range: "year"
        };

        const r = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const json = await r.json();
        return res.status(200).json({
            data, query, tavily_usage: json?.usage, results: json?.results || []
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Erro interno' });
    }
}
