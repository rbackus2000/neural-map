"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── JARVIS THEME ───────────────────────────────────────────────────────────

const J = {
  bg: "#03080F",
  bgPanel: "rgba(3,8,15,0.97)",
  cyan: "#00E5FF",
  cyanDim: "rgba(0,229,255,0.15)",
  cyanGlow: "rgba(0,229,255,0.4)",
  blue: "#0EA5E9",
  amber: "#FFAB00",
  magenta: "#FF006E",
  text: "#c0d8e8",
  textDim: "rgba(192,216,232,0.4)",
  textMid: "rgba(192,216,232,0.6)",
  border: "rgba(0,229,255,0.12)",
  borderHover: "rgba(0,229,255,0.35)",
  fontDisplay: "'Orbitron', sans-serif",
  fontBody: "'Rajdhani', 'JetBrains Mono', monospace",
  fontMono: "'JetBrains Mono', monospace",
};

const HUB_PALETTE = ["#00E5FF","#FF006E","#FFAB00","#39FF14","#BF5AF2","#0EA5E9","#FF5252","#00E676","#FF9100","#E040FB"];
const REGULAR_COLOR = "#0EA5E9";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// ─── PROMPTS ────────────────────────────────────────────────────────────────

function buildGenerationPrompt(topic) {
  return `You are a knowledge graph architect. Generate a hierarchical neural map of "${topic}".

Return ONLY valid JSON, no markdown, no backticks, no preamble:

{"title":"Short title","master":{"id":"master","title":"2-4 words","summary":"1 concise sentence overview","color":"#00E5FF"},"subcategories":[{"id":"sub_1","title":"2-4 words","summary":"1 concise sentence","color":"#vivid_hex","topics":[{"id":"topic_1_1","title":"2-4 words","summary":"1 sentence with facts/dates/names","tags":["t1","t2","t3"],"significance":3}]}]}

RULES:
- 5-7 subcategories covering major aspects of the topic
- 4-8 topics per subcategory (30-50 total topic nodes)
- Each subcategory gets a vivid hex color (no pastels/grays), all distinct from each other
- significance: 5 = foundational, 1 = minor detail
- Titles: 2-4 words max. Summaries: ONE sentence with specific facts.
- Tags: 2-3 short keywords per topic node
- Good coverage across sub-topics
- Use sequential IDs: sub_1, sub_2... and topic_1_1, topic_1_2, topic_2_1...
- CRITICAL: Keep output compact. Short summaries. No filler.

Return ONLY the JSON object.`;
}

function buildChatSystemPrompt(topic, subcategory, node, siblings, mapTitle) {
  const sibContext = siblings
    .map(s => `- "${s.title}" [${s.tags?.join(", ")}]: ${s.summary}`)
    .join("\n");

  return `You are an expert embedded in a Neural Knowledge Map about "${mapTitle}". The user clicked on a specific topic node and you have deep expertise on this topic and its connections.

CURRENT NODE: "${node.title}"
Category: ${subcategory.title}
Tags: ${node.tags?.join(", ")}
Summary: ${node.summary}

RELATED TOPICS IN "${subcategory.title}":
${sibContext || "None"}

INSTRUCTIONS:
- You are a world-class expert on this specific topic
- Reference specific facts, dates, names, and details — never be generic
- Draw connections between the current topic and related topics when relevant
- If asked to go deeper, provide genuinely expert-level detail
- Be concise and direct — no fluff
- Suggest exploring related topics when it enriches understanding
- You can reference broader context from the map's subject: "${mapTitle}"
- CRITICAL RULE: Your final sentence MUST be a direct question to the user. Not a rhetorical question, not a cliffhanger — a real question directed at them that they can answer. Examples: "Want me to tell you about the three targets they missed?" or "Should I explain how that connects to the Cold War?" Always phrase it as if you're asking them directly what to explore next.`;
}

// ─── API HELPER ─────────────────────────────────────────────────────────────

async function callClaude(body) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

async function webSearch(query) {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results;
  } catch {
    return null;
  }
}

function needsWebSearch(text) {
  const lower = text.toLowerCase();
  const currentTerms = /\b(today|latest|recent|current|now|2024|2025|2026|this week|this month|this year|right now|breaking|new|update|price of|stock|weather|score|who won|election|released)\b/;
  const searchTerms = /\b(search|look up|find|google|what is the|how much|who is|where is|when did|news about)\b/;
  return currentTerms.test(lower) || searchTerms.test(lower);
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function heartbeatPulse(t, phase, amplitude) {
  const cycle = (t * 1.2 + phase) % (Math.PI * 2);
  const beat1 = Math.max(0, Math.sin(cycle * 2)) * amplitude;
  const beat2 = Math.max(0, Math.sin(cycle * 2 + 0.8)) * amplitude * 0.5;
  return 1 + beat1 + beat2;
}

function computeTreeLayout(mapData, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const R1 = Math.min(w, h) * 0.25;
  const R2 = Math.min(w, h) * 0.15;
  const layout = {};

  layout["master"] = { x: cx, y: cy, level: 0, color: mapData.master.color || J.cyan, pulsePhase: 0 };

  const subCount = mapData.subcategories.length;
  mapData.subcategories.forEach((sub, i) => {
    const angle = (i / subCount) * Math.PI * 2 - Math.PI / 2;
    layout[sub.id] = {
      x: cx + Math.cos(angle) * R1,
      y: cy + Math.sin(angle) * R1,
      angle, level: 1, parentId: "master",
      color: sub.color || HUB_PALETTE[i % HUB_PALETTE.length],
      pulsePhase: seededRandom(i * 42) * Math.PI * 2,
    };

    const topicCount = sub.topics.length;
    const fanSpread = Math.min(Math.PI * 0.8, Math.PI * 0.12 * topicCount);
    const fanStart = angle - fanSpread / 2;
    sub.topics.forEach((topic, j) => {
      const topicAngle = topicCount === 1 ? angle : fanStart + (j / (topicCount - 1)) * fanSpread;
      layout[topic.id] = {
        x: layout[sub.id].x + Math.cos(topicAngle) * R2,
        y: layout[sub.id].y + Math.sin(topicAngle) * R2,
        angle: topicAngle, level: 2, parentId: sub.id,
        color: sub.color || HUB_PALETTE[i % HUB_PALETTE.length],
        pulsePhase: seededRandom((i * 10 + j) * 73) * Math.PI * 2,
      };
    });
  });

  return layout;
}

// ─── INFOGRAPHIC HTML BUILDER ────────────────────────────────────────────────

function buildInfographicHTML(info, topicTitle, mapTitle, subTitle) {
  const sections = info.sections || [];
  const timeline = info.timeline || [];
  const figures = info.keyFigures || [];
  const hl = info.headline || topicTitle;
  const sub = info.subtitle || `${mapTitle} // ${subTitle}`;
  const heroStat = info.heroStat;
  const quote = info.pullQuote || "";
  const bottom = info.bottomLine || "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800&family=Rajdhani:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400&display=swap" rel="stylesheet">
<title>${hl}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#03080F;color:#c0d8e8;font-family:'Rajdhani',sans-serif;min-height:100vh;overflow-x:hidden}
.scan{position:fixed;inset:0;pointer-events:none;z-index:100;opacity:0.02;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,229,255,0.15) 2px,rgba(0,229,255,0.15) 3px)}

