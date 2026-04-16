import { supabase } from "../../lib/supabase";

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  try {
    const { maps } = await req.json();
    if (!maps || maps.length < 2) return Response.json({ error: "Need at least 2 maps" }, { status: 400 });

    const mapSummaries = maps.map(m => {
      const subs = m.map_data.subcategories.map(s =>
        `  - ${s.title}: ${s.topics.map(t => t.title).join(", ")}`
      ).join("\n");
      return `Map "${m.topic}" (id: ${m.id}):\n${subs}`;
    }).join("\n\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: `Analyze these knowledge maps and identify meaningful connections between topics ACROSS different maps. Return ONLY valid JSON array, no markdown:

[{"source_map_id":"uuid","source_node_id":"topic_id","target_map_id":"uuid","target_node_id":"topic_id","description":"Brief description of how they connect"}]

Find 5-15 interesting cross-map connections. Only connect topics from DIFFERENT maps.

${mapSummaries}` }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return Response.json({ error: data.error?.message || "Claude API error" }, { status: response.status });

    const text = data.content?.find(b => b.type === "text")?.text || "[]";
    let connections;
    try { connections = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { connections = []; }

    if (connections.length > 0) {
      const { error } = await supabase.from("connections").insert(connections);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ connections });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
