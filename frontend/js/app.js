/**
 * VYKE IDE – Application principale
 * Monaco Editor + Ollama (chat & complétion)
 */

'use strict';

// ─── État global ──────────────────────────────────────────────────────────────
const state = {
  editor: null,
  currentFile: 'untitled.py',
  isDirty: false,
  chatHistory: [],
  chatModel: 'mistral-small3.2:24b',
  codeModel: 'qwen2.5-coder:7b',
  currentLanguage: 'python',
  isStreaming: false,
  completionText: '',
  completionTimeout: null,
  codeContextEnabled: true,  // Le code de l'éditeur est envoyé avec chaque message
  // Sidebar
  sidebarOpen: true,
  sidebarWidth: 240,
  projectPath: '',           // chemin relatif dans WORKSPACE_ROOT
  currentFilePath: null,     // null = mode projects/, string = mode workspace
  // Onglets multiples
  tabs: [],                  // liste de { id, filename, language, filePath, projectFile, model, viewState, dirty }
  activeTabId: null,
  tabCounter: 0,
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const API = '';  // Même origine que le backend FastAPI
const DEBOUNCE_MS = 3000;

const EXT_TO_LANG = {
  py: 'python', js: 'javascript', ts: 'typescript',
  md: 'markdown', json: 'json', sh: 'bash', bash: 'bash',
  html: 'html', css: 'css', txt: 'plaintext',
};

const LANG_ICONS = {
  python: '🐍', javascript: '⚡', typescript: '🔷', markdown: '📝',
  json: '{}', bash: '🐚', html: '🌐', css: '🎨', plaintext: '📄',
};

// ─── Monaco Loader ────────────────────────────────────────────────────────────
require.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' },
});

require(['vs/editor/editor.main'], () => {
  defineVykeTheme();
  initEditor();
  initEventListeners();
  fetchModels();
  checkOllamaStatus();
  setInterval(checkOllamaStatus, 30_000);
});

// ─── Thème Monaco ─────────────────────────────────────────────────────────────
function defineVykeTheme() {
  monaco.editor.defineTheme('vyke-hc', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // Base text
      { token: '',                    foreground: 'D4D4D4' },
      // Comments — VS Code green, italic
      { token: 'comment',             foreground: '6A9955', fontStyle: 'italic' },
      { token: 'comment.doc',         foreground: '6A9955', fontStyle: 'italic' },
      // Keywords — VS Code blue
      { token: 'keyword',             foreground: '569CD6' },
      { token: 'keyword.flow',        foreground: 'C586C0' },
      { token: 'keyword.operator',    foreground: '569CD6' },
      { token: 'storage',             foreground: '569CD6' },
      // Strings — VS Code orange
      { token: 'string',              foreground: 'CE9178' },
      { token: 'string.escape',       foreground: 'D7BA7D' },
      { token: 'string.template',     foreground: 'CE9178' },
      // Numbers — light green
      { token: 'number',              foreground: 'B5CEA8' },
      // Types / classes — teal
      { token: 'type',                foreground: '4EC9B0' },
      { token: 'type.identifier',     foreground: '4EC9B0' },
      { token: 'class-name',          foreground: '4EC9B0' },
      { token: 'interface',           foreground: '4EC9B0' },
      { token: 'enum',                foreground: '4EC9B0' },
      { token: 'struct',              foreground: '4EC9B0' },
      // Functions — VS Code yellow
      { token: 'function',            foreground: 'DCDCAA' },
      { token: 'method',              foreground: 'DCDCAA' },
      { token: 'function.call',       foreground: 'DCDCAA' },
      // Variables — VS Code light blue
      { token: 'variable',            foreground: '9CDCFE' },
      { token: 'variable.predefined', foreground: '9CDCFE' },
      { token: 'parameter',           foreground: '9CDCFE' },
      { token: 'property',            foreground: '9CDCFE' },
      // Constants
      { token: 'constant',            foreground: '4FC1FF' },
      // Operators and delimiters
      { token: 'operator',            foreground: 'D4D4D4' },
      { token: 'delimiter',           foreground: '808080' },
      { token: 'delimiter.bracket',   foreground: 'FFD700' },
      // Decorators / annotations
      { token: 'annotation',          foreground: 'DCDCAA' },
      { token: 'decorator',           foreground: 'DCDCAA' },
      // Regexp
      { token: 'regexp',              foreground: 'CE9178' },
      // Markup / HTML
      { token: 'tag',                 foreground: '569CD6' },
      { token: 'tag.id',              foreground: '569CD6' },
      { token: 'attribute.name',      foreground: '9CDCFE' },
      { token: 'attribute.value',     foreground: 'CE9178' },
      { token: 'metatag',             foreground: 'D7BA7D' },
      // CSS
      { token: 'attribute.value.css', foreground: 'CE9178' },
      { token: 'keyword.css',         foreground: '4EC9B0' },
      // JSON
      { token: 'key.json',            foreground: '9CDCFE' },
      { token: 'value.json',          foreground: 'CE9178' },
    ],
    colors: {
      // Surfaces
      'editor.background':                     '#000000',
      'editor.foreground':                     '#D4D4D4',
      'editorGutter.background':               '#000000',
      // Line numbers
      'editorLineNumber.foreground':           '#444444',
      'editorLineNumber.activeForeground':     '#888888',
      // Current line
      'editor.lineHighlightBackground':        '#111111',
      'editor.lineHighlightBorder':            '#111111',
      // Selection — VS Code HC blue
      'editor.selectionBackground':            '#264F78',
      'editor.selectionHighlightBackground':   '#1a3a5c66',
      'editor.inactiveSelectionBackground':    '#264F7866',
      // Word highlight
      'editor.wordHighlightBackground':        '#575757b8',
      'editor.wordHighlightStrongBackground':  '#004972b8',
      // Find
      'editor.findMatchBackground':            '#515C6A',
      'editor.findMatchHighlightBackground':   '#314365',
      'editor.findMatchBorder':                '#569CD6',
      // Cursor
      'editorCursor.foreground':               '#569CD6',
      'editorCursor.background':               '#000000',
      // Indent guides
      'editorIndentGuide.background':          '#333333',
      'editorIndentGuide.activeBackground':    '#555555',
      // Bracket matching
      'editorBracketMatch.background':         '#1A3A5C',
      'editorBracketMatch.border':             '#569CD6',
      // Widgets (autocomplete, hover docs)
      'editorWidget.background':               '#0a0a0a',
      'editorWidget.border':                   '#333333',
      'editorWidget.foreground':               '#D4D4D4',
      'editorSuggestWidget.background':        '#0a0a0a',
      'editorSuggestWidget.border':            '#333333',
      'editorSuggestWidget.foreground':        '#D4D4D4',
      'editorSuggestWidget.selectedBackground':'#1a1a1a',
      'editorSuggestWidget.selectedForeground':'#ffffff',
      'editorSuggestWidget.highlightForeground':'#569CD6',
      'editorHoverWidget.background':          '#0a0a0a',
      'editorHoverWidget.border':              '#333333',
      // Scrollbar
      'scrollbarSlider.background':            '#33333377',
      'scrollbarSlider.hoverBackground':       '#569CD644',
      'scrollbarSlider.activeBackground':      '#569CD688',
      // Minimap
      'minimap.background':                    '#000000',
      'minimapSlider.background':              '#33333377',
      // Input
      'input.background':                      '#111111',
      'input.border':                          '#333333',
      'input.foreground':                      '#D4D4D4',
      'input.placeholderForeground':           '#555555',
      'inputOption.activeBorder':              '#569CD6',
      // Focus ring
      'focusBorder':                           '#569CD6',
      // Diff
      'diffEditor.insertedTextBackground':     '#6A995522',
      'diffEditor.removedTextBackground':      '#F4474722',
    },
  });
}

