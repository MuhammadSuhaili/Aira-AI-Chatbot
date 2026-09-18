const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const modelSelect = document.getElementById("model");
const welcomeEl = document.getElementById("welcome");
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const toastEl = document.getElementById("toast");
const ragReindexBtn = document.getElementById("ragReindex");
const ragStatusEl = document.getElementById("ragStatus");
const ragFilesEl = document.getElementById("ragFiles");
const historyBtn = document.getElementById("historyBtn");
const sessionsEl = document.getElementById("sessions");
const sessionsOverlay = document.getElementById("sessionsOverlay");
const sessionListEl = document.getElementById("sessionList");

const history = [];
let busy = false;
let health = { ok: false, local: false, providers: {} };
let modelsData = { local: [], groq: [], gemini: [], openai: [], openrouter: [] };
let sel = { provider: "local", model: null };
let sessions = [];
let activeId = null;
const SESS_KEY = "aira_sessions";

const PROVS = [
  ["local", "Lokal"],
  ["gemini", "Gemini"],
  ["groq", "Groq"],
  ["openai", "OpenAI"],
  ["openrouter", "OpenRouter"],
  ["9router", "9Router"],
];

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), 2200);
}

function applyHealth() {
  const nCloud = Object.keys(health.providers || {}).length;
  if (health.ok) setStatus(nCloud ? `online · ${nCloud} cloud` : "online", "online");
  else if (health.local === false && nCloud === 0) setStatus("Ollama belum nyala", "offline");

  const fullyConfigured = health.providers.gemini && health.providers.groq;
  settingsBtn.hidden = !!fullyConfigured;
}

async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    health = await res.json();
  } catch {
    health = { ok: false, local: false, providers: {} };
  }
  applyHealth();
}

async function refreshModels() {
  try {
    const res = await fetch("/api/models");
    modelsData = await res.json();
  } catch {
    modelsData = { local: [], groq: [], gemini: [], openai: [], openrouter: [] };
  }
  buildModelSelect();
}

function buildModelSelect() {
  modelSelect.innerHTML = "";
  let first = null;

  PROVS.forEach(([prov, label]) => {
    const list = modelsData[prov] || [];
    const available = prov === "local" ? health.local && list.length : (health.providers[prov] && list.length);
    if (!available) return;

    const optg = document.createElement("optgroup");
    optg.label = label + (prov === "local" ? "" : " ☁");
    list.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      opt.dataset.provider = prov;
      opt.dataset.model = m;
      optg.appendChild(opt);
      if (!first) {
        first = opt;
        opt.selected = true;
      }
    });
    modelSelect.appendChild(optg);
  });

  if (!first) {
    modelSelect.innerHTML = "<option>Belum ada model</option>";
    sel = { provider: "local", model: null };
  } else {
    sel = { provider: first.dataset.provider, model: first.dataset.model };
  }

  const best = [...modelSelect.options].find((o) => o.dataset.provider === "gemini");
  if (best) {
    best.selected = true;
    sel = { provider: best.dataset.provider, model: best.dataset.model };
  }
}

function applySel() {
  const opt = modelSelect.selectedOptions[0];
  if (opt && opt.dataset.model) {
    sel = { provider: opt.dataset.provider, model: opt.dataset.model };
  }
}

// ── Settings modal ─────────────────────────────────
async function loadSettings() {
  const fields = {
    gemini_key_set: document.getElementById("inGeminiKey"),
    groq_key_set: document.getElementById("inGroqKey"),
    openai_key_set: document.getElementById("inOpenaiKey"),
    openrouter_key_set: document.getElementById("inOpenrouterKey"),
    nine_router_key_set: document.getElementById("inNineRouterKey"),
  };
  try {
    const res = await fetch("/api/settings");
    const s = await res.json();
    document.getElementById("inOpenaiUrl").value = s.openai_base_url || "";
    document.getElementById("inNineRouterUrl").value = s.nine_router_base_url || "";
    document.getElementById("ragToggle").checked = !!s.rag_enabled;
    for (const [k, input] of Object.entries(fields)) {
      input.value = "";
      input.placeholder = k === "nine_router_key_set" && !s[k]
        ? "Kosong juga boleh"
        : s[k] ? "Tersimpan" : "Belum di-set";
    }
  } catch {
    toast("Gagal memuat pengaturan");
  }
  await refreshRagStatus();
}

