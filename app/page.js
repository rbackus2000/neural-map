"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── PROMPTS ─────────────────────────────────────────────────────────────────

function buildGenerationPrompt(topic) {
  return `You are a knowledge graph architect. Generate a neural map of "${topic}".

Return ONLY valid JSON, no markdown, no backticks, no preamble:

{"title":"Short title","nodes":[{"id":1,"title":"2-4 words","category":"cat_key","summary":"1 concise sentence with specific facts","tags":["t1","t2","t3"],"significance":3}],"connections":[[1,2]],"categories":{"cat_key":{"label":"Label","color":"#hex"}}}

RULES:
- Generate 35-50 nodes. Keep titles SHORT (2-4 words max). Keep summaries to ONE sentence with specific facts/dates/names.
- 5-7 categories with vivid hex colors (no pastels/grays)
- significance 5 = foundational, 1 = minor detail
- 50-80 connections between related nodes
- Hub nodes (significance 4-5) get 5-8 connections each
- Tags: 2-3 short keywords per node
- Good topological spread across sub-topics
- CRITICAL: Keep total output compact. Short summaries. No filler words.

Return ONLY the JSON object.`;
}

function buildChatSystemPrompt(node, connectedNodes, allCategories, mapTitle) {
  const connContext = connectedNodes
    .map(c => `- "${c.title}" [${c.tags?.join(", ")}]: ${c.summary}`)
    .join("\n");

  return `You are an expert embedded in a Neural Knowledge Map about "${mapTitle}". The user clicked on a specific node and you have deep expertise on this topic and its connections.

CURRENT NODE: "${node.title}"
Category: ${allCategories[node.category]?.label || node.category}
Tags: ${node.tags?.join(", ")}
Summary: ${node.summary}

CONNECTED NODES:
${connContext || "None"}

INSTRUCTIONS:
- You are a world-class expert on this specific topic
- Reference specific facts, dates, names, and details — never be generic
- Draw connections between the current node and its connected nodes when relevant
- If asked to go deeper, provide genuinely expert-level detail
- Be concise and direct — no fluff
- Suggest exploring connected nodes when it enriches understanding
- You can reference broader context from the map's subject: "${mapTitle}"`;
}

// ─── API HELPER ──────────────────────────────────────────────────────────────

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function getConnectedNodes(nodeId, connections, nodes) {
  const ids = new Set();
  connections.forEach(([a, b]) => {
    if (a === nodeId) ids.add(b);
    if (b === nodeId) ids.add(a);
  });
  return nodes.filter(n => ids.has(n.id));
}

function computeConnectionCounts(connections) {
  const counts = {};
  connections.forEach(([a, b]) => {
    counts[a] = (counts[a] || 0) + 1;
    counts[b] = (counts[b] || 0) + 1;
  });
  return counts;
}

const HUB_PALETTE = ["#E84855","#F5A623","#4ECDC4","#A78BFA","#60A5FA","#34D399","#FF6B9D","#FFD93D","#FF8C42","#C77DFF"];
const REGULAR_COLOR = "#8BA8A0";

function assignHubColors(nodes, connCounts) {
  const map = {};
  let idx = 0;
  nodes
    .filter(n => (connCounts[n.id] || 0) >= 4)
    .sort((a, b) => (connCounts[b.id] || 0) - (connCounts[a.id] || 0))
    .forEach(n => {
      map[n.id] = HUB_PALETTE[idx % HUB_PALETTE.length];
      idx++;
    });
  return map;
}

// ─── SUGGESTED TOPICS ────────────────────────────────────────────────────────

const SUGGESTED_TOPICS = [
  { label: "World History", icon: "🌍" },
  { label: "Ancient Rome", icon: "🏛️" },
  { label: "Artificial Intelligence", icon: "🤖" },
  { label: "The Solar System", icon: "🪐" },
  { label: "Philosophy", icon: "🧠" },
  { label: "World War II", icon: "⚔️" },
  { label: "iOS Development", icon: "📱" },
  { label: "The Human Body", icon: "🫀" },
  { label: "Music Theory", icon: "🎵" },
  { label: "Quantum Physics", icon: "⚛️" },
  { label: "Cryptocurrency", icon: "₿" },
  { label: "Ancient Egypt", icon: "🔺" },
];