// ─── Initialisation éditeur ───────────────────────────────────────────────────
function initEditor() {
  state.editor = monaco.editor.create(document.getElementById('editor'), {
    value: defaultCode(),
    language: 'python',
    theme: 'vyke-hc',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    fontLigatures: true,
    lineHeight: 22,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    minimap: { enabled: false },
    cursorBlinking: 'smooth',
    cursorStyle: 'line',
    cursorWidth: 2,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    renderWhitespace: 'none',
    smoothScrolling: true,
    scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
    suggest: { showSnippets: true },
    tabSize: 4,
    insertSpaces: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: false, indentation: true },
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'line',
    occurrencesHighlight: false,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
  });

  // Raccourcis clavier
  state.editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    () => saveFile()
  );
  state.editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
    () => triggerCompletion()
  );
  state.editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN,
    () => newFile()
  );
  state.editor.addCommand(
    monaco.KeyCode.F5,
    () => runCode()
  );

  // Événements éditeur
  state.editor.onDidChangeCursorPosition(updateCursorInfo);
  state.editor.onDidChangeModelContent(() => {
    markDirty();
    scheduleCompletion();
    updateChatContextStrip(false);
  });

  // Tab pour accepter complétion
  state.editor.addCommand(monaco.KeyCode.Tab, () => {
    if (!document.getElementById('completion-panel').classList.contains('hidden')) {
      acceptCompletion();
    } else {
      state.editor.trigger('keyboard', 'tab', {});
    }
  });
  state.editor.addCommand(monaco.KeyCode.Escape, () => rejectCompletion());
  state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => closeTab(state.activeTabId));

  // Initialiser le système d'onglets avec le modèle Monaco auto-créé
  const initModel = state.editor.getModel();
  const firstTab = {
    id: 't' + (++state.tabCounter),
    filename: 'untitled.py', language: 'python',
    filePath: null, projectFile: null,
    model: initModel, viewState: null, dirty: false,
  };
  state.tabs.push(firstTab);
  state.activeTabId = firstTab.id;
  renderTabsBar();
}

function defaultCode() {
  return `# Bienvenue dans VYKE IDE
# Propulsé par Monaco Editor + Ollama (${state.codeModel})

def saluer(nom: str) -> str:
    """Renvoie un message de bienvenue."""
    return f"Salut, {nom} ! Prêt à coder ? 🚀"


if __name__ == "__main__":
    print(saluer("monde"))
`;
}

// ─── Gestion des onglets ──────────────────────────────────────────────────────

function createTab(filename, language, content, filePath, projectFile = null) {
  const id = 't' + (++state.tabCounter);
  const model = monaco.editor.createModel(content, language);
  const tab = { id, filename, language, filePath, projectFile, model, viewState: null, dirty: false };
  state.tabs.push(tab);
  return tab;
}

function activateTab(tabId) {
  // Sauvegarder l'état de vue de l'onglet courant
  if (state.activeTabId) {
    const cur = state.tabs.find(t => t.id === state.activeTabId);
    if (cur && state.editor) cur.viewState = state.editor.saveViewState();
  }

  state.activeTabId = tabId;
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  // Synchroniser les variables d'état plates
  state.currentFile     = tab.filename;
  state.currentFilePath = tab.filePath;
  state.isDirty         = tab.dirty;
  state.currentLanguage = tab.language;

  // Changer de modèle Monaco
  state.editor.setModel(tab.model);
  if (tab.viewState) state.editor.restoreViewState(tab.viewState);

  // Mettre à jour la toolbar
  document.getElementById('lang-select').value = tab.language;
  document.getElementById('status-lang').textContent =
    tab.language.charAt(0).toUpperCase() + tab.language.slice(1);
  updateTerminalLangBadge();
  renderTabsBar();
  updateFileUI();
  updateChatContextStrip(false);
  state.editor.focus();
}

function closeTab(tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  if (tab.dirty && !confirm(`Fermer "${tab.filename}" sans sauvegarder ?`)) return;

  const idx = state.tabs.indexOf(tab);
  state.tabs.splice(idx, 1);
  tab.model.dispose();

  if (state.tabs.length === 0) {
    // Créer un onglet vide si plus aucun onglet
    const newTab = createTab('untitled.py', 'python', '', null, null);
    activateTab(newTab.id);
    return;
  }

  if (state.activeTabId === tabId) {
    const newIdx = Math.min(idx, state.tabs.length - 1);
    activateTab(state.tabs[newIdx].id);
  } else {
    renderTabsBar();
  }
}