async function refreshRagStatus() {
  try {
    const res = await fetch("/api/rag/status");
    const st = await res.json();
    const totalFiles = (st.files || []).length;
    if (totalFiles) {
      ragStatusEl.textContent = `Aktif · ${totalFiles} file · ${st.chunks} potongan`;
      ragFilesEl.innerHTML = (st.files || [])
        .map((f) => `<li><span>${escapeHtml(f.name)}</span><span>${f.chunks} potong</span></li>`)
        .join("");
    } else {
      ragStatusEl.textContent = "Belum ada dokumen";
      ragFilesEl.textContent = "";
    }
  } catch {
    ragStatusEl.textContent = "Gagal memuat status";
  }
}

function openSettings() {
  settingsModal.hidden = false;
  loadSettings();
}

function closeSettings() {
  settingsModal.hidden = true;
}

async function saveSettings() {
  const payload = {};
  const keyInputs = [
    ["gemini_api_key", "inGeminiKey"],
    ["groq_api_key", "inGroqKey"],
    ["openai_api_key", "inOpenaiKey"],
    ["openrouter_api_key", "inOpenrouterKey"],
    ["nine_router_api_key", "inNineRouterKey"],
  ];
  keyInputs.forEach(([k, id]) => {
    const v = document.getElementById(id).value.trim();
    if (v) payload[k] = v;
  });
  const url = document.getElementById("inOpenaiUrl").value.trim();
  if (url) payload.openai_base_url = url;
  const nineUrl = document.getElementById("inNineRouterUrl").value.trim();
  if (nineUrl) payload.nine_router_base_url = nineUrl;
  payload.rag_enabled = document.getElementById("ragToggle").checked;

  saveBtnBusy(true);
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("gagal");
    await Promise.all([refreshHealth(), refreshModels()]);
    await loadSettings();
    toast("Pengaturan tersimpan");
  } catch {
    toast("Gagal menyimpan");
  } finally {
    saveBtnBusy(false);
  }
}

function saveBtnBusy(b) {
  document.getElementById("settingsSave").disabled = b;
}

async function reindexRag() {
  ragReindexBtn.disabled = true;
  ragStatusEl.textContent = "Memproses…";
  try {
    const res = await fetch("/api/rag/reindex", { method: "POST" });
    if (!res.ok) throw new Error((await res.json()).detail || "gagal");
    toast("Dokumen diproses");
  } catch (e) {
    toast("Gagal proses: " + (e.message || "Ollama mati?"));
  } finally {
    ragReindexBtn.disabled = false;
    await refreshRagStatus();
  }
}

settingsBtn.addEventListener("click", openSettings);
document.getElementById("settingsClose").addEventListener("click", closeSettings);
document.getElementById("settingsClose2").addEventListener("click", closeSettings);
document.getElementById("settingsSave").addEventListener("click", saveSettings);
document.getElementById("ragReindex").addEventListener("click", reindexRag);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

// ── Sessions (riwayat) ─────────────────────────────
function loadSessions() {
  try {
    sessions = JSON.parse(localStorage.getItem(SESS_KEY)) || [];
  } catch {
    sessions = [];
  }
  sessions = sessions.slice(0, 50);
}

function persistSessions() {
  localStorage.setItem(SESS_KEY, JSON.stringify(sessions.slice(0, 50)));
}

function titleOf(msgs) {
  const m = msgs.find((x) => x.role === "user");
  if (!m) return "Tanpa judul";
  const t = m.content.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "Tanpa judul";
}

function recentTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function saveCurrent() {
  if (!history.length) return;
  if (!activeId) {
    activeId = "s" + Date.now();
    sessions.unshift({ id: activeId, title: titleOf(history), messages: [], ts: Date.now() });
  }
  const s = sessions.find((x) => x.id === activeId);
  if (!s) return;
  s.title = titleOf(history);
  s.messages = history.slice();
  s.ts = Date.now();
  const i = sessions.indexOf(s);
  if (i > 0) {
    sessions.splice(i, 1);
    sessions.unshift(s);
  }
  persistSessions();
  renderSessionList();
}

