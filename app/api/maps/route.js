import { supabase } from "../../lib/supabase";

export async function POST(req) {
  try {
    const { topic, map_data } = await req.json();

    if (!topic || !map_data) {
      return Response.json({ error: "Missing topic or map_data" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("maps")
      .insert({ topic, map_data })
      .select("id")
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ id: data.id });
  } catch (err) {
    return Response.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