function renderTabsBar() {
  const list = document.getElementById('tabs-list');
  if (!list) return;
  list.innerHTML = '';

  state.tabs.forEach(tab => {
    const icon = LANG_ICONS[tab.language] || '📄';
    const div = document.createElement('div');
    div.className = 'editor-tab' +
      (tab.id === state.activeTabId ? ' active' : '') +
      (tab.dirty ? ' dirty' : '');
    div.dataset.tabId = tab.id;
    div.innerHTML =
      `<span class="tab-icon">${icon}</span>` +
      `<span class="tab-filename">${escapeHtml(tab.filename)}</span>` +
      `<button class="tab-close" title="Fermer (Ctrl+W)">✕</button>`;

    div.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) activateTab(tab.id);
    });
    div.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    list.appendChild(div);
  });

  // Scroller vers l'onglet actif
  const activeEl = list.querySelector('.editor-tab.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ─── Gestion de fichiers ──────────────────────────────────────────────────────
function newFile() {
  const tab = createTab('untitled.py', 'python', '', null, null);
  activateTab(tab.id);
  showToast('Nouveau fichier créé', 'success');
}

async function saveFile() {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;
  const content = state.editor.getValue();

  // ── Mode workspace ────────────────────────────────────────────────────────
  if (tab.filePath !== null) {
    try {
      const r = await fetch(`${API}/api/workspace/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.filePath, content }),
      });
      if (!r.ok) throw new Error(await r.text());
      tab.dirty = false;
      state.isDirty = false;
      updateFileUI();
      showToast(`Sauvegardé : ${tab.filename}`, 'success');
      setStatusMsg(`✓ ${tab.filename} sauvegardé`);
    } catch (err) {
      showToast('Erreur sauvegarde : ' + err.message, 'error');
    }
    return;
  }

  // ── Mode projects/ ────────────────────────────────────────────────────────
  const filename = tab.filename === 'untitled.py'
    ? (prompt('Nom du fichier :', 'script.py') || 'script.py')
    : tab.filename;

  try {
    const r = await fetch(`${API}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    });
    if (!r.ok) throw new Error(await r.text());
    tab.filename = filename;
    tab.projectFile = filename;
    tab.dirty = false;
    state.currentFile = filename;
    state.isDirty = false;
    updateFileUI();
    showToast(`Sauvegardé : ${filename}`, 'success');
    setStatusMsg(`✓ ${filename} sauvegardé`);
  } catch (err) {
    showToast('Erreur sauvegarde : ' + err.message, 'error');
  }
}

async function loadFile(filename) {
  // Vérifier si déjà ouvert
  const existing = state.tabs.find(t => t.projectFile === filename);
  if (existing) { activateTab(existing.id); hideModal(); return; }

  try {
    const r = await fetch(`${API}/api/files/${encodeURIComponent(filename)}`);
    if (!r.ok) throw new Error('Fichier introuvable');
    const data = await r.json();
    const lang = getLanguageFromFilename(filename);
    const tab = createTab(filename, lang, data.content, null, filename);
    activateTab(tab.id);
    hideModal();
    showToast(`Ouvert : ${filename}`, 'success');
  } catch (err) {
    showToast('Erreur chargement : ' + err.message, 'error');
  }
}

async function deleteFile(filename) {
  if (!confirm(`Supprimer "${filename}" ?`)) return;
  try {
    await fetch(`${API}/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    showToast(`Supprimé : ${filename}`, 'success');
    openFileManager();  // Rafraîchir la liste
  } catch (err) {
    showToast('Erreur suppression : ' + err.message, 'error');
  }
}

async function openFileManager() {
  try {
    const r = await fetch(`${API}/api/files`);
    const data = await r.json();
    renderFileList(data.files || []);
    showModal();
  } catch (err) {
    showToast('Impossible de charger les fichiers', 'error');
  }
}

function renderFileList(files) {
  const list = document.getElementById('file-list');
  const empty = document.getElementById('file-list-empty');
  const count = document.getElementById('file-count');

  list.innerHTML = '';
  count.textContent = `${files.length} fichier(s)`;

  if (files.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  files.forEach(f => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <span class="file-item-ext">${f.ext.toUpperCase()}</span>
      <span class="file-item-name">${f.name}</span>
      <span class="file-item-size">${formatSize(f.size)}</span>
      <button class="file-item-del" title="Supprimer" data-name="${f.name}">✕</button>
    `;
    li.addEventListener('click', (e) => {
      if (!e.target.classList.contains('file-item-del')) loadFile(f.name);
    });
    li.querySelector('.file-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFile(f.name);
    });
    list.appendChild(li);
  });
}

// ─── Complétion IA ───────────────────────────────────────────────────────────
function scheduleCompletion() {
  clearTimeout(state.completionTimeout);
  state.completionTimeout = setTimeout(() => {
    if (!state.isStreaming) triggerCompletion();
  }, DEBOUNCE_MS);
}