function renderSessionList() {
  sessionListEl.innerHTML = "";
  if (!sessions.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Belum ada percakapan.";
    sessionListEl.appendChild(li);
    return;
  }
  sessions.forEach((s) => {
    const li = document.createElement("li");
    li.className = "sess-item" + (s.id === activeId ? " active" : "");

    const main = document.createElement("div");
    main.className = "sess-main";
    const title = document.createElement("div");
    title.className = "sess-title";
    title.textContent = s.title;
    const time = document.createElement("div");
    time.className = "sess-time";
    time.textContent = recentTime(s.ts);
    main.appendChild(title);
    main.appendChild(time);

    const del = document.createElement("button");
    del.className = "sess-del";
    del.textContent = "×";
    del.title = "Hapus percakapan";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    li.addEventListener("click", () => openSession(s.id));
    li.appendChild(main);
    li.appendChild(del);
    sessionListEl.appendChild(li);
  });
}

function deleteSession(id) {
  sessions = sessions.filter((x) => x.id !== id);
  if (activeId === id) activeId = null;
  persistSessions();
  renderSessionList();
}

function openSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  activeId = id;
  history.length = 0;
  s.messages.forEach((m) => history.push({ role: m.role, content: m.content }));
  renderChat();
  closeSessionsPanel();
}

function newChat() {
  activeId = null;
  history.length = 0;
  chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
  chatEl.appendChild(welcomeEl);
  inputEl.value = "";
  autoResize();
  scrollBottom();
  closeSessionsPanel();
  renderSessionList();
}

function renderChat() {
  chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
  welcomeEl.remove();
  if (!history.length) {
    chatEl.appendChild(welcomeEl);
  } else {
    history.forEach((m) => addMessage(m.role, m.content));
  }
  scrollBottom();
}

function openSessionsPanel() {
  renderSessionList();
  sessionsEl.hidden = false;
  sessionsOverlay.hidden = false;
}

function closeSessionsPanel() {
  sessionsEl.hidden = true;
  sessionsOverlay.hidden = true;
}

historyBtn.addEventListener("click", openSessionsPanel);
document.getElementById("sessionsClose").addEventListener("click", closeSessionsPanel);
sessionsOverlay.addEventListener("click", closeSessionsPanel);
document.getElementById("newSession").addEventListener("click", newChat);

// ── Chat ───────────────────────────────────────────
function addMessage(role, content, isError) {
  welcomeEl?.remove();
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (isError ? " error" : "");
  bubble.innerHTML = role === "user" ? escapeHtml(content) : renderMarkdown(content);

  if (role === "ai") {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    const img = document.createElement("img");
    img.src = "assets/aira-mark.svg";
    img.alt = "";
    avatar.appendChild(img);
    wrap.appendChild(avatar);
  }

  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  scrollBottom();
  return bubble;
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg ai";
  wrap.id = "typing";

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  const img = document.createElement("img");
  img.src = "assets/aira-mark.svg";
  img.alt = "";
  avatar.appendChild(img);

  const bubble = document.createElement("div");
  bubble.className = "bubble typing";
  bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  scrollBottom();
}

function removeTyping() {
  document.getElementById("typing")?.remove();
}

function scrollBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  inputEl.value = "";
  autoResize();
  addMessage("user", text);
  history.push({ role: "user", content: text });
  saveCurrent();
  busy = true;
  sendBtn.disabled = true;
  sendBtn.classList.add("loading");
  showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: sel.provider,
        model: sel.model,
        messages: history,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.status + " " + res.statusText);
    }

    removeTyping();
    const bubble = addMessage("ai", "");

    let reply = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleEvent = (payload) => {
      let j;
      try {
        j = JSON.parse(payload);
      } catch {
        return;
      }
      if (j.error) throw new Error(j.error);
      if (j.message && j.message.content) {
        reply += j.message.content;
        bubble.innerHTML = renderMarkdown(reply);
        scrollBottom();
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.trim();
        if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
      }
    }

    const tail = buffer.trim();
    if (tail) {
      if (tail.startsWith("data:")) {
        handleEvent(tail.slice(5).trim());
      } else {
        for (const line of tail.split(/[\r\n]+/)) {
          const l = line.trim();
          if (l.startsWith("data:")) handleEvent(l.slice(5).trim());
        }
      }
    }

    if (!reply) throw new Error("Tidak ada jawaban dari model");
    history.push({ role: "assistant", content: reply });
    saveCurrent();
  } catch (err) {
    removeTyping();
    addMessage(
      "ai",
      `⚠️ **Gagal:** ${err.message}\n\nCek model/provider di Pengaturan.`,
      true
    );
  } finally {
    busy = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove("loading");
    inputEl.focus();
  }
}

