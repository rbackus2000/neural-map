import { supabase } from "../../../lib/supabase";

export async function GET(req, { params }) {
  try {
    const { mapId } = await params;

    const { data, error } = await supabase
      .from("connections")
      .select("*")
      .or(`source_map_id.eq.${mapId},target_map_id.eq.${mapId}`);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ connections: data || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
