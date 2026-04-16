import { supabase } from "../../../lib/supabase";

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from("maps")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return Response.json({ error: "Map not found" }, { status: 404 });
    }

    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