async function triggerCompletion() {
  const code = state.editor.getValue().trim();
  if (code.length < 10) return;

  const panel = document.getElementById('completion-panel');
  const loading = document.getElementById('completion-loading');
  const content = document.getElementById('completion-content');

  panel.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.textContent = '';

  try {
    const r = await fetch(`${API}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: state.currentLanguage,
        model: state.codeModel,
      }),
    });
    const data = await r.json();
    state.completionText = data.completion || '';
    loading.classList.add('hidden');
    content.textContent = state.completionText || '(aucune suggestion)';
    setStatusMsg('◈ Suggestion IA prête — Tab pour accepter');
  } catch (err) {
    loading.classList.add('hidden');
    content.textContent = `Erreur : ${err.message}`;
  }
}

function acceptCompletion() {
  if (!state.completionText) return;
  const pos = state.editor.getPosition();
  state.editor.executeEdits('vyke-completion', [{
    range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
    text: state.completionText,
  }]);
  rejectCompletion();
  showToast('Complétion insérée ✓', 'success');
}

function rejectCompletion() {
  document.getElementById('completion-panel').classList.add('hidden');
  state.completionText = '';
  document.getElementById('completion-content').textContent = '';
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
async function sendChatMessage() {
  if (state.isStreaming) return;

  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = '';
  state.isStreaming = true;

  document.getElementById('btn-send').disabled = true;

  // Ajouter message utilisateur
  appendChatMessage('user', message);
  state.chatHistory.push({ role: 'user', content: message });

  // Créer bulle Vyke (streaming)
  const { el: msgEl, contentEl } = createVykeMessage();
  contentEl.classList.add('streaming-cursor');

  // Flash visuel : confirme que le contexte vient d'être capturé
  if (state.codeContextEnabled) updateChatContextStrip(true);

  try {
    // Capturer le code au moment exact de l'envoi (version fraîche)
    const editorCode = state.codeContextEnabled && state.editor
      ? state.editor.getValue()
      : '';

    const r = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: state.chatHistory.slice(-16),
        model: state.chatModel,
        current_code:     editorCode,
        current_file:     state.codeContextEnabled ? state.currentFile     : '',
        current_language: state.codeContextEnabled ? state.currentLanguage : '',
      }),
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      contentEl.innerHTML = renderMarkdown(fullText);
      scrollChatToBottom();
    }

    contentEl.classList.remove('streaming-cursor');
    contentEl.innerHTML = renderMarkdown(fullText);
    attachCodeButtons(contentEl);
    state.chatHistory.push({ role: 'assistant', content: fullText });

  } catch (err) {
    contentEl.classList.remove('streaming-cursor');
    contentEl.textContent = `[ERREUR: ${err.message}]`;
    contentEl.style.color = 'var(--neon-pink)';
  }

  state.isStreaming = false;
  document.getElementById('btn-send').disabled = false;
  scrollChatToBottom();
}

function appendChatMessage(role, content) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role === 'user' ? 'user-msg' : 'vyke-msg'}`;
  const prefix = role === 'user' ? '[USER]' : '[VYKE]';
  const cls = role === 'user' ? 'user-prefix' : 'vyke-prefix';
  div.innerHTML = `
    <span class="msg-prefix ${cls}">${prefix}</span>
    <span class="msg-content">${role === 'user' ? escapeHtml(content) : renderMarkdown(content)}</span>
  `;
  messages.appendChild(div);
  scrollChatToBottom();
  return div;
}

function createVykeMessage() {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg vyke-msg';
  const contentEl = document.createElement('span');
  contentEl.className = 'msg-content';
  div.innerHTML = `<span class="msg-prefix vyke-prefix">[VYKE]</span>`;
  div.appendChild(contentEl);
  messages.appendChild(div);
  scrollChatToBottom();
  return { el: div, contentEl };
}

function clearChat() {
  state.chatHistory = [];
  const messages = document.getElementById('chat-messages');
  messages.innerHTML = `
    <div class="chat-msg vyke-msg">
      <span class="msg-prefix vyke-prefix">[VYKE]</span>
      <span class="msg-content">Chat réinitialisé. Je suis prêt pour une nouvelle session.</span>
    </div>
  `;
}

function injectCodeIntoChat() {
  const code = state.editor.getValue().trim();
  if (!code) { showToast('Éditeur vide', 'error'); return; }
  const lang = state.currentLanguage;
  const input = document.getElementById('chat-input');
  const snippet = `Voici mon code ${lang} :\n\`\`\`${lang}\n${code.slice(0, 3000)}\n\`\`\`\n\n`;
  input.value = snippet + input.value;
  input.focus();
  showToast('Code injecté dans le chat ✓', 'success');
}

// ─── Modèles ──────────────────────────────────────────────────────────────────

// Catalogue de tags heuristiques par nom de modèle
const MODEL_TAGS = {
  coder: 'code', code: 'code', starcoder: 'code', codellama: 'code',
  'qwen2.5-coder': 'code', deepseek: 'code', wizard: 'code',
  embed: 'embed', embedding: 'embed', nomic: 'embed',
  'mistral-small': 'chat', mistral: 'chat', llama: 'chat',
  gemma: 'chat', phi: 'chat', mixtral: 'chat', vicuna: 'chat',
  neural: 'chat', orca: 'chat', dolphin: 'chat', hermes: 'chat',
};

function getModelTag(name) {
  const lower = name.toLowerCase();
  for (const [key, tag] of Object.entries(MODEL_TAGS)) {
    if (lower.includes(key)) return tag;
  }
  return 'chat';
}

function getModelSize(name) {
  const m = name.match(/(\d+\.?\d*)([bB])/);
  if (m) {
    const n = parseFloat(m[1]);
    return n >= 20 ? 'large' : null;
  }
  return null;
}

async function fetchModels() {
  try {
    const r = await fetch(`${API}/api/models`);
    const data = await r.json();
    state.chatModel = data.default_chat || data.models?.[0] || 'mistral';
    state.codeModel = data.default_code || data.models?.[0] || 'mistral';
    updateModelToolbar();
  } catch {
    // Silencieux si Ollama non disponible
  }
}

function updateModelToolbar() {
  document.getElementById('tb-code-name').textContent = state.codeModel;
  document.getElementById('tb-chat-name').textContent = state.chatModel;
  document.getElementById('status-model-info').textContent = state.codeModel;
}

// ── Modal sélection de modèles ─────────────────────────────────────────────
let pendingChatModel  = '';
let pendingCodeModel  = '';

async function openModelPicker() {
  pendingChatModel = state.chatModel;
  pendingCodeModel = state.codeModel;

  document.getElementById('modal-models-overlay').classList.remove('hidden');
  await refreshModelList();
}

function closeModelPicker() {
  document.getElementById('modal-models-overlay').classList.add('hidden');
}

async function refreshModelList() {
  const dot  = document.getElementById('model-status-dot');
  const text = document.getElementById('model-status-text');
  const chatList = document.getElementById('model-chat-list');
  const codeList = document.getElementById('model-code-list');

  dot.className  = 'model-status-dot loading';
  text.textContent = 'Connexion à Ollama…';
  chatList.innerHTML = '<div class="model-list-loading">Chargement</div>';
  codeList.innerHTML = '<div class="model-list-loading">Chargement</div>';

  try {
    const r = await fetch(`${API}/api/models`);
    const data = await r.json();
    const models = data.models || [];

    if (models.length === 0) {
      dot.className  = 'model-status-dot offline';
      text.textContent = 'Aucun modèle disponible — lance: ollama pull mistral';
      chatList.innerHTML = '';
      codeList.innerHTML = '';
      return;
    }

    dot.className  = 'model-status-dot online';
    text.textContent = `${models.length} modèle(s) disponible(s)`;

    renderModelCards(chatList, models, 'chat');
    renderModelCards(codeList, models, 'code');

    updateModelFooter();
  } catch (err) {
    dot.className  = 'model-status-dot offline';
    text.textContent = 'Ollama hors ligne — vérifie qu\'il tourne sur localhost:11434';
    chatList.innerHTML = '';
    codeList.innerHTML = '';
  }
}

function renderModelCards(container, models, role) {
  container.innerHTML = '';
  const selected = role === 'chat' ? pendingChatModel : pendingCodeModel;

  // Filtrer : pour complétion, suggérer les modèles code en premier
  const sorted = [...models].sort((a, b) => {
    if (role === 'code') {
      const aCode = getModelTag(a) === 'code';
      const bCode = getModelTag(b) === 'code';
      if (aCode && !bCode) return -1;
      if (!aCode && bCode) return 1;
    }
    // Cacher les modèles d'embedding dans la liste code/chat
    if (getModelTag(a) === 'embed') return 1;
    if (getModelTag(b) === 'embed') return -1;
    return 0;
  });

  sorted.forEach(model => {
    const tag     = getModelTag(model);
    const sizeTag = getModelSize(model);
    const isEmbed = tag === 'embed';
    const isSelected = model === selected;

    const card = document.createElement('div');
    card.className = `model-card ${isSelected ? 'selected' : ''} ${isEmbed ? 'embed-card' : ''}`;
    card.dataset.model = model;
    card.dataset.role  = role;

    // Tags affichés
    let tagsHtml = `<span class="model-card-tag tag-${tag}">${tag.toUpperCase()}</span>`;
    if (sizeTag) tagsHtml += `<span class="model-card-tag tag-large">LARGE</span>`;
    if (isEmbed) tagsHtml += `<span class="model-card-tag tag-embed">EMBEDDING</span>`;

    card.innerHTML = `
      <div class="model-card-radio"></div>
      <div class="model-card-info">
        <span class="model-card-name">${model.split(':')[0]}</span>
        ${tagsHtml}
        ${model.includes(':') ? `<div style="font-size:10px;color:var(--text-dim);margin-top:2px">${model.split(':')[1]}</div>` : ''}
      </div>
    `;

    card.addEventListener('click', () => {
      // Désélectionner les autres
      container.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      if (role === 'chat') pendingChatModel = model;
      else pendingCodeModel = model;
      updateModelFooter();
    });

    container.appendChild(card);
  });
}

function updateModelFooter() {
  const info = document.getElementById('model-footer-info');
  info.textContent =
    `Chat: ${pendingChatModel.split(':')[0]}  ·  Code: ${pendingCodeModel.split(':')[0]}`;
}

function applyModels() {
  state.chatModel = pendingChatModel;
  state.codeModel = pendingCodeModel;
  updateModelToolbar();
  closeModelPicker();
  showToast(`Modèles appliqués ✓`, 'success');
  setStatusMsg(`Chat: ${state.chatModel.split(':')[0]} · Code: ${state.codeModel.split(':')[0]}`);
}

// ─── Run & Terminal ───────────────────────────────────────────────────────────

const RUNNABLE_LANGS = {
  python: 'python3', javascript: 'node', bash: 'bash', sh: 'bash',
};

let terminalExpanded = false;
let runAbortController = null;

async function runCode() {
  const code = state.editor.getValue().trim();
  if (!code) { showToast('Éditeur vide', 'error'); return; }

  const lang = state.currentLanguage;
  if (!RUNNABLE_LANGS[lang]) {
    showToast(`Exécution non supportée pour "${lang}"`, 'error');
    return;
  }

  // Si déjà en cours → annuler
  if (runAbortController) {
    runAbortController.abort();
    runAbortController = null;
    return;
  }

  showTerminal();
  clearTerminal();
  setTerminalRunning(true);
  appendTerminal('info', `▸ Exécution (${RUNNABLE_LANGS[lang]})…\n\n`);

  const startTime = Date.now();
  runAbortController = new AbortController();

  try {
    const stdinData = document.getElementById('stdin-input').value;
    const r = await fetch(`${API}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: lang, stdin_data: stdinData }),
      signal: runAbortController.signal,
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Erreur serveur' }));
      appendTerminal('err', err.detail || 'Erreur inconnue');
      setTerminalRunning(false, 1, 0);
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.t === 'out')        appendTerminal('out', msg.d);
          else if (msg.t === 'err')   appendTerminal('err', msg.d);
          else if (msg.t === 'exit') {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            setTerminalRunning(false, parseInt(msg.d), elapsed);
          }
        } catch { /* ligne JSON incomplète, ignorer */ }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      appendTerminal('err', `\nErreur de connexion : ${err.message}\n`);
      setTerminalRunning(false, 1, ((Date.now() - startTime) / 1000).toFixed(2));
    } else {
      appendTerminal('info', '\n▸ Exécution annulée.\n');
      setTerminalRunning(false, null, null);
    }
  } finally {
    runAbortController = null;
  }
}

function showTerminal() {
  document.getElementById('terminal-panel').classList.remove('hidden');
}

function hideTerminal() {
  document.getElementById('terminal-panel').classList.add('hidden');
  if (runAbortController) { runAbortController.abort(); runAbortController = null; }
}

function clearTerminal() {
  document.getElementById('terminal-output').innerHTML = '';
  const badge = document.getElementById('terminal-exit-badge');
  badge.className = 'hidden';
  document.getElementById('terminal-elapsed').classList.add('hidden');
}

function appendTerminal(type, text) {
  const output = document.getElementById('terminal-output');
  const span = document.createElement('span');
  span.className = `t-${type}`;
  span.textContent = text;
  output.appendChild(span);
  output.scrollTop = output.scrollHeight;
}

function setTerminalRunning(running, exitCode = null, elapsed = null) {
  const dot    = document.getElementById('terminal-run-dot');
  const runBtn = document.getElementById('btn-run');
  const badge  = document.getElementById('terminal-exit-badge');
  const elEl   = document.getElementById('terminal-elapsed');

  if (running) {
    dot.className    = 'running';
    runBtn.textContent = '■ STOP';
    runBtn.classList.add('running');
    badge.className  = 'hidden';
    elEl.classList.add('hidden');
  } else {
    const ok = exitCode === 0;
    dot.className      = exitCode === null ? 'idle' : (ok ? 'success' : 'error');
    runBtn.textContent = '▶ RUN';
    runBtn.classList.remove('running');

    if (exitCode !== null) {
      badge.textContent = ok ? 'EXIT 0' : `EXIT ${exitCode}`;
      badge.className   = `terminal-exit-badge ${ok ? 'exit-ok' : 'exit-err'}`;
    }
    if (elapsed !== null) {
      elEl.textContent = `${elapsed}s`;
      elEl.classList.remove('hidden');
    }
  }
}

function toggleTerminalSize() {
  const panel = document.getElementById('terminal-panel');
  const btn   = document.getElementById('btn-terminal-resize');
  terminalExpanded = !terminalExpanded;
  panel.style.height = terminalExpanded ? '380px' : '200px';
  btn.textContent    = terminalExpanded ? '⇓' : '⇕';
}

function updateTerminalLangBadge() {
  const badge  = document.getElementById('terminal-lang-badge');
  const runner = RUNNABLE_LANGS[state.currentLanguage];
  badge.textContent   = runner || state.currentLanguage;
  badge.style.opacity = runner ? '1' : '0.45';
}

// ─── Statut Ollama ────────────────────────────────────────────────────────────
async function checkOllamaStatus() {
  const el = document.getElementById('status-ollama');
  try {
    const r = await fetch(`${API}/api/health`);
    const data = await r.json();
    if (data.ollama) {
      el.className = 'status-indicator online';
      el.innerHTML = `<span class="status-dot">●</span> OLLAMA`;
    } else {
      el.className = 'status-indicator offline';
      el.innerHTML = `<span class="status-dot">●</span> OLLAMA`;
    }
  } catch {
    el.className = 'status-indicator offline';
    el.innerHTML = `<span class="status-dot">●</span> OLLAMA`;
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setLanguage(lang) {
  state.currentLanguage = lang;
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (tab) tab.language = lang;
  if (state.editor) {
    const model = state.editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, lang);
  }
  document.getElementById('lang-select').value = lang;
  document.getElementById('status-lang').textContent =
    lang.charAt(0).toUpperCase() + lang.slice(1);
  updateTerminalLangBadge();
  updateChatContextStrip(true);
  renderTabsBar();
}

function getLanguageFromFilename(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return EXT_TO_LANG[ext] || 'plaintext';
}

function updateFileUI() {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  const name = tab ? tab.filename : state.currentFile;
  const dirty = tab ? tab.dirty : state.isDirty;
  document.getElementById('current-filename').textContent = name;
  document.getElementById('file-dirty').classList.toggle('hidden', !dirty);
  document.title = `${dirty ? '● ' : ''}${name} — VYKE IDE`;
  renderTabsBar();
  updateChatContextStrip();
}

// ─── Barre de contexte IDE dans le chat ───────────────────────────────────────
function updateChatContextStrip(flash = false) {
  const strip    = document.getElementById('chat-context-strip');
  const fnEl     = document.getElementById('ctx-filename');
  const langEl   = document.getElementById('ctx-lang');
  const linesEl  = document.getElementById('ctx-lines');
  const toggleEl = document.getElementById('btn-toggle-context');

  // Nombre de lignes courant
  const lineCount = state.editor ? state.editor.getModel()?.getLineCount() ?? 0 : 0;
  const plural    = lineCount > 1 ? 's' : '';

  fnEl.textContent   = state.currentFile;
  langEl.textContent = state.currentLanguage;
  linesEl.textContent = `${lineCount} ligne${plural}`;

  // État actif / inactif
  if (state.codeContextEnabled) {
    strip.classList.remove('ctx-off');
    toggleEl.classList.replace('inactive', 'active');
  } else {
    strip.classList.add('ctx-off');
    fnEl.style.color   = 'var(--text-dim)';
    toggleEl.classList.replace('active', 'inactive');
  }
  if (state.codeContextEnabled) fnEl.style.color = '';

  // Flash visuel quand le code a changé
  if (flash && state.codeContextEnabled) {
    strip.classList.remove('ctx-flash');
    // forcer un reflow pour relancer l'animation
    void strip.offsetWidth;
    strip.classList.add('ctx-flash');
    setTimeout(() => strip.classList.remove('ctx-flash'), 700);
  }
}

function toggleCodeContext() {
  state.codeContextEnabled = !state.codeContextEnabled;
  updateChatContextStrip();
  const msg = state.codeContextEnabled
    ? 'Contexte code activé — Vyke voit ton fichier'
    : 'Contexte code désactivé — chat générique';
  showToast(msg, state.codeContextEnabled ? 'success' : '');
  setStatusMsg(msg);
}

function markDirty() {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (tab && !tab.dirty) {
    tab.dirty = true;
    state.isDirty = true;
    updateFileUI();
  }
}

function updateCursorInfo(e) {
  const pos = state.editor.getPosition();
  const info = `Ln ${pos.lineNumber}, Col ${pos.column}`;
  document.getElementById('cursor-info').textContent = info;
  document.getElementById('status-cursor').textContent = info;
}

function scrollChatToBottom() {
  const el = document.getElementById('chat-messages');
  el.scrollTop = el.scrollHeight;
}

function setStatusMsg(msg) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 4000);
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `visible ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = 'hidden', 3000);
}

function showModal() { document.getElementById('modal-overlay').classList.remove('hidden'); }
function hideModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Rendu Markdown minimal (code blocks, gras, italique, inline code)
 */
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Blocs de code ```lang ... ```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const l = lang || 'code';
    return `<div class="code-block-wrapper">
      <button class="btn-copy-code" data-code="${escapeHtml(code).replace(/"/g, '&quot;')}">COPY</button>
      <pre><code class="lang-${l}">${code}</code></pre>
      <button class="btn-insert-code" data-code="${escapeHtml(code).replace(/"/g, '&quot;')}">▶ INSÉRER DANS L'ÉDITEUR</button>
    </div>`;
  });

  // Inline code `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Gras **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italique *...*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Sauts de ligne
  html = html.replace(/\n/g, '<br>');

  return html;
}

