export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  try {
    const { node, subcategory, mapTitle, messages, format } = await req.json();

    const conversation = messages.map(m =>
      `${m.role === "user" ? "USER" : "JARVIS"}: ${m.content}`
    ).join("\n\n");

    let prompt;
    if (format === "infographic") {
      prompt = `Extract the 5-8 most important facts from this conversation about "${node.title}" (under "${subcategory.title}" in the "${mapTitle}" knowledge map). Return ONLY valid JSON array:

[{"fact":"Clear statement of the fact","category":"Topic category","importance":5}]

importance: 5=critical, 1=minor. Include specific dates, names, numbers.

Conversation:
${conversation}`;
    } else {
      prompt = `Generate a polished, professional narrative report from this conversation about "${node.title}" (a topic under "${subcategory.title}" in the "${mapTitle}" knowledge map).

Structure the report with:
1. A compelling title
2. Executive summary (2-3 sentences)
3. Key sections with headers covering the main points discussed
4. Key facts and data points highlighted
5. A conclusion with implications or next steps

Write in a clear, authoritative tone. Include all specific facts, dates, names, and data mentioned in the conversation. Do not add information that wasn't discussed.

Conversation:
${conversation}`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return Response.json({ error: data.error?.message || "Claude API error" }, { status: response.status });

    const text = data.content?.find(b => b.type === "text")?.text || "";
    return Response.json({ content: text });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
