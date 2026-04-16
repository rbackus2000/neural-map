import { supabase } from "../../../../lib/supabase";

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const nodeId = new URL(req.url).searchParams.get("nodeId");
    if (!nodeId) return Response.json({ error: "Missing nodeId" }, { status: 400 });

    const { data, error } = await supabase
      .from("chat_history")
      .select("messages")
      .eq("map_id", id)
      .eq("node_id", nodeId)
      .single();

    if (error || !data) return Response.json({ messages: [] });
    return Response.json({ messages: data.messages });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const { nodeId, messages } = await req.json();
    if (!nodeId || !messages) return Response.json({ error: "Missing nodeId or messages" }, { status: 400 });

    const { error } = await supabase
      .from("chat_history")
      .upsert(
        { map_id: id, node_id: nodeId, messages, updated_at: new Date().toISOString() },
        { onConflict: "map_id,node_id" }
      );

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