function attachCodeButtons(container) {
  container.querySelectorAll('.btn-copy-code').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.code || '')
        .then(() => showToast('Copié dans le presse-papier ✓', 'success'))
        .catch(() => showToast('Erreur copie', 'error'));
    });
  });

  container.querySelectorAll('.btn-insert-code').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code || '';
      const pos = state.editor.getPosition();
      state.editor.executeEdits('vyke-chat', [{
        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text: '\n' + code + '\n',
      }]);
      state.editor.focus();
      showToast('Code inséré dans l\'éditeur ✓', 'success');
    });
  });
}

// ─── Sidebar & Explorateur de fichiers ────────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  state.sidebarOpen = !state.sidebarOpen;
  if (state.sidebarOpen) {
    sidebar.classList.remove('collapsed');
    sidebar.style.width = state.sidebarWidth + 'px';
  } else {
    sidebar.classList.add('collapsed');
  }
}

// ── Resize handle ──────────────────────────────────────────────────────────
let _resizing = false;
let _resizeStartX = 0;
let _resizeStartW = 0;

function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('sidebar');

  handle.addEventListener('mousedown', e => {
    if (!state.sidebarOpen) return;
    _resizing = true;
    _resizeStartX = e.clientX;
    _resizeStartW = sidebar.offsetWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    handle.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!_resizing) return;
    const delta = e.clientX - _resizeStartX;
    const MIN_W = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--sidebar-min-w')) || 160;
    const MAX_W = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--sidebar-max-w')) || 480;
    const newW = Math.max(MIN_W, Math.min(MAX_W, _resizeStartW + delta));
    state.sidebarWidth = newW;
    sidebar.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!_resizing) return;
    _resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    handle.classList.remove('dragging');
  });
}

