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

// ─── PROMPTS ────────────────────────────────────────────────────────────────

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
- You can reference broader context from the map's subject: "${mapTitle}"
- CRITICAL RULE: Your final sentence MUST be a direct question to the user. Not a rhetorical question, not a cliffhanger — a real question directed at them that they can answer. Examples: "Want me to tell you about the three targets they missed?" or "Should I explain how that connects to the Cold War?" or "What part of this interests you most — the politics or the technology?" Always phrase it as if you're asking them directly what to explore next.`;
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

// ─── HELPERS ────────────────────────────────────────────────────────────────

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

// ─── CHAT PANEL ─────────────────────────────────────────────────────────────

function ChatPanel({ node, mapData, onClose, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);

  const connCounts = computeConnectionCounts(mapData.connections);
  const hubColors = assignHubColors(mapData.nodes, connCounts);
  const nodeColor = hubColors[node.id] || REGULAR_COLOR;
  const connected = getConnectedNodes(node.id, mapData.connections, mapData.nodes);
  const nc = connCounts[node.id] || 0;
  const isHub = nc >= 4;

  useEffect(() => {
    setMessages([]);
    setInput("");
    stopSpeaking();
    setVoiceMode(false);
    voiceModeRef.current = false;
    inputRef.current?.focus();
  }, [node.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── SPEECH SYNTHESIS (ElevenLabs streaming) ────────────────────────────
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);

  const speakText = useCallback(async (text) => {
    // Stop any current playback
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) { setIsSpeaking(false); return; }

      const mediaSource = await res.blob();
      const url = URL.createObjectURL(mediaSource);
      audioUrlRef.current = url;

      const audio = new Audio();
      audioRef.current = audio;

      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
        audioRef.current = null;
      };

      audio.src = url;
      audio.play().catch(() => setIsSpeaking(false));
    } catch {
      setIsSpeaking(false);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    setIsSpeaking(false);
  }, []);

  // ─── SPEECH RECOGNITION (user speaks) ──────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setInput("Voice not supported in this browser"); return; }

    stopSpeaking();
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join("");
      setInput(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      // In continuous mode, browser may stop on its own — just update state
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setVoiceMode(true);
    voiceModeRef.current = true;
  }, []);

  // ─── SEND MESSAGE ─────────────────────────────────────────────────────────
  const sendMessage = async (overrideText) => {
    const msgText = overrideText || input.trim();
    if (!msgText || isLoading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msgText }]);
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: msgText });

      const isVoice = voiceModeRef.current;
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: isVoice ? 500 : 1000,
        system: buildChatSystemPrompt(node, connected, mapData.categories, mapData.title)
          + (isVoice ? "\n- This is a VOICE conversation. Keep your answer to 2-3 sentences max. Your LAST sentence MUST be a direct question asking the user what they want to explore next. Not rhetorical — a real question they answer. Like: 'Want me to dive into how that changed everything?' or 'Should I tell you the surprising part about what happened next?'" : ""),
        messages: history,
      });

      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n")
        || "Sorry, couldn't generate a response.";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);

      // If in voice mode, JARVIS speaks the response
      if (isVoice) {
        speakText(text);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setIsLoading(false);
  };

  // Auto-send when user clicks mic to stop — voiceMode becomes true and isListening becomes false
  const prevListeningRef = useRef(false);
  useEffect(() => {
    // Detect transition from listening → not listening while in voice mode
    if (prevListeningRef.current && !isListening && voiceMode && input.trim()) {
      const timer = setTimeout(() => sendMessage(input.trim()), 200);
      return () => clearTimeout(timer);
    }
    prevListeningRef.current = isListening;
  }, [isListening, voiceMode]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setVoiceMode(false); voiceModeRef.current = false; sendMessage(); }
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
      width: isExpanded ? "55%" : "400px",
      maxWidth: isExpanded ? "720px" : "440px",
      minWidth: "360px",
      background: J.bgPanel,
      backdropFilter: "blur(30px)",
      borderLeft: `1px solid ${nodeColor}25`,
      display: "flex", flexDirection: "column", zIndex: 30,
      transition: "width 0.3s ease, max-width 0.3s ease",
      boxShadow: `-4px 0 40px rgba(0,0,0,0.6), -1px 0 0 ${nodeColor}15`,
    }}>
      <ScanLine />

      {/* Header */}
      <div style={{ padding: "16px 18px", borderBottom: `1px solid ${nodeColor}20`, flexShrink: 0, position: "relative" }}>
        <HudCorner position="tl" color={nodeColor} />
        <HudCorner position="tr" color={nodeColor} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 16, background: nodeColor, boxShadow: `0 0 8px ${nodeColor}80` }} />
            <span style={{ fontSize: 10, fontFamily: J.fontDisplay, color: nodeColor, textTransform: "uppercase", letterSpacing: 3, fontWeight: 600 }}>
              {mapData.categories[node.category]?.label || node.category}
              {isHub ? ` // ${nc} LINKS` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 11, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
              {isExpanded ? "◁" : "▷"}
            </button>
            <button onClick={onClose} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 15, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>×</button>
          </div>
        </div>
        <div style={{ fontSize: 17, fontFamily: J.fontDisplay, fontWeight: 600, color: "#fff", marginBottom: 8, lineHeight: 1.3, letterSpacing: 0.5 }}>{node.title}</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, color: J.textMid, margin: 0, fontFamily: J.fontBody }}>
          {node.summary?.slice(0, 180)}{node.summary?.length > 180 ? "..." : ""}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
          {node.tags?.map(tag => (
            <span key={tag} style={{ background: `${nodeColor}10`, border: `1px solid ${nodeColor}30`, borderRadius: 1, padding: "2px 8px", fontSize: 10, fontFamily: J.fontMono, color: nodeColor, textTransform: "uppercase", letterSpacing: 1 }}>{tag}</span>
          ))}
        </div>
        {connected.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.textDim, textTransform: "uppercase", letterSpacing: 3, marginBottom: 6 }}>LINKED NODES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {connected.map(c => {
                const cColor = hubColors[c.id] || REGULAR_COLOR;
                return (
                  <button key={c.id} onClick={() => onNavigate(c.id)} style={{ background: "rgba(0,229,255,0.03)", border: `1px solid ${cColor}30`, borderRadius: 1, padding: "3px 8px", fontSize: 9, fontFamily: J.fontBody, fontWeight: 500, color: cColor, cursor: "pointer", transition: "all 0.15s", letterSpacing: 0.5 }}>
                    {c.title.length > 22 ? c.title.slice(0, 20) + "..." : c.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
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
              borderRadius: 2,
              padding: "11px 15px", fontSize: 13, lineHeight: 1.7,
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

      {/* Speaking indicator */}
      {isSpeaking && (
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${nodeColor}20`, display: "flex", alignItems: "center", gap: 8, background: `${nodeColor}08` }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ width: 3, height: 8 + Math.sin(i * 1.2) * 6, background: nodeColor, animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`, borderRadius: 1 }} />
            ))}
          </div>
          <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: nodeColor, letterSpacing: 3, textTransform: "uppercase" }}>N.MAP // SPEAKING</span>
          <button onClick={stopSpeaking} style={{ marginLeft: "auto", background: "rgba(255,0,110,0.1)", border: `1px solid rgba(255,0,110,0.3)`, borderRadius: 2, padding: "3px 10px", fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, cursor: "pointer", letterSpacing: 2 }}>STOP</button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "14px 18px", borderTop: `1px solid ${J.border}`, flexShrink: 0, position: "relative" }}>
        <HudCorner position="bl" color={nodeColor} />
        <HudCorner position="br" color={nodeColor} />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(0,229,255,0.03)", border: `1px solid ${isListening ? nodeColor + "50" : J.border}`, borderRadius: 2, padding: "4px 4px 4px 14px", transition: "all 0.3s", boxShadow: isListening ? `0 0 20px ${nodeColor}15, inset 0 0 15px ${nodeColor}05` : "none" }}>
          <textarea ref={inputRef} value={input} onChange={e => { setInput(e.target.value); setVoiceMode(false); voiceModeRef.current = false; }} onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : `Query: ${node.title.toLowerCase()}...`} rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: isListening ? nodeColor : "#e0f0ff", fontSize: 13, fontFamily: J.fontBody, fontWeight: 500, resize: "none", outline: "none", padding: "8px 0", maxHeight: 80, lineHeight: 1.5, transition: "color 0.2s" }}
          />
          {/* Mic button */}
          <button onClick={isListening ? stopListening : startListening} disabled={isLoading}
            style={{ background: isListening ? nodeColor : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0, boxShadow: isListening ? `0 0 16px ${nodeColor}50` : "none", animation: isListening ? "micPulse 1.5s ease-in-out infinite" : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isListening ? "#000" : "rgba(0,229,255,0.5)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="1" width="6" height="12" rx="3" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          {/* Send button */}
          <button onClick={() => { setVoiceMode(false); voiceModeRef.current = false; sendMessage(); }} disabled={isLoading || !input.trim()}
            style={{ background: input.trim() ? nodeColor : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0, boxShadow: input.trim() ? `0 0 12px ${nodeColor}40` : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(0,229,255,0.2)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        {/* Voice mode indicator */}
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

// ─── LOADING SCREEN ─────────────────────────────────────────────────────────

function LoadingScreen({ topic }) {
  const [dots, setDots] = useState("");
  const [phase, setPhase] = useState(0);
  const phases = [
    "INITIALIZING KNOWLEDGE MATRIX",
    "MAPPING NEURAL TOPOLOGY",
    "IDENTIFYING HUB NODES",
    "CALIBRATING SYNAPTIC WEIGHTS",
    "RENDERING INTERFACE",
  ];

  useEffect(() => {
    const i1 = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    const i2 = setInterval(() => setPhase(p => (p + 1) % phases.length), 2800);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, []);

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: J.bg, zIndex: 100,
    }}>
      <HexGrid />
      <ScanLine />

      {/* Spinning rings — arc reactor style */}
      <div style={{ position: "relative", width: 160, height: 160, marginBottom: 48 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            position: "absolute", inset: i * 14,
            border: `1px solid rgba(0,229,255,${0.25 - i * 0.05})`,
            borderTop: `1px solid ${J.cyan}`,
            borderRadius: "50%",
            animation: `spinRing ${2.5 + i * 0.8}s linear infinite${i % 2 ? " reverse" : ""}`,
          }}>
            <div style={{
              position: "absolute", top: -2, left: "50%", width: 4, height: 4,
              background: HUB_PALETTE[i], boxShadow: `0 0 8px ${HUB_PALETTE[i]}`,
            }} />
          </div>
        ))}
        <div style={{
          position: "absolute", inset: 60,
          background: "rgba(0,229,255,0.05)",
          borderRadius: "50%", border: `1px solid ${J.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 12, height: 12, background: J.cyan, boxShadow: `0 0 24px ${J.cyan}, 0 0 48px ${J.cyanGlow}`, animation: "corePulse 1.5s ease-in-out infinite" }} />
        </div>
      </div>

      <div style={{ fontSize: 14, fontFamily: J.fontDisplay, fontWeight: 700, color: J.cyan, letterSpacing: 6, textTransform: "uppercase", marginBottom: 8, textShadow: `0 0 20px ${J.cyanGlow}` }}>NEURAL MAP</div>
      <div style={{ fontSize: 22, fontFamily: J.fontDisplay, fontWeight: 600, color: "#fff", marginBottom: 28, textAlign: "center", padding: "0 20px", letterSpacing: 1 }}>{topic}</div>
      <div style={{ fontSize: 11, fontFamily: J.fontMono, color: J.textDim, minWidth: 300, textAlign: "center", letterSpacing: 2 }}>{phases[phase]}{dots}</div>

      {/* Bottom data stream decoration */}
      <div style={{ position: "absolute", bottom: 30, display: "flex", gap: 20, opacity: 0.25 }}>
        {["SYS:NOMINAL", "NET:ACTIVE", "AI:ONLINE", "MEM:OK"].map((s, i) => (
          <span key={i} style={{ fontSize: 9, fontFamily: J.fontMono, color: J.cyan, letterSpacing: 2 }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

// ─── LANDING SCREEN ─────────────────────────────────────────────────────────

function JarvisChat({ onClose }) {
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
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio();
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioUrlRef.current = null; audioRef.current = null; };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioUrlRef.current = null; audioRef.current = null; };
      audio.src = url;
      audio.play().catch(() => {});
    } catch {}
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    setIsSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    stopSpeaking();
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onstart = () => setIsListening(true);
    r.onresult = (e) => { setInput(Array.from(e.results).map(r => r[0].transcript).join("")); };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    setIsListening(false);
    voiceModeRef.current = true;
  }, []);

  const sendMessage = async (overrideText) => {
    const msgText = overrideText || input.trim();
    if (!msgText || isLoading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msgText }]);
    setIsLoading(true);
    const isVoice = voiceModeRef.current;
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: msgText });
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: isVoice ? 500 : 1500,
        system: `You are JARVIS, an advanced AI assistant with expertise across all domains — science, history, technology, philosophy, current events, and more. You speak with confidence and precision.

INSTRUCTIONS:
- Be knowledgeable, direct, and engaging
- Reference specific facts, dates, names, and details
- Keep responses concise but substantive
${isVoice ? "- This is a VOICE conversation. Keep your answer to 2-3 sentences. Your LAST sentence MUST be a direct question asking the user what they want to explore next." : "- CRITICAL RULE: Your final sentence MUST be a direct question to the user. Not rhetorical — a real question they can answer. Like: 'Want me to explain how that works?' or 'Should I tell you the surprising part?'"}`,
        messages: history,
      });
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "Unable to process that request.";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
      if (isVoice) speakText(text);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    }
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); voiceModeRef.current = false; sendMessage(); }
  };

  return (
    <div style={{
      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      width: "90%", maxWidth: 560, height: "70vh", maxHeight: 640,
      background: J.bgPanel, backdropFilter: "blur(30px)",
      border: `1px solid ${J.cyan}20`, display: "flex", flexDirection: "column",
      zIndex: 60, boxShadow: `0 0 60px rgba(0,0,0,0.6), 0 0 30px ${J.cyanGlow}`,
    }}>
      <ScanLine />
      <HudCorner position="tl" color={J.cyan} />
      <HudCorner position="tr" color={J.cyan} />
      <HudCorner position="bl" color={J.cyan} />
      <HudCorner position="br" color={J.cyan} />

      {/* Header */}
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${J.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, position: "relative", zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 3, height: 16, background: J.cyan, boxShadow: `0 0 8px ${J.cyanGlow}` }} />
          <span style={{ fontSize: 11, fontFamily: J.fontDisplay, color: J.cyan, letterSpacing: 4, fontWeight: 700 }}>JARVIS // GENERAL</span>
        </div>
        <button onClick={() => { stopSpeaking(); onClose(); }} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, color: J.cyan, width: 30, height: 30, borderRadius: 2, cursor: "pointer", fontSize: 15, fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      </div>

      {/* Messages */}
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
            <div style={{
              background: msg.role === "user" ? `${J.cyan}15` : "rgba(0,229,255,0.04)",
              border: `1px solid ${msg.role === "user" ? `${J.cyan}30` : J.border}`,
              borderRadius: 2, padding: "11px 15px", fontSize: 13, lineHeight: 1.7,
              fontFamily: J.fontBody, color: msg.role === "user" ? "#e0f0ff" : J.text,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{msg.content}</div>
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

      {/* Speaking indicator */}
      {isSpeaking && (
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${J.cyan}20`, display: "flex", alignItems: "center", gap: 8, background: `${J.cyan}08`, position: "relative", zIndex: 3 }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {[0,1,2,3,4].map(i => <div key={i} style={{ width: 3, height: 8 + Math.sin(i * 1.2) * 6, background: J.cyan, animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`, borderRadius: 1 }} />)}
          </div>
          <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.cyan, letterSpacing: 3 }}>JARVIS // SPEAKING</span>
          <button onClick={stopSpeaking} style={{ marginLeft: "auto", background: "rgba(255,0,110,0.1)", border: `1px solid rgba(255,0,110,0.3)`, borderRadius: 2, padding: "3px 10px", fontSize: 9, fontFamily: J.fontDisplay, color: J.magenta, cursor: "pointer", letterSpacing: 2 }}>STOP</button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "14px 18px", borderTop: `1px solid ${J.border}`, flexShrink: 0, position: "relative", zIndex: 3 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(0,229,255,0.03)", border: `1px solid ${isListening ? J.cyan + "50" : J.border}`, borderRadius: 2, padding: "4px 4px 4px 14px", transition: "all 0.3s", boxShadow: isListening ? `0 0 20px ${J.cyan}15` : "none" }}>
          <textarea ref={inputRef} value={input} onChange={e => { setInput(e.target.value); voiceModeRef.current = false; }} onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : "Ask JARVIS anything..."} rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: isListening ? J.cyan : "#e0f0ff", fontSize: 13, fontFamily: J.fontBody, fontWeight: 500, resize: "none", outline: "none", padding: "8px 0", maxHeight: 80, lineHeight: 1.5 }}
          />
          <button onClick={isListening ? stopListening : startListening} disabled={isLoading}
            style={{ background: isListening ? J.cyan : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0, boxShadow: isListening ? `0 0 16px ${J.cyan}50` : "none", animation: isListening ? "micPulse 1.5s ease-in-out infinite" : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isListening ? "#000" : "rgba(0,229,255,0.5)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="1" width="6" height="12" rx="3" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <button onClick={() => { voiceModeRef.current = false; sendMessage(); }} disabled={isLoading || !input.trim()}
            style={{ background: input.trim() ? J.cyan : "rgba(0,229,255,0.06)", border: "none", borderRadius: 2, width: 38, height: 38, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0, boxShadow: input.trim() ? `0 0 12px ${J.cyanGlow}` : "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#000" : "rgba(0,229,255,0.2)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function LandingScreen({ onGenerate }) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [showJarvis, setShowJarvis] = useState(false);

  const handleSubmit = () => {
    if (input.trim()) onGenerate(input.trim());
  };

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: J.bg, padding: 20,
    }}>
      <HexGrid />
      <ScanLine />

      {/* Floating particles */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: 0.2 }}>
        {Array.from({ length: 50 }, (_, i) => {
          const isAccent = seededRandom(i * 19) > 0.85;
          return (
            <div key={i} style={{
              position: "absolute",
              left: `${seededRandom(i * 7) * 100}%`,
              top: `${seededRandom(i * 13 + 3) * 100}%`,
              width: isAccent ? 4 : 2,
              height: isAccent ? 4 : 2,
              background: isAccent ? J.cyan : J.blue,
              boxShadow: isAccent ? `0 0 6px ${J.cyan}` : "none",
              animation: `floatDot ${4 + seededRandom(i * 31) * 6}s ease-in-out ${seededRandom(i * 41) * 3}s infinite alternate`,
            }} />
          );
        })}
      </div>

      {/* Connection lines decoration */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.04, pointerEvents: "none" }}>
        {Array.from({ length: 20 }, (_, i) => (
          <line key={i}
            x1={`${seededRandom(i * 5) * 100}%`} y1={`${seededRandom(i * 11) * 100}%`}
            x2={`${seededRandom(i * 17 + 3) * 100}%`} y2={`${seededRandom(i * 23 + 7) * 100}%`}
            stroke={J.cyan} strokeWidth="0.5"
          />
        ))}
      </svg>

      <div style={{ position: "relative", zIndex: 2, textAlign: "center", maxWidth: 640 }}>
        {/* Top decoration line */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 1, background: `linear-gradient(90deg, transparent, ${J.cyan})` }} />
          <div style={{ fontSize: 10, fontFamily: J.fontDisplay, color: J.cyan, letterSpacing: 6, textTransform: "uppercase", fontWeight: 700, textShadow: `0 0 15px ${J.cyanGlow}` }}>NEURAL MAP</div>
          <div style={{ width: 40, height: 1, background: `linear-gradient(90deg, ${J.cyan}, transparent)` }} />
        </div>

        <h1 style={{ fontSize: 32, fontFamily: J.fontDisplay, fontWeight: 700, color: "#fff", margin: "0 0 10px", lineHeight: 1.15, letterSpacing: 1 }}>
          MAP ANY SUBJECT AS A<br /><span style={{ color: J.cyan, textShadow: `0 0 30px ${J.cyanGlow}` }}>NEURAL NETWORK</span>
        </h1>
        <p style={{ fontSize: 14, fontFamily: J.fontBody, fontWeight: 400, color: J.textMid, margin: "0 0 36px", lineHeight: 1.7, letterSpacing: 0.3 }}>
          Enter any topic and watch AI knowledge unfold into an interactive<br />knowledge graph you can explore and interrogate.
        </p>

        <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} style={{
          display: "flex", gap: 0, marginBottom: 36, position: "relative",
          border: `1px solid ${isFocused ? J.cyan + "50" : J.border}`,
          background: isFocused ? "rgba(0,229,255,0.04)" : "rgba(0,229,255,0.02)",
          transition: "all 0.3s",
          boxShadow: isFocused ? `0 0 20px rgba(0,229,255,0.1), inset 0 0 20px rgba(0,229,255,0.03)` : "none",
        }}>
          <HudCorner position="tl" size={12} />
          <HudCorner position="tr" size={12} />
          <HudCorner position="bl" size={12} />
          <HudCorner position="br" size={12} />
          <input value={input} onChange={e => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)}
            placeholder="ENTER TARGET TOPIC..."
            style={{ flex: 1, background: "transparent", border: "none", color: "#e0f0ff", fontSize: 14, fontFamily: J.fontBody, fontWeight: 500, outline: "none", padding: "14px 18px", letterSpacing: 1, position: "relative", zIndex: 3 }}
          />
          <button type="submit" disabled={!input.trim()}
            style={{
              background: input.trim() ? J.cyan : "rgba(0,229,255,0.08)",
              border: "none", padding: "14px 28px", fontSize: 12, fontWeight: 700,
              fontFamily: J.fontDisplay, letterSpacing: 3,
              color: input.trim() ? J.bg : "rgba(0,229,255,0.25)",
              cursor: input.trim() ? "pointer" : "default", transition: "all 0.2s",
              boxShadow: input.trim() ? `0 0 20px ${J.cyanGlow}` : "none",
              position: "relative", zIndex: 3,
            }}
          >INITIALIZE</button>
        </form>

        <div style={{ fontSize: 9, fontFamily: J.fontDisplay, color: J.textDim, textTransform: "uppercase", letterSpacing: 4, marginBottom: 14 }}>SELECT TARGET</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {SUGGESTED_TOPICS.map(t => (
            <button key={t.label} onClick={() => onGenerate(t.label)}
              style={{ background: "rgba(0,229,255,0.03)", border: `1px solid ${J.border}`, borderRadius: 1, padding: "8px 16px", fontSize: 12, fontFamily: J.fontBody, fontWeight: 500, color: J.textMid, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 8, letterSpacing: 0.5 }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,229,255,0.08)"; e.currentTarget.style.borderColor = J.cyan + "40"; e.currentTarget.style.color = J.cyan; e.currentTarget.style.boxShadow = `0 0 12px rgba(0,229,255,0.1)`; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,229,255,0.03)"; e.currentTarget.style.borderColor = J.border; e.currentTarget.style.color = J.textMid; e.currentTarget.style.boxShadow = "none"; }}
            >
              <span style={{ fontSize: 8, color: J.cyan }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Ask JARVIS button */}
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
          <button onClick={() => setShowJarvis(true)}
            style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.cyan}30`, borderRadius: 2, padding: "12px 28px", fontSize: 12, fontFamily: J.fontDisplay, fontWeight: 700, color: J.cyan, cursor: "pointer", letterSpacing: 3, transition: "all 0.2s", display: "flex", alignItems: "center", gap: 10 }}
            onMouseEnter={e => { e.currentTarget.style.background = `rgba(0,229,255,0.1)`; e.currentTarget.style.boxShadow = `0 0 20px ${J.cyanGlow}`; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,229,255,0.04)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={J.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="1" width="6" height="12" rx="3" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            ASK JARVIS
          </button>
        </div>

        {/* Bottom status bar */}
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 24, opacity: 0.3 }}>
          {["STATUS: READY", "AI: ONLINE", "v1.0.0"].map((s, i) => (
            <span key={i} style={{ fontSize: 9, fontFamily: J.fontMono, color: J.cyan, letterSpacing: 2 }}>{s}</span>
          ))}
        </div>
      </div>

      {/* JARVIS Chat Overlay */}
      {showJarvis && <JarvisChat onClose={() => setShowJarvis(false)} />}
    </div>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────

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
      if (!parsed.categories) parsed.categories = { general: { label: "General", color: "#0EA5E9" } };

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

  // Canvas render — JARVIS HUD style
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

      // Background
      ctx.fillStyle = J.bg;
      ctx.fillRect(0, 0, dimensions.w, dimensions.h);

      // Subtle radial gradient from center
      const bgGrad = ctx.createRadialGradient(dimensions.w/2, dimensions.h/2, 0, dimensions.w/2, dimensions.h/2, Math.max(dimensions.w, dimensions.h) * 0.6);
      bgGrad.addColorStop(0, "rgba(0,229,255,0.02)");
      bgGrad.addColorStop(1, "transparent");
      ctx.fillStyle = bgGrad;
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

      // Connections — holographic lines
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
        if (isSel) { ctx.strokeStyle = (hubColors[selId] || J.cyan) + "50"; ctx.lineWidth = 2; }
        else if (isHov) { ctx.strokeStyle = "rgba(0,229,255,0.25)"; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = (dimA || dimB) ? "rgba(0,229,255,0.015)" : "rgba(0,229,255,0.06)"; ctx.lineWidth = 0.4; }
        ctx.stroke();
      });

      // Data pulses along connections
      if (!isFiltered) {
        mapData.connections.forEach(([aId, bId], ci) => {
          const a = currentNodes.find(n => n.id === aId);
          const b = currentNodes.find(n => n.id === bId);
          if (!a || !b) return;
          const progress = (t * 0.25 + ci * 0.4) % 4;
          if (progress > 1) return;
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,229,255,0.5)`;
          ctx.fill();
        });
      }

      // Nodes — HUD style
      currentNodes.forEach(node => {
        const isDimmed = isFiltered && activeFilter !== node.category;
        const isHov = hoveredNode && hoveredNode.id === node.id;
        const isSel = selId === node.id;
        const isConnSel = connectedToSel.has(node.id);
        const nc = connCounts[node.id] || 0;
        const isHub = nc >= 4;
        const nodeColor = hubColors[node.id] || REGULAR_COLOR;
        const pulse = 1 + Math.sin(t * 2 + node.pulsePhase) * 0.08;
        const baseR = isHub ? 7 + nc * 1.2 : 5;
        const r = baseR * pulse;

        if (isDimmed && !isSel && !isConnSel) {
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,229,255,0.02)"; ctx.fill(); return;
        }

        // Selection / hover glow
        if (isSel || isConnSel) {
          const glowR = isSel ? r * 5 : r * 3;
          const gradient = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, glowR);
          gradient.addColorStop(0, nodeColor + (isSel ? "40" : "18"));
          gradient.addColorStop(1, nodeColor + "00");
          ctx.beginPath(); ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = gradient; ctx.fill();
        } else if (isHov) {
          const gradient = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r * 4);
          gradient.addColorStop(0, nodeColor + "35"); gradient.addColorStop(1, nodeColor + "00");
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 4, 0, Math.PI * 2);
          ctx.fillStyle = gradient; ctx.fill();
        }

        // Hub outer ring
        if (isHub) {
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 2.2, 0, Math.PI * 2);
          ctx.strokeStyle = nodeColor + "18"; ctx.lineWidth = 0.5; ctx.stroke();

          // Rotating arc for hubs
          const arcStart = t * 1.5 + node.pulsePhase;
          ctx.beginPath(); ctx.arc(node.x, node.y, r * 2.2, arcStart, arcStart + Math.PI * 0.6);
          ctx.strokeStyle = nodeColor + "40"; ctx.lineWidth = 1; ctx.stroke();
        }

        // Core node
        const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r);
        grad.addColorStop(0, "#fff");
        grad.addColorStop(0.3, nodeColor);
        grad.addColorStop(1, nodeColor + "60");
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();

        // Node glow
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = isHub ? 12 : 6;
        ctx.beginPath(); ctx.arc(node.x, node.y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor; ctx.fill();
        ctx.shadowBlur = 0;

        if (isSel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
        else if (isHov) { ctx.strokeStyle = nodeColor; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
        else if (isConnSel) { ctx.strokeStyle = nodeColor + "60"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(node.x, node.y, r + 1, 0, Math.PI * 2); ctx.stroke(); }
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
    if (canvasRef.current) canvasRef.current.style.cursor = node ? "pointer" : "crosshair";
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
          {/* Header */}
          {!isFullscreen && (
          <div style={{ padding: "10px 18px", borderBottom: `1px solid ${J.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 40, background: "rgba(3,8,15,0.95)", backdropFilter: "blur(10px)", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => { setAppState("landing"); setMapData(null); setSelectedNode(null); }}
                style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "6px 14px", fontSize: 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", minHeight: 32, letterSpacing: 2, transition: "all 0.2s" }}>◁ NEW</button>
              <div style={{ width: 3, height: 18, background: J.cyan, boxShadow: `0 0 8px ${J.cyanGlow}` }} />
              <span style={{ fontSize: 14, fontFamily: J.fontDisplay, fontWeight: 700, color: J.cyan, letterSpacing: 3, textTransform: "uppercase", textShadow: `0 0 12px ${J.cyanGlow}` }}>{mapData.title || currentTopic}</span>
              <span style={{ fontSize: 11, fontFamily: J.fontMono, color: J.textDim, letterSpacing: 1 }}>{mapData.nodes.length} NODES // {mapData.connections.length} LINKS</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {Object.entries(mapData.categories).map(([key, { color, label }]) => (
                <button key={key} onClick={() => setActiveFilter(activeFilter === key ? null : key)}
                  style={{ background: activeFilter === key ? color + "18" : "rgba(0,229,255,0.03)", border: `1px solid ${activeFilter === key ? color + "50" : J.border}`, borderRadius: 2, padding: "6px 14px", fontSize: 11, fontFamily: J.fontBody, fontWeight: 600, minHeight: 32, color: activeFilter === key ? color : J.textMid, cursor: "pointer", transition: "all 0.2s", letterSpacing: 0.5 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, background: color, marginRight: 6, verticalAlign: "middle", boxShadow: activeFilter === key ? `0 0 6px ${color}` : "none" }} />{label}
                </button>
              ))}
              <button onClick={() => setIsFullscreen(true)}
                style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "6px 14px", fontSize: 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", minHeight: 32, letterSpacing: 2, transition: "all 0.2s" }}>⛶ EXPAND</button>
            </div>
          </div>
          )}

          {/* Canvas */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", cursor: "crosshair" }}
              onMouseMove={handleMouseMove} onClick={handleClick} onWheel={handleWheel}
              onMouseDown={handleMouseDown} onMouseUp={() => { panRef.current.isPanning = false; }}
              onMouseLeave={() => { panRef.current.isPanning = false; setHoveredNode(null); }}
            />

            {/* Fullscreen exit */}
            {isFullscreen && (
              <button onClick={() => setIsFullscreen(false)}
                style={{ position: "absolute", top: 16, left: 16, zIndex: 50, background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, borderRadius: 2, padding: "8px 16px", fontSize: 11, fontFamily: J.fontDisplay, fontWeight: 600, color: J.cyan, cursor: "pointer", letterSpacing: 2, transition: "all 0.2s" }}>◁ EXIT</button>
            )}

            {/* HUD corner markers on canvas */}
            <div style={{ position: "absolute", top: 12, left: 12, width: 24, height: 24, borderTop: `1px solid ${J.cyan}30`, borderLeft: `1px solid ${J.cyan}30`, pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: 12, right: selectedNode ? 420 : 12, width: 24, height: 24, borderTop: `1px solid ${J.cyan}30`, borderRight: `1px solid ${J.cyan}30`, pointerEvents: "none", transition: "right 0.3s" }} />
            <div style={{ position: "absolute", bottom: 12, left: 12, width: 24, height: 24, borderBottom: `1px solid ${J.cyan}30`, borderLeft: `1px solid ${J.cyan}30`, pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: 12, right: selectedNode ? 420 : 12, width: 24, height: 24, borderBottom: `1px solid ${J.cyan}30`, borderRight: `1px solid ${J.cyan}30`, pointerEvents: "none", transition: "right 0.3s" }} />

            {/* Tooltip */}
            {hoveredNode && !selectedNode && (() => {
              const ttColor = getTooltipColor(hoveredNode);
              const cc = computeConnectionCounts(mapData.connections);
              const ttConns = cc[hoveredNode.id] || 0;
              const ttIsHub = ttConns >= 4;
              return (
                <div style={{ position: "fixed", left: tooltipPos.x, top: tooltipPos.y - 12, transform: "translate(-50%, -100%)", background: "rgba(3,8,15,0.95)", backdropFilter: "blur(16px)", border: `1px solid ${ttColor}35`, padding: "12px 16px", zIndex: 50, pointerEvents: "none", maxWidth: 300, boxShadow: `0 8px 32px rgba(0,0,0,0.7), 0 0 15px ${ttColor}10` }}>
                  <HudCorner position="tl" size={10} color={ttColor} />
                  <HudCorner position="br" size={10} color={ttColor} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 3, height: 10, background: ttColor, boxShadow: `0 0 4px ${ttColor}80` }} />
                    <span style={{ fontSize: 9, fontFamily: J.fontDisplay, color: ttColor, textTransform: "uppercase", letterSpacing: 2, fontWeight: 600 }}>
                      {mapData.categories[hoveredNode.category]?.label || hoveredNode.category}{ttIsHub ? ` // ${ttConns} LINKS` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontFamily: J.fontDisplay, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 6 }}>{hoveredNode.title}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {hoveredNode.tags?.slice(0, 4).map(tag => (
                      <span key={tag} style={{ background: `${ttColor}10`, border: `1px solid ${ttColor}25`, padding: "1px 6px", fontSize: 9, fontFamily: J.fontMono, color: `${ttColor}CC`, letterSpacing: 1, textTransform: "uppercase" }}>{tag}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 9, fontFamily: J.fontMono, color: J.textDim, letterSpacing: 2 }}>CLICK TO ANALYZE</div>
                </div>
              );
            })()}

            {/* Zoom controls */}
            <div style={{ position: "absolute", bottom: 20, right: selectedNode ? 420 : 20, zIndex: 45, display: "flex", flexDirection: "column", gap: 4, transition: "right 0.3s ease" }}>
              <button onClick={() => { panRef.current.scale = Math.min(3, panRef.current.scale * 1.25); }}
                style={{ width: 36, height: 36, borderRadius: 2, background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, color: J.cyan, fontSize: 18, cursor: "pointer", fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>+</button>
              <button onClick={() => { panRef.current.scale = Math.max(0.3, panRef.current.scale * 0.8); }}
                style={{ width: 36, height: 36, borderRadius: 2, background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, color: J.cyan, fontSize: 18, cursor: "pointer", fontFamily: J.fontMono, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>-</button>
            </div>

            {selectedNode && mapData && <ChatPanel node={selectedNode} mapData={mapData} onClose={() => setSelectedNode(null)} onNavigate={handleNavigate} />}

            {!selectedNode && (
              <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(3,8,15,0.9)", backdropFilter: "blur(10px)", border: `1px solid ${J.border}`, padding: "10px 24px", fontSize: 10, fontFamily: J.fontMono, color: J.textDim, pointerEvents: "none", textAlign: "center", letterSpacing: 2 }}>
                CLICK NODE TO ANALYZE &middot; SCROLL TO ZOOM &middot; DRAG TO PAN
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
