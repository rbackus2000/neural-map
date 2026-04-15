export async function POST(req) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "BRAVE_SEARCH_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const { query } = await req.json();

    if (!query) {
      return Response.json({ error: "No query provided" }, { status: 400 });
    }

    const params = new URLSearchParams({
      q: query,
      count: "5",
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    if (!response.ok) {
      return Response.json(
        { error: `Brave Search error ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Extract clean results
    const results = (data.web?.results || []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));

    return Response.json({ results });
  } catch (err) {
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