// ── Arbre de fichiers ──────────────────────────────────────────────────────

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    py: '🐍', js: '⚡', ts: '🔷', jsx: '⚡', tsx: '🔷',
    html: '🌐', css: '🎨', json: '{}', md: '📝',
    sh: '🐚', bash: '🐚', txt: '📄', yml: '⚙', yaml: '⚙',
    toml: '⚙', ini: '⚙', env: '🔑', gitignore: '🚫',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼',
    pdf: '📕', zip: '📦', tar: '📦', gz: '📦',
  };
  return icons[ext] || '📄';
}

function sortTreeItems(items) {
  return [...items].sort((a, b) => {
    const aDir = a.type === 'dir';
    const bDir = b.type === 'dir';
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

async function fetchAndRenderTree(rootPath) {
  const treeEl = document.getElementById('sidebar-tree');
  treeEl.innerHTML = '<div class="tree-loading">Chargement…</div>';

  try {
    const r = await fetch(`${API}/api/browse?path=${encodeURIComponent(rootPath)}`);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();

    treeEl.innerHTML = '';
    if (!data.items || data.items.length === 0) {
      treeEl.innerHTML = '<div class="tree-empty">Dossier vide</div>';
      return;
    }
    renderTreeItems(sortTreeItems(data.items), treeEl, 0);
  } catch (err) {
    treeEl.innerHTML = `<div class="tree-error">⚠ ${err.message}</div>`;
  }
}

function renderTreeItems(items, container, level) {
  items.forEach(item => container.appendChild(createTreeNode(item, level)));
}

function createTreeNode(item, level) {
  const isDir = item.type === 'dir';
  const node = document.createElement('div');
  node.className = `tree-node ${isDir ? 'is-dir' : 'is-file'}`;
  node.dataset.path = item.path;
  node.dataset.level = level;

  const icon = isDir ? '▸' : getFileIcon(item.name);
  node.innerHTML =
    `<span class="tree-node-icon">${icon}</span>` +
    `<span class="tree-node-name">${item.name}</span>`;

  if (isDir) {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (node.classList.contains('open')) {
        collapseTreeNode(node);
      } else {
        expandTreeNode(node);
      }
    });
  } else {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.tree-node.active').forEach(n => n.classList.remove('active'));
      node.classList.add('active');
      openWorkspaceFile(item.path, item.name);
    });
  }

  return node;
}

