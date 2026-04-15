export async function POST(req) {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const { text, voiceId } = await req.json();

    if (!text) {
      return Response.json({ error: "No text provided" }, { status: 400 });
    }

    const voice = voiceId || "wDsJlOXPqcvIUKdLXjDs";

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.4,
            use_speaker_boost: true,
          },
          optimize_streaming_latency: 3,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return Response.json(
        { error: err.detail?.message || `ElevenLabs API error ${response.status}` },
        { status: response.status }
      );
    }

    // Stream the audio through directly — no buffering
    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