/* Hero */
.hero{text-align:center;padding:60px 24px 48px;position:relative;border-bottom:1px solid rgba(0,229,255,0.1)}
.hero::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:200px;height:200px;background:radial-gradient(circle,rgba(0,229,255,0.06) 0%,transparent 70%);pointer-events:none}
.hero-label{font-family:'Orbitron',sans-serif;font-size:10px;color:rgba(0,229,255,0.5);letter-spacing:6px;text-transform:uppercase;margin-bottom:16px}
.hero-title{font-family:'Orbitron',sans-serif;font-size:clamp(24px,5vw,42px);font-weight:800;color:#fff;letter-spacing:2px;line-height:1.15;margin-bottom:12px}
.hero-title span{color:#00E5FF;text-shadow:0 0 30px rgba(0,229,255,0.4)}
.hero-sub{font-size:16px;color:rgba(192,216,232,0.5);letter-spacing:1px;max-width:600px;margin:0 auto 24px}
.hero-stat{display:inline-flex;flex-direction:column;align-items:center;padding:16px 32px;border:1px solid rgba(0,229,255,0.2);background:rgba(0,229,255,0.03);margin-top:8px}
.hero-stat-value{font-family:'Orbitron',sans-serif;font-size:32px;font-weight:700;color:#00E5FF;text-shadow:0 0 20px rgba(0,229,255,0.4)}
.hero-stat-label{font-size:11px;color:rgba(192,216,232,0.4);letter-spacing:3px;text-transform:uppercase;margin-top:4px}

/* Layout */
.container{max-width:960px;margin:0 auto;padding:0 24px}

/* Sections */
.sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;padding:48px 0}
.section{background:rgba(0,229,255,0.02);border:1px solid rgba(0,229,255,0.08);padding:28px 24px;position:relative}
.section::before{content:'';position:absolute;top:0;left:0;width:16px;height:16px;border-top:2px solid #00E5FF;border-left:2px solid #00E5FF}
.section::after{content:'';position:absolute;bottom:0;right:0;width:16px;height:16px;border-bottom:2px solid #00E5FF;border-right:2px solid #00E5FF}
.section-icon{font-size:28px;margin-bottom:12px}
.section-title{font-family:'Orbitron',sans-serif;font-size:13px;color:#00E5FF;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;font-weight:600}
.section-content{font-size:15px;line-height:1.7;color:rgba(224,240,255,0.8);margin-bottom:16px}
.section-highlights{list-style:none;display:flex;flex-direction:column;gap:6px}
.section-highlights li{font-size:13px;color:rgba(0,229,255,0.7);padding-left:16px;position:relative;font-family:'JetBrains Mono',monospace;letter-spacing:0.5px}
.section-highlights li::before{content:'▸';position:absolute;left:0;color:#00E5FF}

/* Pull Quote */
.quote-section{padding:40px 0;text-align:center;position:relative}
.quote-section::before{content:'';display:block;width:60px;height:1px;background:linear-gradient(90deg,transparent,#00E5FF,transparent);margin:0 auto 32px}
.quote{font-size:clamp(18px,3vw,24px);font-weight:300;color:#fff;line-height:1.5;max-width:700px;margin:0 auto;font-style:italic}
.quote::before{content:'"';color:#00E5FF;font-size:48px;font-family:'Orbitron',sans-serif;display:block;margin-bottom:-8px;opacity:0.5}

/* Timeline */
.timeline-section{padding:48px 0;border-top:1px solid rgba(0,229,255,0.08)}
.timeline-heading{font-family:'Orbitron',sans-serif;font-size:12px;color:rgba(0,229,255,0.5);letter-spacing:4px;text-transform:uppercase;text-align:center;margin-bottom:32px}
.timeline{position:relative;padding-left:32px}
.timeline::before{content:'';position:absolute;left:8px;top:0;bottom:0;width:1px;background:linear-gradient(180deg,#00E5FF,rgba(0,229,255,0.1))}
.tl-item{position:relative;padding-bottom:28px}
.tl-item::before{content:'';position:absolute;left:-28px;top:6px;width:10px;height:10px;background:#00E5FF;box-shadow:0 0 8px rgba(0,229,255,0.5)}
.tl-date{font-family:'Orbitron',sans-serif;font-size:11px;color:#00E5FF;letter-spacing:2px;margin-bottom:4px;font-weight:600}
.tl-event{font-size:16px;color:#e0f0ff;font-weight:600;margin-bottom:4px}
.tl-sig{font-size:13px;color:rgba(192,216,232,0.5);line-height:1.5}

/* Key Figures */
.figures-section{padding:48px 0;border-top:1px solid rgba(0,229,255,0.08)}
.figures-heading{font-family:'Orbitron',sans-serif;font-size:12px;color:rgba(0,229,255,0.5);letter-spacing:4px;text-transform:uppercase;text-align:center;margin-bottom:32px}
.figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.figure{text-align:center;padding:24px 16px;border:1px solid rgba(0,229,255,0.06);background:rgba(0,229,255,0.02)}
.figure-name{font-family:'Orbitron',sans-serif;font-size:14px;color:#00E5FF;letter-spacing:1px;margin-bottom:4px;font-weight:600}
.figure-role{font-size:11px;color:rgba(192,216,232,0.4);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
.figure-contrib{font-size:13px;color:rgba(224,240,255,0.7);line-height:1.5}

/* Bottom */
.bottom-line{text-align:center;padding:40px 24px 60px;border-top:1px solid rgba(0,229,255,0.08)}
.bottom-label{font-family:'Orbitron',sans-serif;font-size:9px;color:rgba(0,229,255,0.4);letter-spacing:4px;text-transform:uppercase;margin-bottom:12px}
.bottom-text{font-size:18px;color:#e0f0ff;max-width:600px;margin:0 auto;line-height:1.6;font-weight:600}
.footer{text-align:center;padding:20px;opacity:0.2;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;color:#00E5FF}
</style></head>
<body>
<div class="scan"></div>

<div class="hero">
  <div class="hero-label">NEURAL MAP // INFOGRAPHIC</div>
  <h1 class="hero-title">${hl.includes(":") ? hl.replace(/(.*?):(.*)/, "$1:<br><span>$2</span>") : `<span>${hl}</span>`}</h1>
  <div class="hero-sub">${sub}</div>
  ${heroStat ? `<div class="hero-stat"><div class="hero-stat-value">${heroStat.value}</div><div class="hero-stat-label">${heroStat.label}</div></div>` : ""}
</div>

<div class="container">
  ${sections.length > 0 ? `<div class="sections">${sections.map(s => `
    <div class="section">
      <div class="section-icon">${s.icon || "◆"}</div>
      <div class="section-title">${s.title}</div>
      <div class="section-content">${s.content}</div>
      ${s.highlights && s.highlights.length > 0 ? `<ul class="section-highlights">${s.highlights.map(h => `<li>${h}</li>`).join("")}</ul>` : ""}
    </div>`).join("")}</div>` : ""}

  ${quote ? `<div class="quote-section"><div class="quote">${quote}</div></div>` : ""}

  ${timeline.length > 0 ? `<div class="timeline-section">
    <div class="timeline-heading">TIMELINE</div>
    <div class="timeline">${timeline.map(t => `
      <div class="tl-item">
        <div class="tl-date">${t.date}</div>
        <div class="tl-event">${t.event}</div>
        <div class="tl-sig">${t.significance}</div>
      </div>`).join("")}</div>
  </div>` : ""}

  ${figures.length > 0 ? `<div class="figures-section">
    <div class="figures-heading">KEY FIGURES</div>
    <div class="figures">${figures.map(f => `
      <div class="figure">
        <div class="figure-name">${f.name}</div>
        <div class="figure-role">${f.role}</div>
        <div class="figure-contrib">${f.contribution}</div>
      </div>`).join("")}</div>
  </div>` : ""}

  ${bottom ? `<div class="bottom-line">
    <div class="bottom-label">THE BOTTOM LINE</div>
    <div class="bottom-text">${bottom}</div>
  </div>` : ""}
</div>

<div class="footer">GENERATED BY NEURAL MAP // ${mapTitle.toUpperCase()}</div>
</body></html>`;
}

// ─── HUD DECORATIVE ELEMENTS ────────────────────────────────────────────────

function HudCorner({ position, size = 20, color = J.cyan }) {
  const s = {
    position: "absolute", width: size, height: size, pointerEvents: "none",
    ...(position === "tl" ? { top: 0, left: 0, borderTop: `1px solid ${color}`, borderLeft: `1px solid ${color}` } : {}),
    ...(position === "tr" ? { top: 0, right: 0, borderTop: `1px solid ${color}`, borderRight: `1px solid ${color}` } : {}),
    ...(position === "bl" ? { bottom: 0, left: 0, borderBottom: `1px solid ${color}`, borderLeft: `1px solid ${color}` } : {}),
    ...(position === "br" ? { bottom: 0, right: 0, borderBottom: `1px solid ${color}`, borderRight: `1px solid ${color}` } : {}),
  };
  return <div style={s} />;
}

function ScanLine() {
  return (
    <div style={{
      position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, opacity: 0.03,
      background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.15) 2px, rgba(0,229,255,0.15) 3px)",
    }} />
  );
}

function HexGrid() {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.025, pointerEvents: "none" }}>
      <defs>
        <pattern id="hexgrid" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
          <path d="M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100" fill="none" stroke={J.cyan} strokeWidth="0.5"/>
          <path d="M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34" fill="none" stroke={J.cyan} strokeWidth="0.5"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hexgrid)" />
    </svg>
  );
}

// ─── SUGGESTED TOPICS ───────────────────────────────────────────────────────

const SUGGESTED_TOPICS = [
  { label: "World History", icon: "◆" },
  { label: "Ancient Rome", icon: "◆" },
  { label: "Artificial Intelligence", icon: "◆" },
  { label: "The Solar System", icon: "◆" },
  { label: "Philosophy", icon: "◆" },
  { label: "World War II", icon: "◆" },
  { label: "iOS Development", icon: "◆" },
  { label: "The Human Body", icon: "◆" },
  { label: "Music Theory", icon: "◆" },
  { label: "Quantum Physics", icon: "◆" },
  { label: "Cryptocurrency", icon: "◆" },
  { label: "Ancient Egypt", icon: "◆" },
];

// ─── CHAT PANEL (adapted for hierarchical data + persistence + export) ──────

function ChatPanel({ node, subcategory, siblings, mapTitle, nodeColor, onClose, onNavigate, chatCacheRef, mapId }) {
  const mobile = useIsMobile();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const voiceModeRef = useRef(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    // Load from cache or Supabase
    const cached = chatCacheRef?.current?.[node.id];
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else if (mapId) {
      fetch(`/api/maps/${mapId}/chat?nodeId=${node.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.messages?.length > 0) { setMessages(data.messages); if (chatCacheRef?.current) chatCacheRef.current[node.id] = data.messages; } })
        .catch(() => {});
    } else {
      setMessages([]);
    }
    setInput(""); stopSpeaking();
    setVoiceMode(false); voiceModeRef.current = false;
    setShowExport(false);
    inputRef.current?.focus();
  }, [node.id]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);

  const speakText = useCallback(async (text) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) { setIsSpeaking(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio();
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioUrlRef.current = null; audioRef.current = null; };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioUrlRef.current = null; audioRef.current = null; };
      audio.src = url;
      audio.play().catch(() => setIsSpeaking(false));
    } catch { setIsSpeaking(false); }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current = null; }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    setIsSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setInput("Voice not supported"); return; }
    stopSpeaking();
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onstart = () => setIsListening(true);
    r.onresult = (e) => { setInput(Array.from(e.results).map(r => r[0].transcript).join("")); };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r; r.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    setIsListening(false); setVoiceMode(true); voiceModeRef.current = true;
  }, []);

  const sendMessage = async (overrideText) => {
    const msgText = overrideText || input.trim();
    if (!msgText || isLoading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msgText }]);
    setIsLoading(true);
    try {
      let searchContext = "";
      if (needsWebSearch(msgText)) {
        const results = await webSearch(msgText + " " + node.title);
        if (results && results.length > 0) {
          searchContext = "\n\nWEB SEARCH RESULTS:\n" + results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.description}\n   Source: ${r.url}`).join("\n");
        }
      }
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: msgText });
      const isVoice = voiceModeRef.current;
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: isVoice ? 500 : 1000,
        system: buildChatSystemPrompt(node.title, subcategory, node, siblings, mapTitle)
          + (isVoice ? "\n- This is a VOICE conversation. Keep your answer to 2-3 sentences max. Your LAST sentence MUST be a direct question asking the user what they want to explore next." : "")
          + searchContext,
        messages: history,
      });
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "Unable to process.";
      const newMessages = [...messages, { role: "user", content: msgText }, { role: "assistant", content: text }];
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
      // Persist to cache
      if (chatCacheRef?.current) chatCacheRef.current[node.id] = newMessages;
      if (isVoice) speakText(text);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setIsLoading(false);
  };

  const prevListeningRef = useRef(false);
  useEffect(() => {
    if (prevListeningRef.current && !isListening && voiceMode && input.trim()) {
      const timer = setTimeout(() => sendMessage(input.trim()), 200);
      return () => clearTimeout(timer);
    }
    prevListeningRef.current = isListening;
  }, [isListening, voiceMode]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setVoiceMode(false); voiceModeRef.current = false; sendMessage(); }
  };

  // ─── CHAT EXPORT ──────────────────────────────────────────────────────────
  const exportMarkdown = () => {
    let md = `# ${mapTitle}\n## ${subcategory.title} > ${node.title}\n\n> ${node.summary}\n\n---\n\n`;
    messages.forEach(m => { md += m.role === "user" ? `**You:** ${m.content}\n\n` : `**JARVIS:** ${m.content}\n\n`; });
    const blob = new Blob([md], { type: "text/markdown" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `${node.title.replace(/\s+/g, "-")}-chat.md`; link.click();
    URL.revokeObjectURL(link.href); setShowExport(false);
  };

  const exportPDFReport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/export/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, subcategory, mapTitle, messages, format: "report" }),
      });
      const { content } = await res.json();
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF(); const pw = doc.internal.pageSize.width; const ph = doc.internal.pageSize.height;
      doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F");
      doc.setTextColor(0, 229, 255); doc.setFontSize(20);
      doc.text(node.title, 20, 30);
      doc.setTextColor(192, 216, 232); doc.setFontSize(10);
      doc.text(`${mapTitle} > ${subcategory.title}`, 20, 40);
      doc.setDrawColor(0, 229, 255); doc.line(20, 45, pw - 20, 45);
      doc.setTextColor(192, 216, 232); doc.setFontSize(11);
      const lines = doc.splitTextToSize(content, pw - 40);
      let y = 55;
      lines.forEach(line => {
        if (y > ph - 20) { doc.addPage(); doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F"); doc.setTextColor(192, 216, 232); y = 20; }
        doc.text(line, 20, y); y += 6;
      });
      doc.save(`${node.title.replace(/\s+/g, "-")}-report.pdf`);
    } catch {} finally { setIsExporting(false); setShowExport(false); }
  };

  const exportInfographic = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/export/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, subcategory, mapTitle, messages, format: "infographic" }),
      });
      const { content } = await res.json();
      let info;
      try { info = JSON.parse(content.replace(/```json|```/g, "").trim()); } catch { info = { headline: node.title, subtitle: node.summary, sections: [{ title: "Overview", icon: "📋", content: content, highlights: [] }], timeline: [], keyFigures: [], pullQuote: "", bottomLine: "", heroStat: null }; }
      const html = buildInfographicHTML(info, node.title, mapTitle, subcategory.title);
      const blob = new Blob([html], { type: "text/html" });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
      link.download = `${node.title.replace(/\s+/g, "-")}-infographic.html`; link.click();
      URL.revokeObjectURL(link.href);
    } catch {} finally { setIsExporting(false); setShowExport(false); }
  };

  const quickPrompts = [
    "Tell me the most important thing about this",
    "How does this connect to the bigger picture?",
    "What's a surprising fact most people don't know?",
    "Go deeper — give me expert-level detail",
  ];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0,
      width: mobile ? "100%" : (isExpanded ? "55%" : "400px"),
      maxWidth: mobile ? "100%" : (isExpanded ? "720px" : "440px"),
      minWidth: mobile ? "100%" : "360px",
      background: J.bgPanel, backdropFilter: "blur(30px)",
      borderLeft: `1px solid ${nodeColor}25`,
      display: "flex", flexDirection: "column", zIndex: 30,
      transition: "width 0.3s ease, max-width 0.3s ease",
      boxShadow: `-4px 0 40px rgba(0,0,0,0.6), -1px 0 0 ${nodeColor}15`,
    }}>
      <ScanLine />
      <div style={{ padding: "16px 18px", borderBottom: `1px solid ${nodeColor}20`, flexShrink: 0, position: "relative" }}>
        <HudCorner position="tl" color={nodeColor} />
        <HudCorner position="tr" color={nodeColor} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 16, background: nodeColor, boxShadow: `0 0 8px ${nodeColor}80` }} />
            <span style={{ fontSize: 10, fontFamily: J.fontDisplay, color: nodeColor, textTransform: "uppercase", letterSpacing: 3, fontWeight: 600 }}>
              {subcategory.title}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4, position: "relative" }}>
            {messages.length > 0 && (
              <button onClick={() => setShowExport(!showExport)} style={{ background: showExport ? `${nodeColor}15` : "rgba(0,229,255,0.04)", border: `1px solid ${showExport ? nodeColor + "40" : J.border}`, color: showExport ? nodeColor : J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 10, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            )}
            <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 11, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isExpanded ? "◁" : "▷"}
            </button>
            <button onClick={onClose} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 15, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            {showExport && (
              <div style={{ position: "absolute", top: 34, right: 0, background: J.bgPanel, border: `1px solid ${J.border}`, zIndex: 10, minWidth: 180, boxShadow: `0 8px 24px rgba(0,0,0,0.5)` }}>
                <HudCorner position="tl" size={8} color={nodeColor} />
                <HudCorner position="br" size={8} color={nodeColor} />
                <button onClick={exportMarkdown} style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${J.border}`, padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: "pointer", textAlign: "left", letterSpacing: 0.5 }}>Markdown (.md)</button>
                <button onClick={exportPDFReport} disabled={isExporting} style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${J.border}`, padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: isExporting ? "wait" : "pointer", textAlign: "left", letterSpacing: 0.5 }}>{isExporting ? "GENERATING..." : "PDF Report"}</button>
                <button onClick={exportInfographic} disabled={isExporting} style={{ display: "block", width: "100%", background: "none", border: "none", padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: isExporting ? "wait" : "pointer", textAlign: "left", letterSpacing: 0.5 }}>{isExporting ? "GENERATING..." : "Infographic (.html)"}</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ fontSize: 17, fontFamily: J.fontDisplay, fontWeight: 600, color: "#fff", marginBottom: 8, lineHeight: 1.3, letterSpacing: 0.5 }}>{node.title}</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, color: J.textMid, margin: 0, fontFamily: J.fontBody }}>{node.summary}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
          {node.tags?.map(tag => (
            <span key={tag} style={{ background: `${nodeColor}10`, border: `1px solid ${nodeColor}30`, borderRadius: 1, padding: "2px 8px", fontSize: 10, fontFamily: J.fontMono, color: nodeColor, textTransform: "uppercase", letterSpacing: 1 }}>{tag}</span>
          ))}
        </div>
        {siblings.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.textDim, textTransform: "uppercase", letterSpacing: 3, marginBottom: 6 }}>RELATED TOPICS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {siblings.filter(s => s.id !== node.id).map(s => (
                <button key={s.id} onClick={() => onNavigate(s.id)} style={{ background: "rgba(0,229,255,0.03)", border: `1px solid ${nodeColor}30`, borderRadius: 1, padding: "3px 8px", fontSize: 9, fontFamily: J.fontBody, fontWeight: 500, color: nodeColor, cursor: "pointer", transition: "all 0.15s", letterSpacing: 0.5 }}>
                  {s.title.length > 22 ? s.title.slice(0, 20) + "..." : s.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, position: "relative", zIndex: 3 }}>
        {messages.length === 0 && (
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 11, fontFamily: J.fontDisplay, color: J.textDim, marginBottom: 14, textAlign: "center", letterSpacing: 2, textTransform: "uppercase" }}>QUERY INTERFACE READY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {quickPrompts.map((q, i) => (
                <button key={i} onClick={() => setInput(q)}
                  style={{ background: "rgba(0,229,255,0.03)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "11px 14px", fontSize: 12, fontFamily: J.fontBody, fontWeight: 500, color: J.textMid, cursor: "pointer", textAlign: "left", transition: "all 0.15s", letterSpacing: 0.3 }}
                  onMouseEnter={e => { e.target.style.background = `${nodeColor}12`; e.target.style.borderColor = `${nodeColor}40`; e.target.style.color = nodeColor; }}
                  onMouseLeave={e => { e.target.style.background = "rgba(0,229,255,0.03)"; e.target.style.borderColor = J.border; e.target.style.color = J.textMid; }}
                >{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
            {msg.role === "assistant" && <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: nodeColor, marginBottom: 4, textTransform: "uppercase", letterSpacing: 3 }}>N.MAP // RESPONSE</div>}
            <div style={{
              background: msg.role === "user" ? `${nodeColor}15` : "rgba(0,229,255,0.04)",
              border: `1px solid ${msg.role === "user" ? `${nodeColor}30` : J.border}`,
              borderRadius: 2, padding: "11px 15px", fontSize: 13, lineHeight: 1.7,
              fontFamily: J.fontBody, fontWeight: 400,
              color: msg.role === "user" ? "#e0f0ff" : J.text,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
            <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: nodeColor, marginBottom: 4, textTransform: "uppercase", letterSpacing: 3 }}>N.MAP // PROCESSING</div>
            <div style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "13px 18px", display: "flex", gap: 6, alignItems: "center" }}>
              {[0,1,2].map(j => <div key={j} style={{ width: 6, height: 6, background: nodeColor, animation: `jarvisPulse 1.2s ease-in-out ${j*0.15}s infinite` }} />)}
              <span style={{ fontSize: 10, fontFamily: J.fontMono, color: J.textDim, marginLeft: 6, letterSpacing: 1 }}>ANALYZING...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {isSpeaking && (
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${nodeColor}20`, display: "flex", alignItems: "center", gap: 8, background: `${nodeColor}08` }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {[0,1,2,3,4].map(i => <div key={i} style={{ width: 3, height: 8 + Math.sin(i * 1.2) * 6, background: nodeColor, animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`, borderRadius: 1 }} />)}
          </div>
          <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: nodeColor, letterSpacing: 3, textTransform: "uppercase" }}>N.MAP // SPEAKING</span>
          <button onClick={stopSpeaking} style={{ marginLeft: "auto", background: "rgba(255,0,110,0.1)", border: `1px solid rgba(255,0,110,0.3)`, borderRadius: 2, padding: "3px 10px", fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, cursor: "pointer", letterSpacing: 2 }}>STOP</button>
        </div>
      )}

      <div style={{ padding: "14px 18px", borderTop: `1px solid ${J.border}`, flexShrink: 0, position: "relative" }}>
        <HudCorner position="bl" color={nodeColor} />
        <HudCorner position="br" color={nodeColor} />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(0,229,255,0.03)", border: `1px solid ${isListening ? nodeColor + "50" : J.border}`, borderRadius: 2, padding: "4px 4px 4px 14px", transition: "all 0.3s", boxShadow: isListening ? `0 0 20px ${nodeColor}15` : "none" }}>
          <textarea ref={inputRef} value={input} onChange={e => { setInput(e.target.value); setVoiceMode(false); voiceModeRef.current = false; }} onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : `Query: ${node.title.toLowerCase()}...`} rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: isListening ? nodeColor : "#e0f0ff", fontSize: 13, fontFamily: J.fontBody, fontWeight: 500, resize: "none", outline: "none", padding: "8px 0", maxHeight: 80, lineHeight: 1.5 }}
          />
          <button onClick={isListening ? stopListening : startListening} disabled={isLoading}
            style={{ background: isListening ? nodeColor : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: isListening ? `0 0 16px ${nodeColor}50` : "none", animation: isListening ? "micPulse 1.5s ease-in-out infinite" : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isListening ? "#000" : "rgba(0,229,255,0.5)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="1" width="6" height="12" rx="3" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <button onClick={() => { setVoiceMode(false); voiceModeRef.current = false; sendMessage(); }} disabled={isLoading || !input.trim()}
            style={{ background: input.trim() ? nodeColor : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: input.trim() ? `0 0 12px ${nodeColor}40` : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(0,229,255,0.2)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        {voiceMode && !isListening && !isSpeaking && !isLoading && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <div style={{ width: 4, height: 4, background: nodeColor, animation: "jarvisPulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.textDim, letterSpacing: 2 }}>VOICE SESSION ACTIVE — TAP MIC TO CONTINUE</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CONNECTION CHAT (explore a cross-map connection) ───────────────────────

function ConnectionChat({ conn, onClose, mobile }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setMessages([]); setInput(""); setShowExport(false); inputRef.current?.focus(); }, [conn._connIndex]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = async (overrideText) => {
    const msgText = overrideText || input.trim();
    if (!msgText || isLoading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msgText }]);
    setIsLoading(true);
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: msgText });
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: `You are an expert analyzing the CONNECTION between two topics from different knowledge maps.

CONNECTION: "${conn.srcName}" (from "${conn.srcMap}") ⟷ "${conn.tgtName}" (from "${conn.tgtMap}")
RELATIONSHIP: ${conn.description}

INSTRUCTIONS:
- You are a world-class expert on how these two topics connect across their respective domains
- Explain the relationship with specific facts, dates, names, and causal links
- Draw on deep knowledge of both "${conn.srcMap}" and "${conn.tgtMap}" to illuminate the connection
- Be concise and direct — no fluff
- CRITICAL: Your final sentence MUST be a direct question to the user about what aspect of this connection they want to explore next.`,
        messages: history,
      });
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "Unable to process.";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const quickPrompts = [
    "Explain this connection in detail",
    "What caused this relationship?",
    "How did one influence the other?",
    "What are the surprising parallels?",
  ];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0,
      width: mobile ? "100%" : "400px", maxWidth: mobile ? "100%" : "440px", minWidth: mobile ? "100%" : "360px",
      background: J.bgPanel, backdropFilter: "blur(30px)",
      borderLeft: `1px solid ${J.magenta}25`,
      display: "flex", flexDirection: "column", zIndex: 30,
      boxShadow: `-4px 0 40px rgba(0,0,0,0.6)`,
    }}>
      <ScanLine />
      {/* Header */}
      <div style={{ padding: "16px 18px", borderBottom: `1px solid ${J.magenta}20`, flexShrink: 0, position: "relative" }}>
        <HudCorner position="tl" color={J.magenta} />
        <HudCorner position="tr" color={J.magenta} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 16, background: J.magenta, boxShadow: `0 0 8px ${J.magenta}80` }} />
            <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, textTransform: "uppercase", letterSpacing: 3, fontWeight: 600 }}>CONNECTION ANALYSIS</span>
          </div>
          <div style={{ display: "flex", gap: 4, position: "relative" }}>
            {messages.length > 0 && (
              <button onClick={() => setShowExport(!showExport)} style={{ background: showExport ? `${J.magenta}15` : "rgba(0,229,255,0.04)", border: `1px solid ${showExport ? J.magenta + "40" : J.border}`, color: showExport ? J.magenta : J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 10, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            )}
            <button onClick={onClose} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 15, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            {showExport && (
              <div style={{ position: "absolute", top: 34, right: 0, background: J.bgPanel, border: `1px solid ${J.magenta}20`, zIndex: 10, minWidth: 180, boxShadow: `0 8px 24px rgba(0,0,0,0.5)` }}>
                <HudCorner position="tl" size={8} color={J.magenta} />
                <HudCorner position="br" size={8} color={J.magenta} />
                <button onClick={() => {
                  let md = `# Connection: ${conn.srcName} ⟷ ${conn.tgtName}\n\n> ${conn.srcMap} ↔ ${conn.tgtMap}\n\n> ${conn.description}\n\n---\n\n`;
                  messages.forEach(m => { md += m.role === "user" ? `**You:** ${m.content}\n\n` : `**JARVIS:** ${m.content}\n\n`; });
                  const blob = new Blob([md], { type: "text/markdown" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
                  a.download = `${conn.srcName}-${conn.tgtName}-connection.md`; a.click();
                  URL.revokeObjectURL(a.href); setShowExport(false);
                }} style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${J.magenta}15`, padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: "pointer", textAlign: "left" }}>Markdown (.md)</button>
                <button onClick={async () => {
                  setIsExporting(true);
                  try {
                    const res = await fetch("/api/export/report", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ node: { title: `${conn.srcName} ⟷ ${conn.tgtName}`, summary: conn.description, tags: [] }, subcategory: { title: "Cross-Map Connection" }, mapTitle: `${conn.srcMap} ↔ ${conn.tgtMap}`, messages, format: "report" }),
                    });
                    const { content } = await res.json();
                    const { jsPDF } = await import("jspdf");
                    const doc = new jsPDF(); const pw = doc.internal.pageSize.width; const ph = doc.internal.pageSize.height;
                    doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F");
                    doc.setTextColor(255, 0, 110); doc.setFontSize(18);
                    doc.text(`${conn.srcName}  ⟷  ${conn.tgtName}`, 20, 25);
                    doc.setTextColor(192, 216, 232); doc.setFontSize(9);
                    doc.text(`${conn.srcMap} ↔ ${conn.tgtMap}`, 20, 33);
                    doc.setDrawColor(255, 0, 110); doc.line(20, 37, pw - 20, 37);
                    doc.setTextColor(192, 216, 232); doc.setFontSize(11);
                    const lines = doc.splitTextToSize(content, pw - 40); let y = 47;
                    lines.forEach(line => { if (y > ph - 20) { doc.addPage(); doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F"); doc.setTextColor(192, 216, 232); y = 20; } doc.text(line, 20, y); y += 6; });
                    doc.save(`${conn.srcName}-${conn.tgtName}-report.pdf`);
                  } catch {} finally { setIsExporting(false); setShowExport(false); }
                }} disabled={isExporting} style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${J.magenta}15`, padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: isExporting ? "wait" : "pointer", textAlign: "left" }}>{isExporting ? "GENERATING..." : "PDF Report"}</button>
                <button onClick={async () => {
                  setIsExporting(true);
                  try {
                    const res = await fetch("/api/export/report", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ node: { title: `${conn.srcName} ⟷ ${conn.tgtName}`, summary: conn.description, tags: [] }, subcategory: { title: "Cross-Map Connection" }, mapTitle: `${conn.srcMap} ↔ ${conn.tgtMap}`, messages, format: "infographic" }),
                    });
                    const { content } = await res.json();
                    let info; try { info = JSON.parse(content.replace(/```json|```/g, "").trim()); } catch { info = { headline: `${conn.srcName} ⟷ ${conn.tgtName}`, subtitle: conn.description, sections: [{ title: "Overview", icon: "🔗", content: content, highlights: [] }], timeline: [], keyFigures: [], pullQuote: "", bottomLine: "" }; }
                    const html = buildInfographicHTML(info, `${conn.srcName} ⟷ ${conn.tgtName}`, `${conn.srcMap} ↔ ${conn.tgtMap}`, "Cross-Map Connection");
                    const blob = new Blob([html], { type: "text/html" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
                    a.download = `${conn.srcName}-${conn.tgtName}-infographic.html`; a.click(); URL.revokeObjectURL(a.href);
                  } catch {} finally { setIsExporting(false); setShowExport(false); }
                }} disabled={isExporting} style={{ display: "block", width: "100%", background: "none", border: "none", padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: isExporting ? "wait" : "pointer", textAlign: "left" }}>{isExporting ? "GENERATING..." : "Infographic (.html)"}</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontFamily: J.fontDisplay, fontWeight: 600, color: J.magenta }}>{conn.srcName}</span>
          <span style={{ fontSize: 11, fontFamily: J.fontMono, color: J.textDim }}>⟷</span>
          <span style={{ fontSize: 14, fontFamily: J.fontDisplay, fontWeight: 600, color: J.magenta }}>{conn.tgtName}</span>
        </div>
        <div style={{ fontSize: 9, fontFamily: J.fontMono, color: J.textDim, marginBottom: 8 }}>{conn.srcMap} ↔ {conn.tgtMap}</div>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: J.textMid, margin: 0, fontFamily: J.fontBody }}>{conn.description}</p>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, position: "relative", zIndex: 3 }}>
        {messages.length === 0 && (
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 11, fontFamily: J.fontDisplay, color: J.textDim, marginBottom: 14, textAlign: "center", letterSpacing: 2, textTransform: "uppercase" }}>EXPLORE THIS CONNECTION</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {quickPrompts.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q)}
                  style={{ background: "rgba(255,0,110,0.03)", border: `1px solid ${J.magenta}15`, borderRadius: 2, padding: "11px 14px", fontSize: 12, fontFamily: J.fontBody, fontWeight: 500, color: J.textMid, cursor: "pointer", textAlign: "left", transition: "all 0.15s", letterSpacing: 0.3 }}
                  onMouseEnter={e => { e.target.style.background = `${J.magenta}12`; e.target.style.borderColor = `${J.magenta}40`; e.target.style.color = J.magenta; }}
                  onMouseLeave={e => { e.target.style.background = "rgba(255,0,110,0.03)"; e.target.style.borderColor = `${J.magenta}15`; e.target.style.color = J.textMid; }}
                >{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
            {msg.role === "assistant" && <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, marginBottom: 4, textTransform: "uppercase", letterSpacing: 3 }}>N.MAP // CONNECTION</div>}
            <div style={{
              background: msg.role === "user" ? `${J.magenta}15` : "rgba(255,0,110,0.04)",
              border: `1px solid ${msg.role === "user" ? `${J.magenta}30` : `${J.magenta}12`}`,
              borderRadius: 2, padding: "11px 15px", fontSize: 13, lineHeight: 1.7,
              fontFamily: J.fontBody, fontWeight: 400,
              color: msg.role === "user" ? "#e0f0ff" : J.text,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
            <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, marginBottom: 4, textTransform: "uppercase", letterSpacing: 3 }}>N.MAP // ANALYZING</div>
            <div style={{ background: "rgba(255,0,110,0.04)", border: `1px solid ${J.magenta}12`, borderRadius: 2, padding: "13px 18px", display: "flex", gap: 6, alignItems: "center" }}>
              {[0,1,2].map(j => <div key={j} style={{ width: 6, height: 6, background: J.magenta, animation: `jarvisPulse 1.2s ease-in-out ${j*0.15}s infinite` }} />)}
              <span style={{ fontSize: 10, fontFamily: J.fontMono, color: J.textDim, marginLeft: 6, letterSpacing: 1 }}>ANALYZING...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "14px 18px", borderTop: `1px solid ${J.magenta}15`, flexShrink: 0, position: "relative" }}>
        <HudCorner position="bl" color={J.magenta} />
        <HudCorner position="br" color={J.magenta} />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(255,0,110,0.03)", border: `1px solid ${J.magenta}15`, borderRadius: 2, padding: "4px 4px 4px 14px" }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Ask about this connection..." rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: "#e0f0ff", fontSize: 13, fontFamily: J.fontBody, fontWeight: 500, resize: "none", outline: "none", padding: "8px 0", maxHeight: 80, lineHeight: 1.5 }}
          />
          <button onClick={() => sendMessage()} disabled={isLoading || !input.trim()}
            style={{ background: input.trim() ? J.magenta : "rgba(255,0,110,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: input.trim() ? `0 0 12px ${J.magenta}40` : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#fff" : "rgba(255,0,110,0.2)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LOADING SCREEN ─────────────────────────────────────────────────────────

function LoadingScreen({ topic }) {
  const [dots, setDots] = useState("");
  const [phase, setPhase] = useState(0);
  const phases = ["INITIALIZING KNOWLEDGE MATRIX", "MAPPING NEURAL TOPOLOGY", "IDENTIFYING HUB NODES", "CALIBRATING SYNAPTIC WEIGHTS", "RENDERING INTERFACE"];

  useEffect(() => {
    const i1 = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    const i2 = setInterval(() => setPhase(p => (p + 1) % phases.length), 2800);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: J.bg, zIndex: 100 }}>
      <HexGrid /><ScanLine />
      <div style={{ position: "relative", width: 160, height: 160, marginBottom: 48 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ position: "absolute", inset: i * 14, border: `1px solid rgba(0,229,255,${0.25 - i * 0.05})`, borderTop: `1px solid ${J.cyan}`, borderRadius: "50%", animation: `spinRing ${2.5 + i * 0.8}s linear infinite${i % 2 ? " reverse" : ""}` }}>
            <div style={{ position: "absolute", top: -2, left: "50%", width: 4, height: 4, background: HUB_PALETTE[i], boxShadow: `0 0 8px ${HUB_PALETTE[i]}` }} />
          </div>
        ))}
        <div style={{ position: "absolute", inset: 60, background: "rgba(0,229,255,0.05)", borderRadius: "50%", border: `1px solid ${J.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 12, height: 12, background: J.cyan, boxShadow: `0 0 24px ${J.cyan}, 0 0 48px ${J.cyanGlow}`, animation: "corePulse 1.5s ease-in-out infinite" }} />
        </div>
      </div>
      <div style={{ fontSize: 14, fontFamily: J.fontDisplay, fontWeight: 700, color: J.cyan, letterSpacing: 6, textTransform: "uppercase", marginBottom: 8, textShadow: `0 0 20px ${J.cyanGlow}` }}>NEURAL MAP</div>
      <div style={{ fontSize: 18, fontFamily: J.fontDisplay, fontWeight: 600, color: "#fff", marginBottom: 28, textAlign: "center", padding: "0 20px", letterSpacing: 1 }}>{topic}</div>
      <div style={{ fontSize: 11, fontFamily: J.fontMono, color: J.textDim, minWidth: 300, textAlign: "center", letterSpacing: 2 }}>{phases[phase]}{dots}</div>
      <div style={{ position: "absolute", bottom: 30, display: "flex", gap: 20, opacity: 0.25 }}>
        {["SYS:NOMINAL", "NET:ACTIVE", "AI:ONLINE", "MEM:OK"].map((s, i) => (
          <span key={i} style={{ fontSize: 9, fontFamily: J.fontMono, color: J.cyan, letterSpacing: 2 }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

// ─── JARVIS CHAT (general) ──────────────────────────────────────────────────

function JarvisChat({ onClose }) {
  const mobile = useIsMobile();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceModeRef = useRef(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const speakText = useCallback(async (text) => {
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) return;
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      audioUrlRef.current = url; const audio = new Audio(); audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioUrlRef.current = null; audioRef.current = null; };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioUrlRef.current = null; audioRef.current = null; };
      audio.src = url; audio.play().catch(() => {});
    } catch {}
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    setIsSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; stopSpeaking();
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onstart = () => setIsListening(true);
    r.onresult = (e) => { setInput(Array.from(e.results).map(r => r[0].transcript).join("")); };
    r.onerror = () => setIsListening(false); r.onend = () => setIsListening(false);
    recognitionRef.current = r; r.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    setIsListening(false); voiceModeRef.current = true;
  }, []);

  const sendMessage = async (overrideText) => {
    const msgText = overrideText || input.trim();
    if (!msgText || isLoading) return;
    setInput(""); setMessages(prev => [...prev, { role: "user", content: msgText }]);
    setIsLoading(true); const isVoice = voiceModeRef.current;
    try {
      let searchContext = "";
      if (needsWebSearch(msgText)) {
        const results = await webSearch(msgText);
        if (results && results.length > 0) {
          searchContext = "\n\nWEB SEARCH RESULTS:\n" + results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.description}\n   Source: ${r.url}`).join("\n");
        }
      }
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: msgText });
      const data = await callClaude({
        model: "claude-sonnet-4-20250514", max_tokens: isVoice ? 500 : 1500,
        system: `You are JARVIS, an advanced AI assistant. Be knowledgeable, direct, engaging. Reference specific facts. When web search results are provided, use them for current info.
${isVoice ? "This is VOICE mode. Keep to 2-3 sentences. End with a direct question." : "End with a direct question the user can answer."}${searchContext}`,
        messages: history,
      });
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "Unable to process.";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
      if (isVoice) speakText(text);
    } catch (err) { setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]); }
    setIsLoading(false);
  };

  const prevListeningRef = useRef(false);
  useEffect(() => {
    if (prevListeningRef.current && !isListening && voiceModeRef.current && input.trim()) {
      const timer = setTimeout(() => sendMessage(input.trim()), 200);
      return () => clearTimeout(timer);
    }
    prevListeningRef.current = isListening;
  }, [isListening]);

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); voiceModeRef.current = false; sendMessage(); } };

  return (
    <div style={{ position: "absolute", top: mobile ? 0 : "50%", left: mobile ? 0 : "50%", transform: mobile ? "none" : "translate(-50%, -50%)", width: mobile ? "100%" : "90%", maxWidth: mobile ? "100%" : 560, height: mobile ? "100%" : "70vh", maxHeight: mobile ? "100%" : 640, background: J.bgPanel, backdropFilter: "blur(30px)", border: `1px solid ${J.cyan}20`, display: "flex", flexDirection: "column", zIndex: 60, boxShadow: `0 0 60px rgba(0,0,0,0.6), 0 0 30px ${J.cyanGlow}` }}>
      <ScanLine /><HudCorner position="tl" color={J.cyan} /><HudCorner position="tr" color={J.cyan} /><HudCorner position="bl" color={J.cyan} /><HudCorner position="br" color={J.cyan} />
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${J.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, position: "relative", zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 3, height: 16, background: J.cyan, boxShadow: `0 0 8px ${J.cyanGlow}` }} />
          <span style={{ fontSize: 11, fontFamily: J.fontDisplay, color: J.cyan, letterSpacing: 4, fontWeight: 700 }}>JARVIS // GENERAL</span>
        </div>
        <button onClick={() => { stopSpeaking(); onClose(); }} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 15, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, position: "relative", zIndex: 3 }}>
        {messages.length === 0 && (
          <div style={{ padding: "30px 0", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontFamily: J.fontDisplay, color: J.textDim, letterSpacing: 3, marginBottom: 8 }}>JARVIS ONLINE</div>
            <div style={{ fontSize: 13, fontFamily: J.fontBody, color: J.textMid, lineHeight: 1.6 }}>Ask me anything — science, history, tech,<br />philosophy, current events, or anything else.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
            {msg.role === "assistant" && <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.cyan, marginBottom: 4, letterSpacing: 3 }}>JARVIS</div>}
            <div style={{ background: msg.role === "user" ? `${J.cyan}15` : "rgba(0,229,255,0.04)", border: `1px solid ${msg.role === "user" ? `${J.cyan}30` : J.border}`, borderRadius: 2, padding: "11px 15px", fontSize: 13, lineHeight: 1.7, fontFamily: J.fontBody, color: msg.role === "user" ? "#e0f0ff" : J.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: "flex-start" }}>
            <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.cyan, marginBottom: 4, letterSpacing: 3 }}>JARVIS</div>
            <div style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "13px 18px", display: "flex", gap: 6, alignItems: "center" }}>
              {[0,1,2].map(j => <div key={j} style={{ width: 6, height: 6, background: J.cyan, animation: `jarvisPulse 1.2s ease-in-out ${j*0.15}s infinite` }} />)}
              <span style={{ fontSize: 10, fontFamily: J.fontMono, color: J.textDim, marginLeft: 6, letterSpacing: 1 }}>PROCESSING...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {isSpeaking && (
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${J.cyan}20`, display: "flex", alignItems: "center", gap: 8, background: `${J.cyan}08`, position: "relative", zIndex: 3 }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>{[0,1,2,3,4].map(i => <div key={i} style={{ width: 3, height: 8 + Math.sin(i * 1.2) * 6, background: J.cyan, animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`, borderRadius: 1 }} />)}</div>
          <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.cyan, letterSpacing: 3 }}>JARVIS // SPEAKING</span>
          <button onClick={stopSpeaking} style={{ marginLeft: "auto", background: "rgba(255,0,110,0.1)", border: `1px solid rgba(255,0,110,0.3)`, borderRadius: 2, padding: "3px 10px", fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, cursor: "pointer", letterSpacing: 2 }}>STOP</button>
        </div>
      )}
      <div style={{ padding: "14px 18px", borderTop: `1px solid ${J.border}`, flexShrink: 0, position: "relative", zIndex: 3 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(0,229,255,0.03)", border: `1px solid ${isListening ? J.cyan + "50" : J.border}`, borderRadius: 2, padding: "4px 4px 4px 14px", transition: "all 0.3s", boxShadow: isListening ? `0 0 20px ${J.cyan}15` : "none" }}>
          <textarea ref={inputRef} value={input} onChange={e => { setInput(e.target.value); voiceModeRef.current = false; }} onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : "Ask JARVIS anything..."} rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: isListening ? J.cyan : "#e0f0ff", fontSize: 13, fontFamily: J.fontBody, fontWeight: 500, resize: "none", outline: "none", padding: "8px 0", maxHeight: 80, lineHeight: 1.5 }} />
          <button onClick={isListening ? stopListening : startListening} disabled={isLoading}
            style={{ background: isListening ? J.cyan : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, animation: isListening ? "micPulse 1.5s ease-in-out infinite" : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isListening ? "#000" : "rgba(0,229,255,0.5)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="12" rx="3" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </button>
          <button onClick={() => { voiceModeRef.current = false; sendMessage(); }} disabled={isLoading || !input.trim()}
            style={{ background: input.trim() ? J.cyan : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: input.trim() ? `0 0 12px ${J.cyanGlow}` : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(0,229,255,0.2)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LANDING SCREEN ─────────────────────────────────────────────────────────

function LandingScreen({ onGenerate }) {
  const mobile = useIsMobile();
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [showJarvis, setShowJarvis] = useState(false);

  const handleSubmit = () => { if (input.trim()) onGenerate(input.trim()); };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: J.bg, padding: 20 }}>
      <HexGrid /><ScanLine />
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: 0.2 }}>
        {Array.from({ length: 50 }, (_, i) => {
          const isAccent = seededRandom(i * 19) > 0.85;
          return (<div key={i} style={{ position: "absolute", left: `${seededRandom(i * 7) * 100}%`, top: `${seededRandom(i * 13 + 3) * 100}%`, width: isAccent ? 4 : 2, height: isAccent ? 4 : 2, background: isAccent ? J.cyan : J.blue, boxShadow: isAccent ? `0 0 6px ${J.cyan}` : "none", animation: `floatDot ${4 + seededRandom(i * 31) * 6}s ease-in-out ${seededRandom(i * 41) * 3}s infinite alternate` }} />);
        })}
      </div>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.04, pointerEvents: "none" }}>
        {Array.from({ length: 20 }, (_, i) => (<line key={i} x1={`${seededRandom(i * 5) * 100}%`} y1={`${seededRandom(i * 11) * 100}%`} x2={`${seededRandom(i * 17 + 3) * 100}%`} y2={`${seededRandom(i * 23 + 7) * 100}%`} stroke={J.cyan} strokeWidth="0.5" />))}
      </svg>
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 1, background: `linear-gradient(90deg, transparent, ${J.cyan})` }} />
          <div style={{ fontSize: 10, fontFamily: J.fontDisplay, color: J.cyan, letterSpacing: 6, textTransform: "uppercase", fontWeight: 700, textShadow: `0 0 15px ${J.cyanGlow}` }}>NEURAL MAP</div>
          <div style={{ width: 40, height: 1, background: `linear-gradient(90deg, ${J.cyan}, transparent)` }} />
        </div>
        <h1 style={{ fontSize: mobile ? 22 : 32, fontFamily: J.fontDisplay, fontWeight: 700, color: "#fff", margin: "0 0 10px", lineHeight: 1.15, letterSpacing: mobile ? 0 : 1 }}>
          MAP ANY SUBJECT AS A<br /><span style={{ color: J.cyan, textShadow: `0 0 30px ${J.cyanGlow}` }}>NEURAL NETWORK</span>
        </h1>
        <p style={{ fontSize: mobile ? 12 : 14, fontFamily: J.fontBody, fontWeight: 400, color: J.textMid, margin: "0 0 28px", lineHeight: 1.7 }}>
          Enter any topic and watch AI knowledge unfold into an interactive knowledge graph you can explore and interrogate.
        </p>
        <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} style={{ display: "flex", gap: 0, marginBottom: mobile ? 24 : 36, position: "relative", border: `1px solid ${isFocused ? J.cyan + "50" : J.border}`, background: isFocused ? "rgba(0,229,255,0.04)" : "rgba(0,229,255,0.02)", transition: "all 0.3s", boxShadow: isFocused ? `0 0 20px rgba(0,229,255,0.1)` : "none" }}>
          <HudCorner position="tl" size={12} /><HudCorner position="tr" size={12} /><HudCorner position="bl" size={12} /><HudCorner position="br" size={12} />
          <input value={input} onChange={e => setInput(e.target.value)} onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)} placeholder="ENTER TARGET TOPIC..."
            style={{ flex: 1, background: "transparent", border: "none", color: "#e0f0ff", fontSize: 14, fontFamily: J.fontBody, fontWeight: 500, outline: "none", padding: "14px 18px", letterSpacing: 1, position: "relative", zIndex: 3 }} />
          <button type="submit" disabled={!input.trim()} style={{ background: input.trim() ? J.cyan : "rgba(0,229,255,0.08)", border: "none", padding: mobile ? "14px 16px" : "14px 28px", fontSize: mobile ? 10 : 12, fontWeight: 700, fontFamily: J.fontDisplay, letterSpacing: mobile ? 2 : 3, color: input.trim() ? J.bg : "rgba(0,229,255,0.25)", cursor: input.trim() ? "pointer" : "default", transition: "all 0.2s", boxShadow: input.trim() ? `0 0 20px ${J.cyanGlow}` : "none", position: "relative", zIndex: 3 }}>INITIALIZE</button>
        </form>
        <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.textDim, textTransform: "uppercase", letterSpacing: 4, marginBottom: 14 }}>SELECT TARGET</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: mobile ? 6 : 8, justifyContent: "center" }}>
          {SUGGESTED_TOPICS.map(t => (
            <button key={t.label} onClick={() => onGenerate(t.label)}
              style={{ background: "rgba(0,229,255,0.03)", border: `1px solid ${J.border}`, borderRadius: 1, padding: mobile ? "6px 10px" : "8px 16px", fontSize: mobile ? 11 : 12, fontFamily: J.fontBody, fontWeight: 500, color: J.textMid, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: mobile ? 5 : 8, letterSpacing: 0.5 }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,229,255,0.08)"; e.currentTarget.style.borderColor = J.cyan + "40"; e.currentTarget.style.color = J.cyan; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,229,255,0.03)"; e.currentTarget.style.borderColor = J.border; e.currentTarget.style.color = J.textMid; }}
            ><span style={{ fontSize: 8, color: J.cyan }}>{t.icon}</span>{t.label}</button>
          ))}
        </div>
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
          <button onClick={() => setShowJarvis(true)}
            style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.cyan}30`, borderRadius: 2, padding: "12px 28px", fontSize: 12, fontFamily: J.fontDisplay, fontWeight: 700, color: J.cyan, cursor: "pointer", letterSpacing: 3, transition: "all 0.2s", display: "flex", alignItems: "center", gap: 10 }}
            onMouseEnter={e => { e.currentTarget.style.background = `rgba(0,229,255,0.1)`; e.currentTarget.style.boxShadow = `0 0 20px ${J.cyanGlow}`; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,229,255,0.04)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={J.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="12" rx="3" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            ASK JARVIS
          </button>
        </div>
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 24, opacity: 0.3 }}>
          {["STATUS: READY", "AI: ONLINE", "v2.0.0"].map((s, i) => (
            <span key={i} style={{ fontSize: 9, fontFamily: J.fontMono, color: J.cyan, letterSpacing: 2 }}>{s}</span>
          ))}
        </div>
      </div>
      {showJarvis && <JarvisChat onClose={() => setShowJarvis(false)} />}
    </div>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────

export default function NeuralMapApp() {
  const mobile = useIsMobile();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [appState, setAppState] = useState("landing");
  const [mapData, setMapData] = useState(null);
  const [currentTopic, setCurrentTopic] = useState("");
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ w: 900, h: 700 });
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Feature 1: Save & Share
  const [mapId, setMapId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Feature 2: Export
  const [showMapExport, setShowMapExport] = useState(false);
  // Feature 3: Go Deeper
  const [mapStack, setMapStack] = useState([]);
  // Feature 4: Chat History
  const chatCacheRef = useRef({});
  // Feature 5: Connections
  const [showConnections, setShowConnections] = useState(false);
  const [connections, setConnections] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const animFrameRef = useRef(null);
  const layoutRef = useRef({});
  const visibleNodesRef = useRef([]);
  const panRef = useRef({ x: 0, y: 0, startX: 0, startY: 0, isPanning: false, scale: 1 });
  const timeRef = useRef(0);
  const treeStateRef = useRef({
    phase: "idle",
    expandedSubId: null,
    pendingExpandSubId: null,
    animProgress: 0,
    animStartTime: null,
    animDuration: 800,
    animType: null,
  });

  // Feature 1: Load shared map from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get("map");
    if (sharedId) {
      setAppState("loading"); setCurrentTopic("Loading shared map...");
      fetch(`/api/maps/${sharedId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.map_data) {
            setMapData(data.map_data); setCurrentTopic(data.topic); setMapId(sharedId); setAppState("map");
          } else { setError("Shared map not found"); setAppState("landing"); }
        })
        .catch(() => { setError("Failed to load shared map"); setAppState("landing"); });
    }
  }, []);

  // Feature 1: Save map
  const saveMap = async () => {
    if (isSaving || !mapData) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/maps", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: currentTopic, map_data: mapData }),
      });
      const { id } = await res.json();
      if (id) {
        setMapId(id);
        // Flush chat cache to Supabase
        const cacheEntries = Object.entries(chatCacheRef.current);
        if (cacheEntries.length > 0) {
          await Promise.all(cacheEntries.map(([nodeId, messages]) =>
            fetch(`/api/maps/${id}/chat`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nodeId, messages }),
            }).catch(() => {})
          ));
        }
      }
    } catch {} finally { setIsSaving(false); }
  };

  const copyShareLink = () => {
    if (!mapId) return;
    navigator.clipboard.writeText(`${window.location.origin}?map=${mapId}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Feature 2: Export map as PNG
  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `neural-map-${currentTopic.replace(/\s+/g, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setShowMapExport(false);
  };

  // Feature 2: Export map as PDF
  const exportMapPDF = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape" });
    const pw = doc.internal.pageSize.width; const ph = doc.internal.pageSize.height;
    doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F");
    doc.setTextColor(0, 229, 255); doc.setFontSize(22);
    doc.text((mapData.title || currentTopic).toUpperCase(), 20, 25);
    doc.setTextColor(192, 216, 232); doc.setFontSize(9);
    doc.text(`${totalNodes} nodes // ${totalSubs} categories`, 20, 33);
    doc.setDrawColor(0, 229, 255); doc.line(20, 37, pw - 20, 37);
    const imgData = canvas.toDataURL("image/png");
    doc.addImage(imgData, "PNG", 10, 42, pw - 20, ph - 55);
    // Node directory page
    doc.addPage(); doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F");
    doc.setTextColor(0, 229, 255); doc.setFontSize(16); doc.text("NODE DIRECTORY", 20, 20);
    let y = 32;
    mapData.subcategories.forEach(sub => {
      if (y > ph - 25) { doc.addPage(); doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F"); y = 20; }
      doc.setTextColor(0, 229, 255); doc.setFontSize(11); doc.text(sub.title.toUpperCase(), 20, y); y += 6;
      doc.setTextColor(120, 160, 180); doc.setFontSize(8); doc.text(sub.summary || "", 24, y); y += 6;
      sub.topics.forEach(t => {
        if (y > ph - 15) { doc.addPage(); doc.setFillColor(3, 8, 15); doc.rect(0, 0, pw, ph, "F"); y = 20; }
        doc.setTextColor(192, 216, 232); doc.setFontSize(9); doc.text(`• ${t.title}`, 28, y); y += 5;
        doc.setTextColor(100, 130, 150); doc.setFontSize(7); doc.text(t.summary || "", 34, y); y += 6;
      });
      y += 4;
    });
    doc.save(`neural-map-${currentTopic.replace(/\s+/g, "-")}.pdf`);
    setShowMapExport(false);
  };

  // Feature 3: Go Deeper
  const goDeeper = () => {
    const state = treeStateRef.current;
    if (!state.expandedSubId || !mapData || mapStack.length >= 7) return;
    const sub = mapData.subcategories.find(s => s.id === state.expandedSubId);
    if (!sub) return;
    setMapStack(prev => [...prev, {
      mapData, topic: currentTopic, mapId,
      treeState: { ...state }, chatCache: { ...chatCacheRef.current },
      pan: { ...panRef.current },
    }]);
    chatCacheRef.current = {};
    setMapId(null); setSelectedNode(null); setSelectedSub(null);
    generateMap(sub.title);
  };

  const goBack = (targetIndex) => {
    const idx = targetIndex ?? mapStack.length - 1;
    if (idx < 0 || idx >= mapStack.length) return;
    const snapshot = mapStack[idx];
    setMapData(snapshot.mapData); setCurrentTopic(snapshot.topic); setMapId(snapshot.mapId);
    treeStateRef.current = snapshot.treeState;
    chatCacheRef.current = snapshot.chatCache;
    panRef.current = snapshot.pan;
    setAppState("map"); setSelectedNode(null); setSelectedSub(null);
    setMapStack(prev => prev.slice(0, idx));
  };

  // Feature 5: Analyze connections across maps
  const analyzeConnections = async () => {
    if (isAnalyzing) return;
    // Collect all maps: current + stack (only saved ones with IDs)
    const allMaps = [];
    if (mapId && mapData) allMaps.push({ id: mapId, topic: currentTopic, map_data: mapData });
    mapStack.forEach(s => { if (s.mapId && s.mapData) allMaps.push({ id: s.mapId, topic: s.topic, map_data: s.mapData }); });

    if (allMaps.length < 2) {
      // If not enough saved maps, save current first
      if (!mapId && mapData) {
        await saveMap();
        // Re-collect after save
        const updatedMaps = [{ id: mapId, topic: currentTopic, map_data: mapData }];
        mapStack.forEach(s => { if (s.mapId && s.mapData) updatedMaps.push({ id: s.mapId, topic: s.topic, map_data: s.mapData }); });
        if (updatedMaps.filter(m => m.id).length < 2) return;
      } else return;
    }

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/connections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maps: allMaps }),
      });
      const data = await res.json();
      if (data.connections) setConnections(data.connections);
    } catch {} finally { setIsAnalyzing(false); }
  };

  // Check if we have enough maps for connections
  const savedMapCount = (mapId ? 1 : 0) + mapStack.filter(s => s.mapId).length;

  function startAnimation(type, subId) {
    const s = treeStateRef.current;
    s.animType = type;
    s.animStartTime = performance.now();
    s.animProgress = 0;
    if (type === "expand-l2") s.phase = "expanding-l2";
    else if (type === "expand-l3") { s.phase = "expanding-l3"; s.expandedSubId = subId || s.expandedSubId; }
    else if (type === "collapse-l3") { s.phase = "collapsing-l3"; s.animDuration = 500; }
  }

  // Generate map
  const generateMap = async (topic) => {
    setCurrentTopic(topic); setAppState("loading"); setError(null);
    setSelectedNode(null); setSelectedSub(null);
    panRef.current = { x: 0, y: 0, startX: 0, startY: 0, isPanning: false, scale: 1 };
    treeStateRef.current = { phase: "idle", expandedSubId: null, pendingExpandSubId: null, animProgress: 0, animStartTime: null, animDuration: 800, animType: null };

    try {
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{ role: "user", content: buildGenerationPrompt(topic) }],
      });

      const text = data.content?.find(b => b.type === "text")?.text || "";
      let clean = text.replace(/```json|```/g, "").trim();

      let parsed;
      try { parsed = JSON.parse(clean); } catch (e) {
        const lastGoodBrace = clean.lastIndexOf("}");
        if (lastGoodBrace > 0) {
          let repaired = clean.substring(0, lastGoodBrace + 1);
          const opens = (repaired.match(/\[/g) || []).length;
          const closes = (repaired.match(/\]/g) || []).length;
          const openBraces = (repaired.match(/\{/g) || []).length;
          const closeBraces = (repaired.match(/\}/g) || []).length;
          for (let i = 0; i < opens - closes; i++) repaired += "]";
          for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
          try { parsed = JSON.parse(repaired); } catch { throw new Error("Could not parse — try a more specific topic"); }
        }
        if (!parsed) throw new Error("Could not parse — try a more specific topic");
      }

      // Validate hierarchical structure
      if (!parsed.master || !parsed.subcategories || !Array.isArray(parsed.subcategories) || parsed.subcategories.length === 0) {
        throw new Error("Invalid map structure — try again");
      }
      // Ensure IDs exist
      if (!parsed.master.id) parsed.master.id = "master";
      parsed.subcategories.forEach((sub, i) => {
        if (!sub.id) sub.id = `sub_${i + 1}`;
        if (!sub.topics) sub.topics = [];
        sub.topics.forEach((t, j) => { if (!t.id) t.id = `topic_${i + 1}_${j + 1}`; });
      });

      setMapData(parsed);
      setAppState("map");
    } catch (err) {
      setError(`Failed to generate map: ${err.message}`);
      setAppState("landing");
    }
  };

  // Compute layout when mapData or dimensions change
  useEffect(() => {
    if (!mapData || appState !== "map") return;
    layoutRef.current = computeTreeLayout(mapData, dimensions.w, dimensions.h);
  }, [mapData, dimensions, appState]);

  // Canvas render — phase-aware tree with heartbeat
  useEffect(() => {
    if (appState !== "map" || !mapData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const render = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const pan = panRef.current;
      const dpr = window.devicePixelRatio || 1;
      const layout = layoutRef.current;
      const state = treeStateRef.current;

      canvas.width = dimensions.w * dpr;
      canvas.height = dimensions.h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background
      ctx.fillStyle = J.bg;
      ctx.fillRect(0, 0, dimensions.w, dimensions.h);
      const bgGrad = ctx.createRadialGradient(dimensions.w/2, dimensions.h/2, 0, dimensions.w/2, dimensions.h/2, Math.max(dimensions.w, dimensions.h) * 0.6);
      bgGrad.addColorStop(0, "rgba(0,229,255,0.02)");
      bgGrad.addColorStop(1, "transparent");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, dimensions.w, dimensions.h);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(pan.scale, pan.scale);

      // Update animation progress
      if (state.animStartTime) {
        const elapsed = performance.now() - state.animStartTime;
        state.animProgress = Math.min(1, elapsed / state.animDuration);
        if (state.animProgress >= 1) {
          state.animStartTime = null;
          if (state.animType === "expand-l2") state.phase = "expanded-l2";
          else if (state.animType === "expand-l3") state.phase = "expanded-l3";
          else if (state.animType === "collapse-l3") {
            if (state.pendingExpandSubId) {
              state.expandedSubId = state.pendingExpandSubId;
              state.pendingExpandSubId = null;
              state.animType = "expand-l3"; state.animStartTime = performance.now();
              state.animProgress = 0; state.animDuration = 800; state.phase = "expanding-l3";
            } else {
              state.phase = "expanded-l2"; state.expandedSubId = null;
            }
          }
        }
      }

      const eased = easeOutCubic(state.animProgress);
      const masterLayout = layout["master"];
      if (!masterLayout) { ctx.restore(); animFrameRef.current = requestAnimationFrame(render); return; }

      const visibleNodes = [];
      const hovId = hoveredNode?.id;
      const selId = selectedNode?.id;

      // ─── Helper: draw a node ───
      function drawNode(id, x, y, baseR, color, level, scale, alpha) {
        const pulse = heartbeatPulse(t, layout[id]?.pulsePhase || 0, level === 0 ? 0.2 : level === 1 ? 0.15 : 0.1);
        const r = baseR * pulse * scale;
        if (r < 0.5) return;

        const isHov = hovId === id;
        const isSel = selId === id;

        ctx.globalAlpha = alpha;

        // Outer glow
        const glowR = level === 0 ? r * 4 : level === 1 ? r * 3 : r * 2.5;
        const gGrad = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
        gGrad.addColorStop(0, color + (isHov || isSel ? "40" : "20"));
        gGrad.addColorStop(1, color + "00");
        ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = gGrad; ctx.fill();

        // Rotating arc ring (master and sub-nodes)
        if (level <= 1) {
          const ringR = r * 2.2;
          ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = color + "15"; ctx.lineWidth = 0.5; ctx.stroke();
          const arcStart = t * (level === 0 ? 0.8 : 1.2) + (layout[id]?.pulsePhase || 0);
          ctx.beginPath(); ctx.arc(x, y, ringR, arcStart, arcStart + Math.PI * 0.5);
          ctx.strokeStyle = color + "45"; ctx.lineWidth = 1.2; ctx.stroke();
        }

        // Core sphere
        const cGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
        cGrad.addColorStop(0, "#fff");
        cGrad.addColorStop(0.3, color);
        cGrad.addColorStop(1, color + "60");
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = cGrad; ctx.fill();

        // Inner glow
        ctx.shadowColor = color;
        ctx.shadowBlur = level === 0 ? 16 : level === 1 ? 10 : 6;
        ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.shadowBlur = 0;

        // Hover/select ring
        if (isSel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
        else if (isHov) { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }

        ctx.globalAlpha = 1;

        // Label below node
        if (scale > 0.5) {
          ctx.globalAlpha = alpha * Math.min(1, (scale - 0.5) * 4);
          ctx.font = `${level === 0 ? 600 : 500} ${level === 0 ? 11 : level === 1 ? 10 : 9}px ${J.fontDisplay.replace(/'/g, "")}`;
          ctx.textAlign = "center";
          ctx.fillStyle = isHov || isSel ? "#fff" : color;
          if (level > 0) ctx.fillText("", x, y + r + 14);
          ctx.globalAlpha = 1;
        }
      }

      // ─── Helper: draw connector ───
      function drawConnector(px, py, tx, ty, color, progress, idx) {
        const cx = px + (tx - px) * progress;
        const cy = py + (ty - py) * progress;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy);
        ctx.strokeStyle = color + "30"; ctx.lineWidth = 1; ctx.stroke();

        // Data pulse dot
        const dotProgress = (t * 0.3 + idx * 0.5) % 3;
        if (dotProgress < 1 && progress > 0.5) {
          const dx = px + (cx - px) * dotProgress;
          const dy = py + (cy - py) * dotProgress;
          ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI * 2);
          ctx.fillStyle = color + "80"; ctx.fill();
        }
      }

      // ─── Draw master node (always) ───
      const mx = masterLayout.x;
      const my = masterLayout.y;
      drawNode("master", mx, my, 20, masterLayout.color, 0, 1, 1);
      visibleNodes.push({ id: "master", x: mx, y: my, level: 0, r: 20 });

      // Draw master label
      ctx.font = `700 11px Orbitron, sans-serif`;
      ctx.textAlign = "center"; ctx.fillStyle = masterLayout.color;
      ctx.fillText(mapData.master.title.toUpperCase(), mx, my + 34);

      // ─── Draw L2 sub-nodes ───
      const showL2 = state.phase !== "idle";
      if (showL2) {
        const l2Progress = (state.phase === "expanding-l2") ? eased : 1;
        mapData.subcategories.forEach((sub, i) => {
          const sl = layout[sub.id];
          if (!sl) return;
          const sx = mx + (sl.x - mx) * l2Progress;
          const sy = my + (sl.y - my) * l2Progress;
          const scale = l2Progress;

          drawConnector(mx, my, sx, sy, sl.color, l2Progress, i);
          drawNode(sub.id, sx, sy, 12, sl.color, 1, scale, l2Progress);
          visibleNodes.push({ id: sub.id, x: sx, y: sy, level: 1, r: 12 * scale, subIndex: i });

          // Sub-node label
          if (l2Progress > 0.5) {
            ctx.globalAlpha = Math.min(1, (l2Progress - 0.5) * 4);
            ctx.font = `500 9px Orbitron, sans-serif`;
            ctx.textAlign = "center"; ctx.fillStyle = sl.color;
            ctx.fillText(sub.title.toUpperCase(), sx, sy + 12 * scale * heartbeatPulse(t, sl.pulsePhase, 0.15) + 16);
            ctx.globalAlpha = 1;
          }
        });
      }

      // ─── Draw L3 topic nodes ───
      const showL3 = state.phase === "expanding-l3" || state.phase === "expanded-l3" || state.phase === "collapsing-l3";
      if (showL3 && state.expandedSubId) {
        const sub = mapData.subcategories.find(s => s.id === state.expandedSubId);
        const subLayout = layout[state.expandedSubId];
        if (sub && subLayout) {
          let l3Progress;
          if (state.phase === "expanding-l3") l3Progress = eased;
          else if (state.phase === "collapsing-l3") l3Progress = 1 - eased;
          else l3Progress = 1;

          sub.topics.forEach((topic, j) => {
            const tl = layout[topic.id];
            if (!tl) return;
            const parentX = subLayout.x;
            const parentY = subLayout.y;
            const tx = parentX + (tl.x - parentX) * l3Progress;
            const ty = parentY + (tl.y - parentY) * l3Progress;
            const scale = l3Progress;

            drawConnector(parentX, parentY, tx, ty, tl.color, l3Progress, j + 100);
            drawNode(topic.id, tx, ty, 7, tl.color, 2, scale, l3Progress);
            visibleNodes.push({ id: topic.id, x: tx, y: ty, level: 2, r: 7 * scale, subId: state.expandedSubId, topicIndex: j });

            // Topic label
            if (l3Progress > 0.6) {
              ctx.globalAlpha = Math.min(1, (l3Progress - 0.6) * 5);
              ctx.font = `400 8px Orbitron, sans-serif`;
              ctx.textAlign = "center"; ctx.fillStyle = tl.color + "CC";
              ctx.fillText(topic.title, tx, ty + 7 * scale * heartbeatPulse(t, tl.pulsePhase, 0.1) + 13);
              ctx.globalAlpha = 1;
            }
          });
        }
      }

      visibleNodesRef.current = visibleNodes;

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [dimensions, hoveredNode, selectedNode, mapData, appState]);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) setDimensions({ w: containerRef.current.clientWidth, h: Math.max(500, containerRef.current.clientHeight) });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Hit detection on visible nodes
  const getNodeAt = useCallback((cssX, cssY) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const dpr = window.devicePixelRatio || 1;
    const mx = (cssX * scaleX) / dpr;
    const my = (cssY * scaleY) / dpr;
    const pan = panRef.current;
    const x = (mx - pan.x) / pan.scale;
    const y = (my - pan.y) / pan.scale;
    let closest = null;
    let closestDist = Infinity;
    const hitRadius = 28 / pan.scale;
    for (const n of visibleNodesRef.current) {
      const dx = x - n.x;
      const dy = y - n.y;
      const dist = dx * dx + dy * dy;
      if (dist < hitRadius * hitRadius && dist < closestDist) { closest = n; closestDist = dist; }
    }
    return closest;
  }, []);

  const handleMouseMove = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (panRef.current.isPanning) { panRef.current.x = mx - panRef.current.startX; panRef.current.y = my - panRef.current.startY; return; }
    const node = getNodeAt(mx, my);
    setHoveredNode(node);
    if (node) setTooltipPos({ x: e.clientX, y: e.clientY });
    if (canvasRef.current) canvasRef.current.style.cursor = node ? "pointer" : "crosshair";
  };

  const handleNodeClick = useCallback((nodeInfo) => {
    if (!nodeInfo) return;
    const state = treeStateRef.current;
    if (state.animStartTime) return; // ignore during animation

    if (nodeInfo.level === 0) {
      if (state.phase === "idle") startAnimation("expand-l2");
      else if (state.phase === "expanded-l2") {
        // Collapse back to idle
        treeStateRef.current = { phase: "idle", expandedSubId: null, pendingExpandSubId: null, animProgress: 0, animStartTime: null, animDuration: 800, animType: null };
      }
      else if (state.phase === "expanded-l3") startAnimation("collapse-l3");
    } else if (nodeInfo.level === 1) {
      const clickedSubId = nodeInfo.id;
      if (state.phase === "expanded-l2") {
        startAnimation("expand-l3", clickedSubId);
        setSelectedSub(mapData.subcategories.find(s => s.id === clickedSubId) || null);
      } else if (state.phase === "expanded-l3") {
        if (clickedSubId === state.expandedSubId) {
          startAnimation("collapse-l3");
        } else {
          state.pendingExpandSubId = clickedSubId;
          startAnimation("collapse-l3");
          setSelectedSub(mapData.subcategories.find(s => s.id === clickedSubId) || null);
        }
      }
    } else if (nodeInfo.level === 2) {
      const sub = mapData.subcategories.find(s => s.id === nodeInfo.subId);
      if (sub) {
        const topic = sub.topics.find(t => t.id === nodeInfo.id);
        if (topic) {
          setSelectedNode({ ...topic, _subId: nodeInfo.subId });
          setSelectedSub(sub);
        }
      }
    }
  }, [mapData]);

  const handleClick = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    handleNodeClick(node);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    panRef.current.scale = Math.max(0.3, Math.min(3, panRef.current.scale * (e.deltaY > 0 ? 0.92 : 1.08)));
  };

  const handleMouseDown = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    if (!getNodeAt(mx, my)) {
      panRef.current.isPanning = true;
      panRef.current.startX = mx - panRef.current.x;
      panRef.current.startY = my - panRef.current.y;
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    }
  };

  const handleNavigate = (topicId) => {
    if (!mapData || !selectedSub) return;
    const topic = selectedSub.topics.find(t => t.id === topicId);
    if (topic) setSelectedNode({ ...topic, _subId: selectedSub.id });
  };

  // Count totals for header
  const totalNodes = mapData ? 1 + mapData.subcategories.length + mapData.subcategories.reduce((sum, s) => sum + s.topics.length, 0) : 0;
  const totalSubs = mapData ? mapData.subcategories.length : 0;

  // Get tooltip info
  const getTooltipInfo = (nodeInfo) => {
    if (!nodeInfo || !mapData) return null;
    if (nodeInfo.level === 0) return { title: mapData.master.title, color: mapData.master.color || J.cyan, hint: "CLICK TO EXPAND", summary: mapData.master.summary };
    if (nodeInfo.level === 1) {
      const sub = mapData.subcategories[nodeInfo.subIndex];
      return sub ? { title: sub.title, color: sub.color, hint: "CLICK TO EXPLORE", summary: sub.summary } : null;
    }
    if (nodeInfo.level === 2) {
      const sub = mapData.subcategories.find(s => s.id === nodeInfo.subId);
      const topic = sub?.topics[nodeInfo.topicIndex];
      return topic ? { title: topic.title, color: sub.color, hint: "CLICK TO ANALYZE", summary: topic.summary, tags: topic.tags } : null;
    }
    return null;
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100vh", background: J.bg, fontFamily: J.fontBody, color: J.text, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      {appState === "landing" && (
        <>
          <LandingScreen onGenerate={generateMap} />
          {error && (
            <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(255,0,110,0.12)", border: `1px solid rgba(255,0,110,0.3)`, borderRadius: 2, padding: "10px 20px", fontSize: 12, fontFamily: J.fontBody, color: J.magenta, zIndex: 200 }}>{error}</div>
          )}
        </>
      )}

      {appState === "loading" && <LoadingScreen topic={currentTopic} />}

      {appState === "map" && mapData && (
        <>
          {!isFullscreen && (
          <div style={{ padding: mobile ? "8px 10px" : "10px 18px", borderBottom: `1px solid ${J.border}`, display: "flex", alignItems: mobile ? "flex-start" : "center", justifyContent: "space-between", flexShrink: 0, zIndex: 40, background: "rgba(3,8,15,0.95)", backdropFilter: "blur(10px)", flexWrap: "wrap", gap: mobile ? 6 : 8, flexDirection: mobile ? "column" : "row" }}>
            <div style={{ display: "flex", alignItems: "center", gap: mobile ? 8 : 12, flexWrap: "wrap" }}>
              <button onClick={() => { setAppState("landing"); setMapData(null); setSelectedNode(null); setSelectedSub(null); setMapId(null); setMapStack([]); chatCacheRef.current = {}; setShowMapExport(false); }}
                style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: mobile ? "5px 10px" : "6px 14px", fontSize: mobile ? 10 : 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", minHeight: mobile ? 28 : 32, letterSpacing: 2 }}>◁ NEW</button>
              <div style={{ width: 3, height: 14, background: J.cyan, boxShadow: `0 0 8px ${J.cyanGlow}` }} />
              <span style={{ fontSize: mobile ? 11 : 14, fontFamily: J.fontDisplay, fontWeight: 700, color: J.cyan, letterSpacing: mobile ? 1 : 3, textTransform: "uppercase", textShadow: `0 0 12px ${J.cyanGlow}` }}>{mapData.title || currentTopic}</span>
              <span style={{ fontSize: mobile ? 9 : 11, fontFamily: J.fontMono, color: J.textDim, letterSpacing: 1 }}>{totalNodes} NODES // {totalSubs} CATEGORIES</span>
            </div>
            <div style={{ display: "flex", gap: mobile ? 4 : 6, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
              {/* Save / Share */}
              {!mapId ? (
                <button onClick={saveMap} disabled={isSaving}
                  style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: mobile ? "4px 8px" : "6px 14px", fontSize: mobile ? 9 : 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: isSaving ? "wait" : "pointer", minHeight: mobile ? 26 : 32, letterSpacing: 2 }}>{isSaving ? "SAVING..." : "SAVE"}</button>
              ) : (
                <button onClick={copyShareLink}
                  style={{ background: linkCopied ? `${J.cyan}15` : "rgba(0,229,255,0.04)", border: `1px solid ${linkCopied ? J.cyan + "40" : J.border}`, borderRadius: 2, padding: mobile ? "4px 8px" : "6px 14px", fontSize: mobile ? 9 : 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", minHeight: mobile ? 26 : 32, letterSpacing: 2 }}>{linkCopied ? "COPIED!" : "LINK"}</button>
              )}
              {/* Export dropdown */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowMapExport(!showMapExport)}
                  style={{ background: showMapExport ? `${J.cyan}15` : "rgba(0,229,255,0.04)", border: `1px solid ${showMapExport ? J.cyan + "40" : J.border}`, borderRadius: 2, padding: mobile ? "4px 8px" : "6px 14px", fontSize: mobile ? 9 : 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", minHeight: mobile ? 26 : 32, letterSpacing: 2 }}>EXPORT</button>
                {showMapExport && (
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: J.bgPanel, border: `1px solid ${J.border}`, zIndex: 60, minWidth: 140, boxShadow: `0 8px 24px rgba(0,0,0,0.5)` }}>
                    <button onClick={exportPNG} style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${J.border}`, padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: "pointer", textAlign: "left" }}>PNG Image</button>
                    <button onClick={exportMapPDF} style={{ display: "block", width: "100%", background: "none", border: "none", padding: "10px 14px", fontSize: 11, fontFamily: J.fontBody, color: J.text, cursor: "pointer", textAlign: "left" }}>PDF Report</button>
                  </div>
                )}
              </div>
              {/* Go Deeper */}
              {treeStateRef.current.phase === "expanded-l3" && mapStack.length < 7 && (
                <button onClick={goDeeper}
                  style={{ background: `${J.amber}15`, border: `1px solid ${J.amber}40`, borderRadius: 2, padding: mobile ? "4px 8px" : "6px 14px", fontSize: mobile ? 9 : 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.amber, cursor: "pointer", minHeight: mobile ? 26 : 32, letterSpacing: 2 }}>GO DEEPER</button>
              )}
              {/* Connections */}
              {savedMapCount >= 2 && (
                <button onClick={() => setShowConnections(!showConnections)}
                  style={{ background: showConnections ? `${J.magenta}15` : "rgba(0,229,255,0.04)", border: `1px solid ${showConnections ? J.magenta + "40" : J.border}`, borderRadius: 2, padding: mobile ? "4px 8px" : "6px 14px", fontSize: mobile ? 9 : 11, fontFamily: J.fontDisplay, fontWeight: 600, color: showConnections ? J.magenta : J.cyan, cursor: "pointer", minHeight: mobile ? 26 : 32, letterSpacing: 2 }}>CONNECTIONS</button>
              )}
              {!mobile && <button onClick={() => setIsFullscreen(true)}
                style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "6px 14px", fontSize: 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", minHeight: 32, letterSpacing: 2 }}>⛶ EXPAND</button>}
            </div>
          </div>
          )}

          {/* Breadcrumb */}
          {mapStack.length > 0 && !isFullscreen && (
            <div style={{ padding: mobile ? "5px 10px" : "6px 18px", borderBottom: `1px solid ${J.border}`, display: "flex", alignItems: "center", gap: 8, background: "rgba(3,8,15,0.95)", zIndex: 40, flexShrink: 0, overflow: "auto" }}>
              {mapStack.map((s, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => goBack(i)} style={{ background: "none", border: "none", color: J.cyan, fontFamily: J.fontDisplay, fontSize: mobile ? 9 : 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: `${J.cyan}40` }}>{s.topic}</button>
                  <span style={{ color: J.textDim, fontFamily: J.fontMono, fontSize: 10 }}>▸</span>
                </span>
              ))}
              <span style={{ color: "#fff", fontFamily: J.fontDisplay, fontSize: mobile ? 9 : 10, letterSpacing: 2, textTransform: "uppercase", flexShrink: 0 }}>{currentTopic}</span>
            </div>
          )}

          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", cursor: "crosshair", touchAction: "none" }}
              onMouseMove={handleMouseMove} onClick={handleClick} onWheel={handleWheel}
              onMouseDown={handleMouseDown} onMouseUp={() => { panRef.current.isPanning = false; }}
              onMouseLeave={() => { panRef.current.isPanning = false; setHoveredNode(null); }}
              onTouchStart={(e) => {
                const touch = e.touches[0]; const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const mx = touch.clientX - rect.left; const my = touch.clientY - rect.top;
                const node = getNodeAt(mx, my);
                if (node) { handleNodeClick(node); } else {
                  panRef.current.isPanning = true;
                  panRef.current.startX = mx - panRef.current.x;
                  panRef.current.startY = my - panRef.current.y;
                }
              }}
              onTouchMove={(e) => { if (panRef.current.isPanning && e.touches[0]) { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; panRef.current.x = (e.touches[0].clientX - rect.left) - panRef.current.startX; panRef.current.y = (e.touches[0].clientY - rect.top) - panRef.current.startY; } }}
              onTouchEnd={() => { panRef.current.isPanning = false; }}
            />

            {/* Connections Panel */}
            {showConnections && (
              <div style={{
                position: "absolute", top: 0, left: 0, bottom: 0,
                width: mobile ? "100%" : 380, maxWidth: mobile ? "100%" : 420,
                background: J.bgPanel, backdropFilter: "blur(30px)",
                borderRight: `1px solid ${J.magenta}25`,
                display: "flex", flexDirection: "column", zIndex: 35,
                boxShadow: `4px 0 40px rgba(0,0,0,0.6)`,
              }}>
                <ScanLine />
                <div style={{ padding: "16px 18px", borderBottom: `1px solid ${J.magenta}20`, flexShrink: 0, position: "relative" }}>
                  <HudCorner position="tl" color={J.magenta} />
                  <HudCorner position="tr" color={J.magenta} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 3, height: 16, background: J.magenta, boxShadow: `0 0 8px ${J.magenta}80` }} />
                      <span style={{ fontSize: 10, fontFamily: J.fontDisplay, color: J.magenta, textTransform: "uppercase", letterSpacing: 3, fontWeight: 600 }}>CROSS-MAP CONNECTIONS</span>
                    </div>
                    <button onClick={() => setShowConnections(false)} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 15, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  </div>
                  <p style={{ fontSize: 11, fontFamily: J.fontBody, color: J.textMid, lineHeight: 1.5, margin: 0 }}>
                    Analyze connections between topics across your saved maps.
                  </p>
                  <button onClick={analyzeConnections} disabled={isAnalyzing}
                    style={{ marginTop: 12, width: "100%", background: isAnalyzing ? `${J.magenta}08` : `${J.magenta}15`, border: `1px solid ${J.magenta}40`, borderRadius: 2, padding: "10px", fontSize: 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.magenta, cursor: isAnalyzing ? "wait" : "pointer", letterSpacing: 2, transition: "all 0.2s" }}>
                    {isAnalyzing ? "ANALYZING..." : "ANALYZE CONNECTIONS"}
                  </button>
                  <div style={{ marginTop: 8, fontSize: 9, fontFamily: J.fontMono, color: J.textDim, letterSpacing: 1 }}>
                    {savedMapCount} SAVED MAPS AVAILABLE
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, position: "relative", zIndex: 3 }}>
                  {connections.length === 0 && !isAnalyzing && (
                    <div style={{ padding: "30px 0", textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontFamily: J.fontDisplay, color: J.textDim, letterSpacing: 3, marginBottom: 8 }}>NO CONNECTIONS YET</div>
                      <div style={{ fontSize: 12, fontFamily: J.fontBody, color: J.textMid, lineHeight: 1.5 }}>Click ANALYZE to discover<br />cross-map topic links.</div>
                    </div>
                  )}
                  {isAnalyzing && (
                    <div style={{ padding: "30px 0", textAlign: "center" }}>
                      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 12 }}>
                        {[0,1,2].map(j => <div key={j} style={{ width: 6, height: 6, background: J.magenta, animation: `jarvisPulse 1.2s ease-in-out ${j*0.15}s infinite` }} />)}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: J.fontMono, color: J.textDim, letterSpacing: 1 }}>ANALYZING CROSS-MAP PATTERNS...</div>
                    </div>
                  )}
                  {connections.map((conn, i) => {
                    // Find topic names from current map or stack
                    const findTopicName = (mapIdTarget, nodeId) => {
                      if (mapId === mapIdTarget && mapData) {
                        for (const sub of mapData.subcategories) {
                          const t = sub.topics.find(t => t.id === nodeId);
                          if (t) return t.title;
                        }
                      }
                      for (const s of mapStack) {
                        if (s.mapId === mapIdTarget && s.mapData) {
                          for (const sub of s.mapData.subcategories) {
                            const t = sub.topics.find(t => t.id === nodeId);
                            if (t) return t.title;
                          }
                        }
                      }
                      return nodeId;
                    };
                    const findMapTopic = (mid) => {
                      if (mapId === mid) return currentTopic;
                      const s = mapStack.find(s => s.mapId === mid);
                      return s ? s.topic : "Unknown";
                    };
                    const srcName = findTopicName(conn.source_map_id, conn.source_node_id);
                    const tgtName = findTopicName(conn.target_map_id, conn.target_node_id);
                    const srcMap = findMapTopic(conn.source_map_id);
                    const tgtMap = findMapTopic(conn.target_map_id);
                    const isActive = selectedConnection && selectedConnection._connIndex === i;
                    return (
                      <div key={i} onClick={() => setSelectedConnection({ ...conn, srcName, tgtName, srcMap, tgtMap, _connIndex: i })}
                        style={{ background: isActive ? "rgba(255,0,110,0.08)" : "rgba(255,0,110,0.03)", border: `1px solid ${isActive ? J.magenta + "50" : J.magenta + "20"}`, padding: "12px 14px", position: "relative", cursor: "pointer", transition: "all 0.15s" }}>
                        <HudCorner position="tl" size={8} color={J.magenta} />
                        <HudCorner position="br" size={8} color={J.magenta} />
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontFamily: J.fontDisplay, fontWeight: 600, color: J.magenta }}>{srcName}</span>
                          <span style={{ fontSize: 9, fontFamily: J.fontMono, color: J.textDim }}>⟷</span>
                          <span style={{ fontSize: 10, fontFamily: J.fontDisplay, fontWeight: 600, color: J.magenta }}>{tgtName}</span>
                        </div>
                        <div style={{ fontSize: 9, fontFamily: J.fontMono, color: J.textDim, marginBottom: 6 }}>
                          {srcMap} ↔ {tgtMap}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: J.fontBody, color: J.textMid, lineHeight: 1.5 }}>
                          {conn.description}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 8, fontFamily: J.fontMono, color: isActive ? J.magenta : J.textDim, letterSpacing: 2 }}>{isActive ? "CHAT OPEN ▸" : "CLICK TO EXPLORE ▸"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isFullscreen && (
              <button onClick={() => setIsFullscreen(false)}
                style={{ position: "absolute", top: 16, left: 16, zIndex: 50, background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "8px 16px", fontSize: 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", letterSpacing: 2 }}>◁ EXIT</button>
            )}

            {!mobile && <>
              <div style={{ position: "absolute", top: 12, left: 12, width: 24, height: 24, borderTop: `1px solid ${J.cyan}30`, borderLeft: `1px solid ${J.cyan}30`, pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 12, right: selectedNode ? 420 : 12, width: 24, height: 24, borderTop: `1px solid ${J.cyan}30`, borderRight: `1px solid ${J.cyan}30`, pointerEvents: "none", transition: "right 0.3s" }} />
              <div style={{ position: "absolute", bottom: 12, left: 12, width: 24, height: 24, borderBottom: `1px solid ${J.cyan}30`, borderLeft: `1px solid ${J.cyan}30`, pointerEvents: "none" }} />
              <div style={{ position: "absolute", bottom: 12, right: selectedNode ? 420 : 12, width: 24, height: 24, borderBottom: `1px solid ${J.cyan}30`, borderRight: `1px solid ${J.cyan}30`, pointerEvents: "none", transition: "right 0.3s" }} />
            </>}

            {/* Tooltip */}
            {!mobile && hoveredNode && !selectedNode && (() => {
              const info = getTooltipInfo(hoveredNode);
              if (!info) return null;
              return (
                <div style={{ position: "fixed", left: tooltipPos.x, top: tooltipPos.y - 12, transform: "translate(-50%, -100%)", background: "rgba(3,8,15,0.95)", backdropFilter: "blur(16px)", border: `1px solid ${info.color}35`, padding: "12px 16px", zIndex: 50, pointerEvents: "none", maxWidth: 300, boxShadow: `0 8px 32px rgba(0,0,0,0.7)` }}>
                  <HudCorner position="tl" size={10} color={info.color} />
                  <HudCorner position="br" size={10} color={info.color} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 3, height: 10, background: info.color, boxShadow: `0 0 4px ${info.color}80` }} />
                    <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: info.color, textTransform: "uppercase", letterSpacing: 2, fontWeight: 600 }}>{info.hint}</span>
                  </div>
                  <div style={{ fontSize: 13, fontFamily: J.fontDisplay, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 4 }}>{info.title}</div>
                  {info.summary && <div style={{ fontSize: 11, fontFamily: J.fontBody, color: J.textMid, lineHeight: 1.4 }}>{info.summary}</div>}
                  {info.tags && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {info.tags.slice(0, 4).map(tag => (
                        <span key={tag} style={{ background: `${info.color}10`, border: `1px solid ${info.color}25`, padding: "1px 6px", fontSize: 9, fontFamily: J.fontMono, color: `${info.color}CC`, letterSpacing: 1, textTransform: "uppercase" }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Zoom controls */}
            {!(mobile && selectedNode) && (
            <div style={{ position: "absolute", bottom: 20, right: (!mobile && selectedNode) ? 420 : 20, zIndex: 45, display: "flex", flexDirection: "column", gap: 4, transition: "right 0.3s ease" }}>
              <button onClick={() => { panRef.current.scale = Math.min(3, panRef.current.scale * 1.25); }}
                style={{ width: mobile ? 40 : 36, height: mobile ? 40 : 36, borderRadius: 2, background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, color: J.cyan, fontSize: 18, cursor: "pointer", fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
              <button onClick={() => { panRef.current.scale = Math.max(0.3, panRef.current.scale * 0.8); }}
                style={{ width: mobile ? 40 : 36, height: mobile ? 40 : 36, borderRadius: 2, background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, color: J.cyan, fontSize: 18, cursor: "pointer", fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>-</button>
            </div>
            )}

            {selectedNode && selectedSub && mapData && !selectedConnection && (
              <ChatPanel
                node={selectedNode}
                subcategory={selectedSub}
                siblings={selectedSub.topics}
                mapTitle={mapData.title}
                nodeColor={selectedSub.color || J.cyan}
                onClose={() => setSelectedNode(null)}
                onNavigate={handleNavigate}
                chatCacheRef={chatCacheRef}
                mapId={mapId}
              />
            )}

            {/* Connection Chat — right side panel for exploring a cross-map connection */}
            {selectedConnection && <ConnectionChat conn={selectedConnection} onClose={() => setSelectedConnection(null)} mobile={mobile} />}

            {!selectedNode && !selectedConnection && (
              <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, padding: mobile ? "8px 14px" : "10px 24px", fontSize: mobile ? 9 : 10, fontFamily: J.fontMono, color: J.textDim, pointerEvents: "none", textAlign: "center", letterSpacing: mobile ? 1 : 2, whiteSpace: "nowrap" }}>
                {treeStateRef.current.phase === "idle" ? (mobile ? "TAP CENTER NODE TO BEGIN" : "CLICK CENTER NODE TO EXPAND \u00B7 SCROLL TO ZOOM") : (mobile ? "TAP NODES TO EXPLORE" : "CLICK NODES TO EXPLORE \u00B7 SCROLL TO ZOOM \u00B7 DRAG TO PAN")}
              </div>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes headerPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(1.4); } }
        @keyframes jarvisPulse { 0%,100% { opacity:0.2; transform:scale(0.6); } 50% { opacity:1; transform:scale(1.2); } }
        @keyframes micPulse { 0%,100% { box-shadow: 0 0 8px rgba(0,229,255,0.3); } 50% { box-shadow: 0 0 20px rgba(0,229,255,0.6); } }
        @keyframes voiceBar { 0% { height: 4px; } 100% { height: 16px; } }
        @keyframes spinRing { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes corePulse { 0%,100% { opacity:0.6; transform:scale(1); } 50% { opacity:1; transform:scale(1.5); } }
        @keyframes floatDot { from { transform: translateY(0); } to { transform: translateY(-15px); } }
      `}</style>
    </div>
  );
}