async function expandTreeNode(node) {
  const path = node.dataset.path;
  const level = parseInt(node.dataset.level);

  node.classList.add('open', 'loading');
  node.querySelector('.tree-node-icon').textContent = '▾';

  try {
    const r = await fetch(`${API}/api/browse?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();

    node.classList.remove('loading');

    const items = sortTreeItems(data.items || []);
    if (items.length === 0) {
      // Dossier vide — insérer un placeholder
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.dataset.parentPath = path;
      empty.textContent = '— vide —';
      node.after(empty);
      return;
    }

    // Insérer les enfants après ce nœud (en ordre inverse pour que after() soit correct)
    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(createTreeNode(item, level + 1)));
    node.after(frag);
  } catch (err) {
    node.classList.remove('open', 'loading');
    node.querySelector('.tree-node-icon').textContent = '▸';
    showToast('Erreur arbre : ' + err.message, 'error');
  }
}

function collapseTreeNode(node) {
  const level = parseInt(node.dataset.level);
  node.classList.remove('open');
  node.querySelector('.tree-node-icon').textContent = '▸';

  // Supprimer tous les nœuds enfants (niveau supérieur) qui suivent
  const treeEl = document.getElementById('sidebar-tree');
  let next = node.nextSibling;
  const toRemove = [];
  while (next) {
    const nextLevel = next.dataset ? parseInt(next.dataset.level) : -1;
    // S'arrêter dès qu'on retrouve un nœud au même niveau ou moins profond
    if (next.classList && next.classList.contains('tree-node') && nextLevel <= level) break;
    // Placeholder de dossier vide : supprimer si son parent est le nœud courant
    if (next.dataset && next.dataset.parentPath === node.dataset.path) {
      toRemove.push(next);
      next = next.nextSibling;
      continue;
    }
    // Nœud enfant
    if (!next.classList || !next.classList.contains('tree-node') || nextLevel > level) {
      toRemove.push(next);
      next = next.nextSibling;
      continue;
    }
    break;
  }
  toRemove.forEach(n => n.remove());
}

// ── Ouvrir un fichier du workspace ─────────────────────────────────────────

async function openWorkspaceFile(relPath, name) {
  // Vérifier si déjà ouvert
  const existing = state.tabs.find(t => t.filePath === relPath);
  if (existing) { activateTab(existing.id); return; }

  try {
    const r = await fetch(`${API}/api/workspace/read?path=${encodeURIComponent(relPath)}`);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();

    const lang = data.language || getLanguageFromFilename(name);
    const tab = createTab(name, lang, data.content, relPath, null);
    activateTab(tab.id);
    showToast(`Ouvert : ${name}`, 'success');
  } catch (err) {
    showToast('Erreur ouverture : ' + err.message, 'error');
  }
}

// ── Nouveau fichier dans le workspace ──────────────────────────────────────

function newWorkspaceFile() {
  const name = prompt('Nom du nouveau fichier :', 'nouveau.py');
  if (!name) return;
  const lang = getLanguageFromFilename(name);
  const tab = createTab(name, lang, '', null, null);
  activateTab(tab.id);
  showToast('Nouveau fichier — Ctrl+S pour sauvegarder', 'success');
}

// ── Modal "Ouvrir un dossier" ──────────────────────────────────────────────

let _browseCurrentPath = '';

function openProjectBrowser() {
  document.getElementById('modal-browse-overlay').classList.remove('hidden');
  _browseCurrentPath = state.projectPath || '';
  browseDirectory(_browseCurrentPath);
}

function closeProjectBrowser() {
  document.getElementById('modal-browse-overlay').classList.add('hidden');
}

async function browseDirectory(path) {
  _browseCurrentPath = path;
  const list   = document.getElementById('modal-browse-list');
  const pathEl = document.getElementById('modal-browse-current-path');

  list.innerHTML = '<div class="browse-loading">Chargement…</div>';

  try {
    const r = await fetch(`${API}/api/browse?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();

    pathEl.textContent = data.abs_path || '~';
    renderBrowseBreadcrumb(data.path || '', data.parent);

    list.innerHTML = '';

    // Bouton ".." si pas à la racine
    if (data.parent !== null && data.parent !== undefined) {
      const upItem = document.createElement('div');
      upItem.className = 'browse-item is-dir';
      upItem.innerHTML = `<span class="browse-item-icon">📁</span> ..`;
      upItem.addEventListener('click', () => browseDirectory(data.parent));
      list.appendChild(upItem);
    }

    const sorted = sortTreeItems(data.items || []);
    sorted.forEach(item => {
      const isDir = item.type === 'dir';
      const div = document.createElement('div');
      div.className = `browse-item ${isDir ? 'is-dir' : 'is-file'}`;
      const icon = isDir ? '📁' : getFileIcon(item.name);
      div.innerHTML = `<span class="browse-item-icon">${icon}</span> ${escapeHtml(item.name)}`;
      if (isDir) {
        div.addEventListener('click', () => browseDirectory(item.path));
      }
      list.appendChild(div);
    });

    if (sorted.length === 0 && data.parent === null) {
      list.innerHTML = '<div class="browse-loading">Espace de travail vide</div>';
    }
  } catch (err) {
    list.innerHTML = `<div style="padding:12px;color:var(--neon-pink)">⚠ ${escapeHtml(err.message)}</div>`;
  }
}

function renderBrowseBreadcrumb(currentPath, parent) {
  const bc = document.getElementById('modal-browse-breadcrumb');
  bc.innerHTML = '';

  const rootSpan = document.createElement('span');
  rootSpan.className = 'breadcrumb-part' + (!currentPath ? ' current' : '');
  rootSpan.textContent = '~';
  if (currentPath) rootSpan.addEventListener('click', () => browseDirectory(''));
  bc.appendChild(rootSpan);

  if (!currentPath) return;

  const segments = currentPath.split('/').filter(Boolean);
  segments.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '/';
    bc.appendChild(sep);

    const crumb = document.createElement('span');
    crumb.className = 'breadcrumb-part' + (i === segments.length - 1 ? ' current' : '');
    crumb.textContent = seg;
    if (i < segments.length - 1) {
      const crumbPath = segments.slice(0, i + 1).join('/');
      crumb.addEventListener('click', () => browseDirectory(crumbPath));
    }
    bc.appendChild(crumb);
  });
}

