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
      prompt = `Create a structured infographic layout from this conversation about "${node.title}" (under "${subcategory.title}" in the "${mapTitle}" knowledge map).

Return ONLY valid JSON with this structure:
{
  "headline": "A compelling, magazine-style headline (not just the topic name)",
  "subtitle": "A one-line hook or context statement",
  "heroStat": { "value": "Key number or date", "label": "What it represents" },
  "sections": [
    {
      "title": "Section heading",
      "icon": "single emoji that represents this section",
      "content": "2-3 sentence summary of this aspect",
      "highlights": ["Key fact 1", "Key fact 2"]
    }
  ],
  "timeline": [
    { "date": "Date or period", "event": "What happened", "significance": "Why it matters" }
  ],
  "keyFigures": [
    { "name": "Person or entity name", "role": "Their role/title", "contribution": "What they did" }
  ],
  "pullQuote": "The single most striking or surprising fact from the conversation",
  "bottomLine": "One-sentence takeaway"
}

RULES:
- 3-5 sections covering different aspects discussed
- 3-6 timeline entries if chronological events were discussed (empty array if not applicable)
- 2-4 key figures if people were discussed (empty array if not applicable)
- The headline should be compelling and specific, like a magazine cover
- Include specific dates, numbers, names — no vague statements
- Only include information that was actually discussed in the conversation

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
