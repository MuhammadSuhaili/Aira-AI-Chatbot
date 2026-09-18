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

const history = [];
let busy = false;
let health = { ok: false, local: false, providers: {} };
let modelsData = { local: [], groq: [], gemini: [], openai: [], openrouter: [] };
let sel = { provider: "local", model: null };

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

async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    health = await res.json();
  } catch {
    health = { ok: false, local: false, providers: {} };
  }
  const nCloud = Object.keys(health.providers || {}).length;
  if (health.ok) setStatus(nCloud ? `online · ${nCloud} cloud` : "online", "online");
  else if (health.local === false && nCloud === 0) setStatus("Ollama belum nyala", "offline");
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!chunk.startsWith("data:")) continue;
        const payload = chunk.slice(5).trim();
        if (!payload) continue;

        let j;
        try {
          j = JSON.parse(payload);
        } catch {
          continue;
        }

        if (j.error) throw new Error(j.error);
        if (j.message && j.message.content) {
          reply += j.message.content;
          bubble.innerHTML = renderMarkdown(reply);
          scrollBottom();
        }
      }
    }

    if (!reply) throw new Error("Tidak ada jawaban dari model");
    history.push({ role: "assistant", content: reply });
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
  const escaped = escapeHtml(text);
  const codeBlocks = [];

  let out = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return `\u0000CODE${i}\u0000`;
  });

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

  for (const line of lines) {
    if (line.startsWith("\u0000CODE")) {
      flushList();
      blocks.push(line);
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
      continue;
    }

    if (ol) {
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", open: "<ol>", close: "</ol>", items: [] };
      }
      list.items.push(`<li>${ol[1]}</li>`);
      continue;
    }

    flushList();

    const t = line.trim();
    if (!t) continue;

    if (/^<(h\d|blockquote)/.test(line)) {
      blocks.push(line);
      continue;
    }

    blocks.push(`<p>${line}</p>`);
  }
  flushList();

  return blocks
    .join("\n")
    .replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[+i]);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  await refreshHealth();
  await refreshModels();
}

init();