function selectBrowseFolder() {
  state.projectPath = _browseCurrentPath;
  const pathEl = document.getElementById('modal-browse-current-path');
  const rawName = _browseCurrentPath.split('/').filter(Boolean).pop() || '~';
  const displayName = rawName.toUpperCase();

  document.getElementById('sidebar-project-name').textContent = displayName;
  document.getElementById('sidebar-project-name').title = pathEl.textContent;
  closeProjectBrowser();
  fetchAndRenderTree(state.projectPath);
  showToast(`Projet ouvert : ${rawName}`, 'success');

  // S'assurer que la sidebar est visible
  if (!state.sidebarOpen) toggleSidebar();
}

// ─── Initialisation des événements ───────────────────────────────────────────
function initEventListeners() {
  // Initialiser la barre de contexte
  updateChatContextStrip(false);

  // Initialiser le resize de la sidebar
  initSidebarResize();

  // Toolbar
  document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);
  document.getElementById('btn-save').addEventListener('click', saveFile);
  document.getElementById('btn-complete').addEventListener('click', triggerCompletion);
  document.getElementById('btn-run').addEventListener('click', runCode);
  document.getElementById('btn-new-tab').addEventListener('click', newFile);

  // Sidebar
  document.getElementById('btn-sidebar-close').addEventListener('click', toggleSidebar);
  document.getElementById('btn-sidebar-new').addEventListener('click', newWorkspaceFile);
  document.getElementById('btn-sidebar-open-project').addEventListener('click', openProjectBrowser);

  // Modal browse (Open Project)
  document.getElementById('btn-close-browse').addEventListener('click', closeProjectBrowser);
  document.getElementById('btn-select-folder').addEventListener('click', selectBrowseFolder);
  document.getElementById('modal-browse-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-browse-overlay')) closeProjectBrowser();
  });

  // Contexte IDE dans le chat
  document.getElementById('btn-toggle-context').addEventListener('click', toggleCodeContext);

  // Terminal
  document.getElementById('btn-terminal-clear').addEventListener('click', clearTerminal);
  document.getElementById('btn-terminal-close').addEventListener('click', hideTerminal);
  document.getElementById('btn-terminal-resize').addEventListener('click', toggleTerminalSize);
  document.getElementById('btn-toggle-stdin').addEventListener('click', () => {
    document.getElementById('stdin-panel').classList.toggle('hidden');
  });

  // Sélecteur de langue
  document.getElementById('lang-select').addEventListener('change', e => {
    setLanguage(e.target.value);
  });

  // Modal sélection de modèles
  document.getElementById('btn-model-picker').addEventListener('click', openModelPicker);
  document.getElementById('btn-close-models').addEventListener('click', closeModelPicker);
  document.getElementById('btn-refresh-models').addEventListener('click', refreshModelList);
  document.getElementById('btn-apply-models').addEventListener('click', applyModels);
  document.getElementById('modal-models-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-models-overlay')) closeModelPicker();
  });

  // Chat
  document.getElementById('btn-send').addEventListener('click', sendChatMessage);
  document.getElementById('btn-clear-chat').addEventListener('click', clearChat);
  document.getElementById('btn-inject-code').addEventListener('click', injectCodeIntoChat);

  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
    // Auto-resize textarea
    setTimeout(() => {
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    });
  });

  // Complétion
  document.getElementById('btn-accept-completion').addEventListener('click', acceptCompletion);
  document.getElementById('btn-reject-completion').addEventListener('click', rejectCompletion);

  // Modal fichiers
  document.getElementById('btn-close-modal').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) hideModal();
  });

  // Prévenir fermeture accidentelle
  window.addEventListener('beforeunload', e => {
    if (state.tabs.some(t => t.dirty)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Raccourcis globaux
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      closeTab(state.activeTabId);
    }
    if (e.key === 'Escape') {
      if (!document.getElementById('modal-overlay').classList.contains('hidden')) hideModal();
      if (!document.getElementById('modal-browse-overlay').classList.contains('hidden')) closeProjectBrowser();
      if (!document.getElementById('modal-models-overlay').classList.contains('hidden')) closeModelPicker();
    }
  });
}