// ── Markdown ───────────────────────────────────────
function renderMarkdown(text) {
  const escaped = escapeHtml(fixListNumbers(mergeLonelyListNumber(text)));
  const codeBlocks = [];

  let out = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return `\u0000CODE${i}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  out = out.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  out = out.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  const lines = out.split("\n");
  const blocks = [];
  let list = null;

  const flushList = () => {
    if (list) {
      blocks.push(list.open + list.items.join("") + list.close);
      list = null;
    }
  };

  const isTableSep = (s) => {
    if (!s || !s.trim().startsWith("|")) return false;
    const cells = s.replace(/^\s*\||\|\s*$/g, "").split("|");
    return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
  };

  const renderTable = (start) => {
    const headerCells = lines[start]
      .replace(/^\s*\||\|\s*$/g, "")
      .split("|")
      .map((c) => c.trim());
    const rows = [];
    let i = start + 2;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      rows.push(
        lines[i]
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((c) => c.trim())
      );
      i++;
    }
    const th = headerCells.map((c) => `<th>${c}</th>`).join("");
    const trs = rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("");
    blocks.push(
      `<div class="table-scroll"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`
    );
    return i;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("\u0000CODE")) {
      flushList();
      blocks.push(line);
      i++;
      continue;
    }

    if (isTableSep(lines[i + 1])) {
      flushList();
      i = renderTable(i);
      continue;
    }

    if (/^---+$/.test(line.trim()) && !line.trim().startsWith("|")) {
      flushList();
      blocks.push("<hr>");
      i++;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const ul = line.match(/^[-*] (.+)$/);
    const ol = line.match(/^\d+\. (.+)$/);

    if (ul) {
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", open: "<ul>", close: "</ul>", items: [] };
      }
      list.items.push(`<li>${ul[1]}</li>`);
      i++;
      continue;
    }

    if (ol) {
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", open: "<ol>", close: "</ol>", items: [] };
      }
      list.items.push(`<li>${ol[1]}</li>`);
      i++;
      continue;
    }

    if (list && /^\s+/.test(line)) {
      const t2 = line.trim();
      if (t2) {
        const idx = list.items.length - 1;
        list.items[idx] = list.items[idx].replace(/<\/li>$/, `<p>${t2}</p></li>`);
      }
      i++;
      continue;
    }

    flushList();

    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }

    if (/^<(h\d|blockquote|hr)/.test(line)) {
      blocks.push(line);
      i++;
      continue;
    }

    blocks.push(`<p>${line}</p>`);
    i++;
  }
  flushList();

  return blocks
    .join("\n")
    .replace(/\u0000CODE(\d+)\u0000/g, (_, n) => codeBlocks[+n]);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Beberapa model menulis "1. 1. 1. 1." — ratakan jadi 1,2,3,4,5.
function fixListNumbers(text) {
  const lines = text.split("\n");
  const out = [];
  let pending = null;
  for (const line of lines) {
    const m = line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
    if (m) {
      const num = Number(m[2]);
      if (pending && num === pending.num) {
        pending.count++;
        out.push(`${m[1]}${pending.count}${m[3]}${m[4]}${m[5]}`);
        continue;
      }
      pending = { num, count: 1 };
      out.push(line);
    } else {
      pending = null;
      out.push(line);
    }
  }
  return out.join("\n");
}

// Model kadang menulis "1." lalu isi di baris berikutnya → gabungkan.
function mergeLonelyListNumber(text) {
  return text.replace(
    /^(\s*\d+[.)])[ \t]*\r?\n(?=\s*\S)/gm,
    "$1 "
  );
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}

inputEl.addEventListener("input", autoResize);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
sendBtn.addEventListener("click", send);
modelSelect.addEventListener("change", applySel);

clearBtn.addEventListener("click", () => {
  history.length = 0;
  chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
  inputEl.value = "";
  autoResize();
});

document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    inputEl.value = c.dataset.q;
    autoResize();
    send();
  })
);

// ── Init ───────────────────────────────────────────
async function init() {
  loadSessions();
  try {
    const res = await fetch("/api/bootstrap");
    const b = await res.json();
    health = b.health || { ok: false, local: false, providers: {} };
    modelsData = b.models || modelsData;
  } catch {
    await refreshHealth();
    await refreshModels();
  }
  applyHealth();
  buildModelSelect();
  if (sessions.length) openSession(sessions[0].id);
}

init();