// ─── CHAT PANEL ──────────────────────────────────────────────────────────────

function ChatPanel({ node, mapData, onClose, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const connCounts = computeConnectionCounts(mapData.connections);
  const hubColors = assignHubColors(mapData.nodes, connCounts);
  const nodeColor = hubColors[node.id] || REGULAR_COLOR;
  const connected = getConnectedNodes(node.id, mapData.connections, mapData.nodes);
  const nc = connCounts[node.id] || 0;
  const isHub = nc >= 4;

  useEffect(() => {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }, [node.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: userMsg });

      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: buildChatSystemPrompt(node, connected, mapData.categories, mapData.title),
        messages: history,
      });

      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n")
        || "Sorry, couldn't generate a response.";
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
    "Tell me the most important thing about this",
    "How does this connect to the bigger picture?",
    "What's a surprising fact most people don't know?",
    "Go deeper — give me expert-level detail",
  ];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0,
      width: isExpanded ? "55%" : "380px",
      maxWidth: isExpanded ? "700px" : "420px",
      minWidth: "340px",
      background: "rgba(8,8,12,0.97)",
      backdropFilter: "blur(30px)",
      borderLeft: `1px solid ${nodeColor}20`,
      display: "flex", flexDirection: "column", zIndex: 30,
      transition: "width 0.3s ease, max-width 0.3s ease",
      boxShadow: `-20px 0 60px rgba(0,0,0,0.5)`,
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${nodeColor}20`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: nodeColor, boxShadow: `0 0 8px ${nodeColor}80` }} />
            <span style={{ fontSize: 9, color: nodeColor, textTransform: "uppercase", letterSpacing: 2, fontWeight: 600 }}>
              {mapData.categories[node.category]?.label || node.category}
              {isHub ? ` · ${nc} connections` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isExpanded ? "◂" : "▸"}
            </button>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>{node.title}</div>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.45)", margin: 0 }}>
          {node.summary?.slice(0, 160)}{node.summary?.length > 160 ? "…" : ""}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 8 }}>
          {node.tags?.map(tag => (
            <span key={tag} style={{ background: `${nodeColor}12`, border: `1px solid ${nodeColor}25`, borderRadius: 3, padding: "2px 7px", fontSize: 10, color: nodeColor }}>{tag}</span>
          ))}
        </div>
        {connected.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Synapses</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {connected.map(c => {
                const cColor = hubColors[c.id] || REGULAR_COLOR;
                return (
                  <button key={c.id} onClick={() => onNavigate(c.id)} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${cColor}30`, borderRadius: 3, padding: "2px 7px", fontSize: 8, color: cColor, cursor: "pointer", fontFamily: "inherit" }}>
                    {c.title.length > 22 ? c.title.slice(0, 20) + "…" : c.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 12, textAlign: "center" }}>Ask anything about this topic</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {quickPrompts.map((q, i) => (
                <button key={i} onClick={() => setInput(q)}
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "all 0.15s" }}
                  onMouseEnter={e => { e.target.style.background = `${nodeColor}10`; e.target.style.borderColor = `${nodeColor}30`; e.target.style.color = nodeColor; }}
                  onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.03)"; e.target.style.borderColor = "rgba(255,255,255,0.06)"; e.target.style.color = "rgba(255,255,255,0.5)"; }}
                >{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
            {msg.role === "assistant" && <div style={{ fontSize: 8, color: nodeColor, marginBottom: 3, textTransform: "uppercase", letterSpacing: 1.5 }}>Neural Map</div>}
            <div style={{
              background: msg.role === "user" ? `${nodeColor}20` : "rgba(255,255,255,0.04)",
              border: `1px solid ${msg.role === "user" ? `${nodeColor}35` : "rgba(255,255,255,0.06)"}`,
              borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              padding: "10px 14px", fontSize: 13, lineHeight: 1.65,
              color: msg.role === "user" ? "#fff" : "rgba(255,255,255,0.8)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
            <div style={{ fontSize: 8, color: nodeColor, marginBottom: 3, textTransform: "uppercase", letterSpacing: 1.5 }}>Neural Map</div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px 12px 12px 4px", padding: "12px 16px", display: "flex", gap: 5 }}>
              {[0,1,2].map(j => <div key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: nodeColor, animation: `dotPulse 1.2s ease-in-out ${j*0.2}s infinite` }} />)}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "4px 4px 4px 14px" }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={`Ask about ${node.title.toLowerCase()}…`} rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: "#fff", fontSize: 12, fontFamily: "inherit", resize: "none", outline: "none", padding: "8px 0", maxHeight: 80, lineHeight: 1.5 }}
          />
          <button onClick={sendMessage} disabled={isLoading || !input.trim()}
            style={{ background: input.trim() ? nodeColor : "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, width: 36, height: 36, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(255,255,255,0.2)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LOADING SCREEN ──────────────────────────────────────────────────────────

function LoadingScreen({ topic }) {
  const [dots, setDots] = useState("");
  const [phase, setPhase] = useState(0);
  const phases = [
    "Mapping knowledge topology",
    "Identifying hub concepts",
    "Weaving neural connections",
    "Calibrating node significance",
    "Rendering synaptic pathways",
  ];

  useEffect(() => {
    const i1 = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    const i2 = setInterval(() => setPhase(p => (p + 1) % phases.length), 2800);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, []);

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "#050508", zIndex: 100,
    }}>
      <div style={{ position: "relative", width: 120, height: 120, marginBottom: 40 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            position: "absolute", inset: i * 12,
            border: `1px solid rgba(139,168,160,${0.15 - i * 0.04})`,
            borderRadius: "50%",
            animation: `spinRing ${3 + i}s linear infinite${i % 2 ? " reverse" : ""}`,
          }}>
            <div style={{
              position: "absolute", top: -3, left: "50%", width: 6, height: 6,
              borderRadius: "50%", background: HUB_PALETTE[i],
              boxShadow: `0 0 10px ${HUB_PALETTE[i]}80`,
            }} />
          </div>
        ))}
        <div style={{
          position: "absolute", inset: 40,
          background: "rgba(139,168,160,0.08)",
          borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: REGULAR_COLOR, boxShadow: `0 0 20px ${REGULAR_COLOR}60`, animation: "corePulse 1.5s ease-in-out infinite" }} />
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#c8a96e", letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 }}>Neural Map</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 24, textAlign: "center", padding: "0 20px" }}>{topic}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", minWidth: 260, textAlign: "center" }}>{phases[phase]}{dots}</div>
    </div>
  );
}

