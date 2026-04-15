# Neural Map

AI-powered knowledge graph explorer. Enter any topic and watch Claude's knowledge unfold into an interactive neural network you can explore and chat with.

## Deploy to Vercel

### 1. Push to GitHub

```bash
cd neural-map
git init
git add .
git commit -m "Neural Map v1"
gh repo create neural-map --public --push --source=.
```

### 2. Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your `neural-map` repo
3. Before deploying, add your environment variable:
   - Click **Environment Variables**
   - Name: `ANTHROPIC_API_KEY`
   - Value: your `sk-ant-api03-...` key
4. Click **Deploy**

Your app will be live at `neural-map.vercel.app` (or whatever Vercel assigns).

### 3. Local Development

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your actual API key
npm run dev
```

Open [localhost:3000](http://localhost:3000)

## How It Works

- **Landing page** — type any topic or pick from suggestions
- **Generation** — Claude generates 35-50 nodes with connections, categories, and summaries
- **Neural map** — interactive canvas with pan/zoom, hover tooltips, category filters
- **Chat panel** — click any node to open an AI chat pre-loaded with that topic's context and connected nodes
- **Hub nodes** — nodes with 4+ connections appear larger with distinct colors; all others are silver-green

## Architecture

```
app/
  page.js          → Main React app (client component)
  layout.js        → Root layout
  globals.css      → Global styles
  api/
    claude/
      route.js     → Server-side proxy to Anthropic API (keeps key hidden)
```

Your API key never touches the browser — all Claude API calls route through `/api/claude` on the server.
