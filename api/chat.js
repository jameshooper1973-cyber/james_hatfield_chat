export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.HF_TOKEN;
  if (!apiKey) {
    return res.status(500).json({ error: 'HF_TOKEN not set in Vercel environment variables' });
  }

  const { system, messages, model, max_tokens, temperature, json_mode } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Build messages array — system goes first
  const hfMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages
  ];

  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'Qwen/Qwen2.5-7B-Instruct',
        max_tokens: max_tokens || 800,
        temperature: temperature ?? 0.85,
        messages: hfMessages
      })
    });

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      return res.status(502).json({ error: 'HF returned unparseable response' });
    }

    if (!response.ok) {
      const hfError = data?.message || data?.error?.message || `HF error ${response.status}`;
      return res.status(response.status).json({ error: hfError });
    }

    let content = data.choices?.[0]?.message?.content || '';
    if (!content) {
      return res.status(502).json({ error: 'HF returned empty content' });
    }

    // Strip JSON fences if json_mode — same fix as Devina II
    if (json_mode) {
      content = content.replace(/```json\s*|```\s*/g, '').trim();
      const arrStart = content.indexOf('[');
      const arrEnd   = content.lastIndexOf(']');
      const objStart = content.indexOf('{');
      const objEnd   = content.lastIndexOf('}');

      if (arrStart !== -1 && (arrStart < objStart || objStart === -1)) {
        content = content.slice(arrStart, arrEnd + 1);
      } else if (objStart !== -1) {
        content = content.slice(objStart, objEnd + 1);
      }

      try {
        JSON.parse(content);
      } catch (e) {
        return res.status(502).json({ error: 'HF returned invalid JSON', raw: content.slice(0, 300) });
      }
    }

    return res.status(200).json({ content });

  } catch (err) {
    return res.status(503).json({ error: 'Could not reach HuggingFace API: ' + err.message });
  }
}