// ─── LANDING SCREEN ──────────────────────────────────────────────────────────

function LandingScreen({ onGenerate }) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = () => {
    if (input.trim()) onGenerate(input.trim());
  };

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "#050508", padding: 20,
    }}>
      {/* Background dots */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: 0.15 }}>
        {Array.from({ length: 60 }, (_, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${seededRandom(i * 7) * 100}%`,
            top: `${seededRandom(i * 13 + 3) * 100}%`,
            width: seededRandom(i * 19) > 0.85 ? 6 : 3,
            height: seededRandom(i * 19) > 0.85 ? 6 : 3,
            borderRadius: "50%",
            background: seededRandom(i * 19) > 0.85 ? HUB_PALETTE[i % HUB_PALETTE.length] : REGULAR_COLOR,
            animation: `floatDot ${4 + seededRandom(i * 31) * 6}s ease-in-out ${seededRandom(i * 41) * 3}s infinite alternate`,
          }} />
        ))}
      </div>

      <div style={{ position: "relative", zIndex: 2, textAlign: "center", maxWidth: 600 }}>
        <div style={{ fontSize: 11, color: "#c8a96e", letterSpacing: 4, textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>Neural Map</div>
        <h1 style={{ fontSize: 28, fontWeight: 300, color: "#fff", margin: "0 0 8px", lineHeight: 1.2, letterSpacing: -0.5 }}>
          Map any subject as a<br /><span style={{ fontWeight: 600, color: REGULAR_COLOR }}>living knowledge graph</span>
        </h1>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "0 0 32px", lineHeight: 1.6 }}>
          Enter any topic and watch AI knowledge unfold into an interactive neural network you can explore and chat with.
        </p>

        <div style={{
          display: "flex", gap: 8, marginBottom: 32,
          background: isFocused ? "rgba(139,168,160,0.06)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${isFocused ? "rgba(139,168,160,0.3)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 14, padding: "4px 4px 4px 18px",
          transition: "all 0.3s",
        }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)}
            onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="Enter any topic…"
            style={{ flex: 1, background: "transparent", border: "none", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none", padding: "12px 0" }}
          />
          <button onClick={handleSubmit} disabled={!input.trim()}
            style={{
              background: input.trim() ? REGULAR_COLOR : "rgba(255,255,255,0.06)",
              border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 12, fontWeight: 600,
              color: input.trim() ? "#050508" : "rgba(255,255,255,0.2)",
              cursor: input.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.2s", letterSpacing: 1,
            }}
          >GENERATE</button>
        </div>

        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Or explore</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {SUGGESTED_TOPICS.map(t => (
            <button key={t.label} onClick={() => onGenerate(t.label)}
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "8px 14px", fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6 }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,168,160,0.1)"; e.currentTarget.style.borderColor = "rgba(139,168,160,0.25)"; e.currentTarget.style.color = REGULAR_COLOR; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────

export default function NeuralMapApp() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [appState, setAppState] = useState("landing");
  const [mapData, setMapData] = useState(null);
  const [currentTopic, setCurrentTopic] = useState("");
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [activeFilter, setActiveFilter] = useState(null);
  const [dimensions, setDimensions] = useState({ w: 900, h: 700 });
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const animFrameRef = useRef(null);
  const nodesRef = useRef([]);
  const panRef = useRef({ x: 0, y: 0, startX: 0, startY: 0, isPanning: false, scale: 1 });
  const timeRef = useRef(0);

  // Generate map
  const generateMap = async (topic) => {
    setCurrentTopic(topic);
    setAppState("loading");
    setError(null);
    setSelectedNode(null);
    panRef.current = { x: 0, y: 0, startX: 0, startY: 0, isPanning: false, scale: 1 };

    try {
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{ role: "user", content: buildGenerationPrompt(topic) }],
      });

      const text = data.content?.find(b => b.type === "text")?.text || "";
      let clean = text.replace(/```json|```/g, "").trim();

      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch (e) {
        const lastGoodBrace = clean.lastIndexOf("}");
        if (lastGoodBrace > 0) {
          let repaired = clean.substring(0, lastGoodBrace + 1);
          const opens = (repaired.match(/\[/g) || []).length;
          const closes = (repaired.match(/\]/g) || []).length;
          const openBraces = (repaired.match(/\{/g) || []).length;
          const closeBraces = (repaired.match(/\}/g) || []).length;
          for (let i = 0; i < opens - closes; i++) repaired += "]";
          for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
          try { parsed = JSON.parse(repaired); } catch (e2) {
            throw new Error("Could not parse response — try a more specific topic");
          }
        }
        if (!parsed) throw new Error("Could not parse response — try a more specific topic");
      }

      if (!parsed.nodes || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
        throw new Error("No nodes generated — try again");
      }
      if (!parsed.connections) parsed.connections = [];
      if (!parsed.categories) parsed.categories = { general: { label: "General", color: "#8BA8A0" } };

      const validIds = new Set(parsed.nodes.map(n => n.id));
      parsed.connections = parsed.connections.filter(([a, b]) => validIds.has(a) && validIds.has(b));

      setMapData(parsed);
      setAppState("map");
    } catch (err) {
      setError(`Failed to generate map: ${err.message}`);
      setAppState("landing");
    }
  };

  // Layout nodes
  useEffect(() => {
    if (!mapData || appState !== "map") return;
    const w = dimensions.w;
    const h = dimensions.h;
    const cx = w / 2;
    const cy = h / 2;

    const initNodes = mapData.nodes.map((node, i) => {
      const angle = seededRandom(i * 137.5) * Math.PI * 2;
      const sig = node.significance || 3;
      const radius = (sig >= 4 ? 60 : 120) + seededRandom(i * 73 + 11) * Math.min(w, h) * 0.42;
      return { ...node, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, pulsePhase: seededRandom(i * 42) * Math.PI * 2 };
    });

    for (let iter = 0; iter < 300; iter++) {
      for (let i = 0; i < initNodes.length; i++) {
        for (let j = i + 1; j < initNodes.length; j++) {
          const dx = initNodes[j].x - initNodes[i].x;
          const dy = initNodes[j].y - initNodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 80) {
            const force = (80 - dist) / dist * 0.5;
            initNodes[i].x -= dx * force; initNodes[i].y -= dy * force;
            initNodes[j].x += dx * force; initNodes[j].y += dy * force;
          }
        }
        initNodes[i].x += (cx - initNodes[i].x) * 0.002;
        initNodes[i].y += (cy - initNodes[i].y) * 0.002;
        initNodes[i].x = Math.max(50, Math.min(w - 50, initNodes[i].x));
        initNodes[i].y = Math.max(50, Math.min(h - 50, initNodes[i].y));
      }
      mapData.connections.forEach(([aId, bId]) => {
        const na = initNodes.find(n => n.id === aId);
        const nb = initNodes.find(n => n.id === bId);
        if (na && nb) {
          const dx = nb.x - na.x;
          const dy = nb.y - na.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 140) / dist * 0.01;
          na.x += dx * force; na.y += dy * force;
          nb.x -= dx * force; nb.y -= dy * force;
        }
      });
    }
    nodesRef.current = initNodes;
  }, [mapData, dimensions, appState]);

  // Canvas render
  useEffect(() => {
    if (appState !== "map" || !mapData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const connCounts = computeConnectionCounts(mapData.connections);
    const hubColors = assignHubColors(mapData.nodes, connCounts);

    const render = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const pan = panRef.current;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = dimensions.w * dpr;
      canvas.height = dimensions.h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#050508";
      ctx.fillRect(0, 0, dimensions.w, dimensions.h);
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(pan.scale, pan.scale);

      const currentNodes = nodesRef.current;
      const isFiltered = activeFilter !== null;
      const selId = selectedNode?.id;
      const connectedToSel = new Set();
      if (selId) mapData.connections.forEach(([a, b]) => { if (a === selId) connectedToSel.add(b); if (b === selId) connectedToSel.add(a); });

      currentNodes.forEach(n => {
        n.x += Math.sin(t * 0.4 + n.pulsePhase) * 0.1;
        n.y += Math.cos(t * 0.25 + n.pulsePhase * 1.3) * 0.07;
      });

      // Connections
      mapData.connections.forEach(([aId, bId]) => {
        const a = currentNodes.find(n => n.id === aId);
        const b = currentNodes.find(n => n.id === bId);
        if (!a || !b) return;
        const dimA = isFiltered && activeFilter !== a.category;
        const dimB = isFiltered && activeFilter !== b.category;
        if (dimA && dimB) return;
        const isSel = selId && (selId === aId || selId === bId);
        const isHov = hoveredNode && (hoveredNode.id === aId || hoveredNode.id === bId);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        if (isSel) { ctx.strokeStyle = (hubColors[selId] || REGULAR_COLOR) + "50"; ctx.lineWidth = 1.8; }
        else if (isHov) { ctx.strokeStyle = "rgba(139,168,160,0.25)"; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = (dimA || dimB) ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.05)"; ctx.lineWidth = 0.4; }
        ctx.stroke();
      });

      // Pulses
      if (!isFiltered) {
        mapData.connections.forEach(([aId, bId], ci) => {
          const a = currentNodes.find(n => n.id === aId);
          const b = currentNodes.find(n => n.id === bId);
          if (!a || !b) return;
          const progress = (t * 0.2 + ci * 0.5) % 4;
          if (progress > 1) return;
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(139,168,160,0.3)";
          ctx.fill();
        });
      }

      // Nodes
      currentNodes.forEach(node => {
        const isDimmed = isFiltered && activeFilter !== node.category;
        const isHov = hoveredNode && hoveredNode.id === node.id;
        const isSel = selId === node.id;
        const isConnSel = connectedToSel.has(node.id);
        const nc = connCounts[node.id] || 0;
        const isHub = nc >= 4;
        const nodeColor = hubColors[node.id] || REGULAR_COLOR;
        const pulse = 1 + Math.sin(t * 2 + node.pulsePhase) * 0.06;
        const baseR = isHub ? 7 + nc * 1.2 : 5;
        const r = baseR * pulse;

        if (isDimmed && !isSel && !isConnSel) {
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.025)"; ctx.fill(); return;
        }

        if (isSel || isConnSel) {
          const glowR = isSel ? r * 4.5 : r * 2.5;
          const gradient = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, glowR);
          gradient.addColorStop(0, nodeColor + (isSel ? "50" : "20"));
          gradient.addColorStop(1, nodeColor + "00");
          ctx.beginPath(); ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = gradient; ctx.fill();
        } else if (isHov) {
          const gradient = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r * 3.5);
          gradient.addColorStop(0, nodeColor + "40"); gradient.addColorStop(1, nodeColor + "00");
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = gradient; ctx.fill();
        }

        if (isHub) {
          const outerGrad = ctx.createRadialGradient(node.x, node.y, r * 0.6, node.x, node.y, r * 2);
          outerGrad.addColorStop(0, nodeColor + "28"); outerGrad.addColorStop(1, nodeColor + "00");
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 2, 0, Math.PI * 2);
          ctx.fillStyle = outerGrad; ctx.fill();
        }

        const grad = ctx.createRadialGradient(node.x - r * 0.15, node.y - r * 0.15, 0, node.x, node.y, r);
        grad.addColorStop(0, isHub ? nodeColor : "#B0C9C2");
        grad.addColorStop(1, nodeColor + (isHub ? "CC" : "88"));
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();

        if (isSel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke(); }
        else if (isHov) { ctx.strokeStyle = isHub ? nodeColor : "#d0e8e0"; ctx.lineWidth = 1.5; ctx.stroke(); }
        else if (isConnSel) { ctx.strokeStyle = nodeColor + "80"; ctx.lineWidth = 1; ctx.stroke(); }
      });

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [dimensions, hoveredNode, selectedNode, activeFilter, mapData, appState]);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) setDimensions({ w: containerRef.current.clientWidth, h: Math.max(500, containerRef.current.clientHeight) });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const getNodeAt = useCallback((mx, my) => {
    const pan = panRef.current;
    const x = (mx - pan.x) / pan.scale;
    const y = (my - pan.y) / pan.scale;
    let closest = null;
    let closestDist = Infinity;
    const hitRadius = 24 / pan.scale;
    for (let i = 0; i < nodesRef.current.length; i++) {
      const n = nodesRef.current[i];
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
    if (panRef.current.isPanning) {
      panRef.current.x = mx - panRef.current.startX;
      panRef.current.y = my - panRef.current.startY;
      return;
    }
    const node = getNodeAt(mx, my);
    setHoveredNode(node);
    if (node) setTooltipPos({ x: e.clientX, y: e.clientY });
    if (canvasRef.current) canvasRef.current.style.cursor = node ? "pointer" : "grab";
  };

  const handleClick = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (node) setSelectedNode(node);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    panRef.current.scale = Math.max(0.3, Math.min(3, panRef.current.scale * (e.deltaY > 0 ? 0.92 : 1.08)));
  };

  const handleMouseDown = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (!getNodeAt(mx, my)) {
      panRef.current.isPanning = true;
      panRef.current.startX = mx - panRef.current.x;
      panRef.current.startY = my - panRef.current.y;
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    }
  };

  const handleNavigate = (id) => {
    const node = nodesRef.current.find(n => n.id === id) || mapData?.nodes.find(n => n.id === id);
    if (node) setSelectedNode(node);
  };

  const getTooltipColor = (node) => {
    if (!mapData) return REGULAR_COLOR;
    const cc = computeConnectionCounts(mapData.connections);
    const hc = assignHubColors(mapData.nodes, cc);
    return hc[node.id] || REGULAR_COLOR;
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100vh", background: "#050508", fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", color: "#e0e0e0", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      {appState === "landing" && (
        <>
          <LandingScreen onGenerate={generateMap} />
          {error && (
            <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(232,72,85,0.15)", border: "1px solid rgba(232,72,85,0.3)", borderRadius: 10, padding: "10px 20px", fontSize: 11, color: "#E84855", zIndex: 200 }}>{error}</div>
          )}
        </>
      )}

      {appState === "loading" && <LoadingScreen topic={currentTopic} />}

      {appState === "map" && mapData && (
        <>
          {/* Header */}
          {!isFullscreen && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(139,168,160,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 40, background: "rgba(5,5,8,0.95)", backdropFilter: "blur(10px)", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => { setAppState("landing"); setMapData(null); setSelectedNode(null); }}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "6px 12px", fontSize: 11, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", minHeight: 32 }}>← New Map</button>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: REGULAR_COLOR, boxShadow: `0 0 10px ${REGULAR_COLOR}60`, animation: "headerPulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: REGULAR_COLOR, letterSpacing: 2, textTransform: "uppercase" }}>{mapData.title || currentTopic}</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{mapData.nodes.length} nodes · {mapData.connections.length} synapses</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {Object.entries(mapData.categories).map(([key, { color, label }]) => (
                <button key={key} onClick={() => setActiveFilter(activeFilter === key ? null : key)}
                  style={{ background: activeFilter === key ? color + "25" : "rgba(255,255,255,0.03)", border: `1px solid ${activeFilter === key ? color + "60" : "rgba(255,255,255,0.06)"}`, borderRadius: 20, padding: "6px 14px", fontSize: 11, minHeight: 32, color: activeFilter === key ? color : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: color, marginRight: 5, verticalAlign: "middle" }} />{label}
                </button>
              ))}
              <button onClick={() => setIsFullscreen(true)}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "6px 12px", fontSize: 11, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", minHeight: 32, transition: "all 0.2s" }}>⛶ Fullscreen</button>
            </div>
          </div>
          )}

          {/* Canvas */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", cursor: "grab" }}
              onMouseMove={handleMouseMove} onClick={handleClick} onWheel={handleWheel}
              onMouseDown={handleMouseDown} onMouseUp={() => { panRef.current.isPanning = false; }}
              onMouseLeave={() => { panRef.current.isPanning = false; setHoveredNode(null); }}
            />

            {/* Fullscreen exit */}
            {isFullscreen && (
              <button onClick={() => setIsFullscreen(false)}
                style={{ position: "absolute", top: 16, left: 16, zIndex: 50, background: "rgba(5,5,8,0.85)", backdropFilter: "blur(10px)", border: "1px solid rgba(139,168,160,0.2)", borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>← Exit Fullscreen</button>
            )}

            {/* Tooltip */}
            {hoveredNode && !selectedNode && (() => {
              const ttColor = getTooltipColor(hoveredNode);
              const cc = computeConnectionCounts(mapData.connections);
              const ttConns = cc[hoveredNode.id] || 0;
              const ttIsHub = ttConns >= 4;
              return (
                <div style={{ position: "fixed", left: tooltipPos.x, top: tooltipPos.y - 12, transform: "translate(-50%, -100%)", background: "rgba(12,12,18,0.95)", backdropFilter: "blur(16px)", border: `1px solid ${ttColor}40`, borderRadius: 10, padding: "10px 14px", zIndex: 50, pointerEvents: "none", maxWidth: 280, boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${ttColor}15` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: ttColor, boxShadow: `0 0 6px ${ttColor}80` }} />
                    <span style={{ fontSize: 8, color: ttColor, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>
                      {mapData.categories[hoveredNode.category]?.label || hoveredNode.category}{ttIsHub ? ` · ${ttConns} connections` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 5 }}>{hoveredNode.title}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {hoveredNode.tags?.slice(0, 4).map(tag => (
                      <span key={tag} style={{ background: `${ttColor}12`, border: `1px solid ${ttColor}20`, borderRadius: 3, padding: "1px 5px", fontSize: 8, color: `${ttColor}CC` }}>{tag}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: 0.5 }}>Click to explore</div>
                </div>
              );
            })()}

            {selectedNode && mapData && <ChatPanel node={selectedNode} mapData={mapData} onClose={() => setSelectedNode(null)} onNavigate={handleNavigate} />}

            {!selectedNode && (
              <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(10,10,15,0.85)", backdropFilter: "blur(10px)", border: "1px solid rgba(139,168,160,0.12)", borderRadius: 10, padding: "10px 20px", fontSize: 10, color: "rgba(255,255,255,0.35)", pointerEvents: "none", textAlign: "center" }}>
                Click any node to explore · Scroll to zoom · Drag to pan
              </div>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes headerPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(1.4); } }
        @keyframes dotPulse { 0%,100% { opacity:0.3; transform:scale(0.8); } 50% { opacity:1; transform:scale(1.2); } }
        @keyframes spinRing { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes corePulse { 0%,100% { opacity:0.6; transform:scale(1); } 50% { opacity:1; transform:scale(1.5); } }
        @keyframes floatDot { from { transform: translateY(0); } to { transform: translateY(-15px); } }
      `}</style>
    </div>
  );
}
