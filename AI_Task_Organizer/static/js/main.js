/* ═══════════════════════════════════════════════════════════
   Config
═══════════════════════════════════════════════════════════ */
const CATEGORY_CONFIG = {
  work:     { label: '仕事',     color: '#6B8FB5' },
  health:   { label: '健康',     color: '#7EA882' },
  life:     { label: '生活',     color: '#B8896A' },
  learning: { label: '学習',     color: '#9580B5' },
  social:   { label: '人間関係', color: '#C48080' },
  admin:    { label: '手続き',   color: '#7A8C9B' },
};

const QUADRANT_CONFIG = {
  q1: { label: '今すぐやる',   importance: 'high', urgency: 'high', color: '#C05050', warnAt: 5 },
  q2: { label: '計画してやる', importance: 'high', urgency: 'low',  color: '#5B8FBF', warnAt: 5 },
  q3: { label: '誰かに任せる', importance: 'low',  urgency: 'high', color: '#B8896A', warnAt: 5 },
  q4: { label: 'やらない',     importance: 'low',  urgency: 'low',  color: '#8E8E93', warnAt: 5 },
};

function taskQuadrant(task) {
  const imp = task.importance === 'high';
  const urg = task.urgency   === 'high';
  if (imp && urg)  return 'q1';
  if (imp && !urg) return 'q2';
  if (!imp && urg) return 'q3';
  return 'q4';
}

function categoryColor(cat) {
  return (CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.life).color;
}
function categoryLabel(cat) {
  return (CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.life).label;
}
function habitColor(h) {
  return h.color || categoryColor(h.category);
}

const HABIT_PALETTE = [
  '#00FFFF','#FF00FF','#FFFF00','#00FF41',
  '#FF003C','#0FF0FC','#FF6600','#BC13FE',
  '#FF1493','#39FF14','#00BFFF','#FF073A',
];

/* ═══════════════════════════════════════════════════════════
   State
═══════════════════════════════════════════════════════════ */
let allTasks        = [];
let currentTaskId   = null;
let drilldownQ      = null;  // 'q1'|'q2'|'q3'|'q4'|null
let tasksSubView    = 'matrix'; // 'matrix' | 'today' | 'project' | 'habit'
let allHabits       = [];

function habitAsTask(h) {
  return {
    id: h.id, title: h.title,
    importance: h.importance || 'high',
    urgency:    h.urgency    || 'low',
    category:   h.category,
    tags:       h.tags || [],
    deadline:   null, roadmap: [], checklist: [],
    completed:  h.today_done === true,
    _isHabit:   true,
  };
}
let isSending       = false;
let isSaving        = false;
let chatMode        = 'task';
let milestoneState  = { type: null, currentStep: 0, isOffTrack: false, noAdvanceCount: 0 };
const chatHistories = { task: [], dump: [] };
const taskChatHistories = {};
let scheduleView    = 'list';
let scheduleRefDate = new Date();
let memoView        = 'tree';
let memoRefDate     = new Date();
let memoSessionsCache = null;
let allProjects     = [];
const projectChatHistories = {};
const projectExpandState   = {};
const phaseExpandState     = {};
const phaseChatHistories   = {};

/* ═══════════════════════════════════════════════════════════
   Offline support
═══════════════════════════════════════════════════════════ */
let isOnline = navigator.onLine;
const LS_OFFLINE_Q   = 'to_offline_q';
const LS_TASKS_CACHE = 'to_tasks_c';

function _loadCachedTasks() {
  try { return JSON.parse(localStorage.getItem(LS_TASKS_CACHE) || 'null'); } catch { return null; }
}
function _saveCachedTasks(tasks) {
  try { localStorage.setItem(LS_TASKS_CACHE, JSON.stringify(tasks)); } catch {}
}
function _getOfflineQ() {
  try { return JSON.parse(localStorage.getItem(LS_OFFLINE_Q) || '[]'); } catch { return []; }
}
function _saveOfflineQ(q) {
  try { localStorage.setItem(LS_OFFLINE_Q, JSON.stringify(q)); } catch {}
}
function _pushOp(op) {
  const q = _getOfflineQ(); q.push(op); _saveOfflineQ(q);
}
function _setOfflineBanner(offline) {
  document.getElementById('offline-banner')?.classList.toggle('hidden', !offline);
}

window.addEventListener('online', async () => {
  isOnline = true;
  _setOfflineBanner(false);
  await _flushOfflineQ();
});
window.addEventListener('offline', () => {
  isOnline = false;
  _setOfflineBanner(true);
});

async function _flushOfflineQ() {
  const q = _getOfflineQ();
  if (!q.length) return;
  _saveOfflineQ([]);
  const idMap = {};
  for (const op of q) {
    try {
      if (op.type === 'create') {
        const res = await fetch('/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.data),
        });
        if (res.ok) { const r = await res.json(); idMap[op.id] = r.id; }
      } else if (op.type === 'update') {
        const rid = idMap[op.id] || op.id;
        if (!rid.startsWith('tmp_'))
          await fetch(`/api/tasks/${rid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op.data) });
      } else if (op.type === 'delete') {
        const rid = idMap[op.id] || op.id;
        if (!rid.startsWith('tmp_')) await fetch(`/api/tasks/${rid}`, { method: 'DELETE' });
      } else if (op.type === 'archive') {
        const rid = idMap[op.id] || op.id;
        if (!rid.startsWith('tmp_')) await fetch(`/api/tasks/${rid}/archive`, { method: 'POST' });
      }
    } catch { /* skip failed op */ }
  }
  try {
    allTasks = await apiFetch('/api/tasks');
    _saveCachedTasks(allTasks);
    renderMatrix();
  } catch {}
}

/* ═══════════════════════════════════════════════════════════
   Chat persistence
═══════════════════════════════════════════════════════════ */
const LS_CHATS      = 'to_chats';
const LS_TASK_CHATS = 'to_task_chats';

function _saveChats() {
  try { localStorage.setItem(LS_CHATS, JSON.stringify(chatHistories)); } catch {}
}
function _saveTaskChats() {
  try { localStorage.setItem(LS_TASK_CHATS, JSON.stringify(taskChatHistories)); } catch {}
}
function _loadChats() {
  try { const s = localStorage.getItem(LS_CHATS); if (s) Object.assign(chatHistories, JSON.parse(s)); } catch {}
  try { const s = localStorage.getItem(LS_TASK_CHATS); if (s) Object.assign(taskChatHistories, JSON.parse(s)); } catch {}
}

/* ═══════════════════════════════════════════════════════════
   Utilities
═══════════════════════════════════════════════════════════ */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function deadlineStatus(iso) {
  if (!iso) return 'none';
  const today = todayStr();
  if (iso < today) return 'overdue';
  if (iso === today) return 'today';
  if (iso <= dateStr(addDays(new Date(), 7))) return 'soon';
  return 'later';
}
function formatDeadlineShort(iso) {
  if (!iso) return '';
  const today = todayStr();
  if (iso === today) return '今日';
  if (iso === dateStr(addDays(new Date(), 1))) return '明日';
  const [, m, d] = iso.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatMarkdown(text) {
  let s = escHtml(text);
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
  s = s.replace(/^### (.+)$/gm, '<strong>$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<strong>$1</strong>');
  s = s.replace(/((?:^[*\-] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[*\-] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  s = s.replace(/\n/g, '<br>');
  return s;
}

/* ═══════════════════════════════════════════════════════════
   API helpers
═══════════════════════════════════════════════════════════ */
function logEvent(taskId, action) {
  fetch('/api/log', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId || '', action }),
  }).catch(() => {});
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadTasks() {
  try {
    allTasks = await apiFetch('/api/tasks');
    _saveCachedTasks(allTasks);
  } catch {
    const cached = _loadCachedTasks();
    if (cached) allTasks = cached;
  }
}

async function createTask(title, importance, urgency, roadmap = [], category = 'life', deadline = null, tags = [], checklist = []) {
  const taskData = { title, importance, urgency, roadmap, category, deadline, tags, checklist };
  if (!isOnline) {
    const tempId = 'tmp_' + Date.now();
    const task = { id: tempId, ...taskData, created_at: new Date().toISOString().slice(0, 19), completed: false, notes: '' };
    allTasks.push(task);
    _saveCachedTasks(allTasks);
    _pushOp({ type: 'create', id: tempId, data: taskData });
    logEvent(tempId, 'task_created');
    return task;
  }
  const task = await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(taskData) });
  allTasks.push(task);
  _saveCachedTasks(allTasks);
  logEvent(task.id, 'task_created');
  return task;
}

async function toggleHabitDone(habitId, done) {
  await apiFetch(`/api/habits/${habitId}/log`, {
    method: 'POST',
    body: JSON.stringify({ date: todayStr(), done }),
  });
  const h = allHabits.find(x => x.id === habitId);
  if (h) {
    h.today_done = done;
    if (h.week_done) h.week_done[todayStr()] = done;
    // サーバーから正確なストリークを取得（+1/-1の楽観的更新は連続日数を誤る）
    const stats = await apiFetch(`/api/habits/${habitId}/stats`);
    h.current_streak = stats.current_streak;
  }
  renderMatrix();
  renderTodayView();
  const habitView = document.getElementById('tasks-view-habit');
  if (habitView && !habitView.classList.contains('hidden')) renderHabitView();
}

async function patchTask(id, data) {
  if (!isOnline) {
    const idx = allTasks.findIndex(t => t.id === id);
    if (idx !== -1) { allTasks[idx] = { ...allTasks[idx], ...data }; _saveCachedTasks(allTasks); _pushOp({ type: 'update', id, data }); return allTasks[idx]; }
    throw new Error('not found');
  }
  const task = await apiFetch(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  const idx = allTasks.findIndex(t => t.id === id);
  if (idx !== -1) allTasks[idx] = task;
  _saveCachedTasks(allTasks);
  return task;
}

function getVisibleTasks() {
  const currentIds = new Set();
  for (const proj of allProjects) {
    for (const ph of (proj.phases || [])) {
      if (ph.current_task_id) currentIds.add(ph.current_task_id);
    }
  }
  return allTasks.filter(t => {
    if (!t.project_id) return true;
    const proj = allProjects.find(p => p.id === t.project_id);
    if (!proj) return true;
    return currentIds.has(t.id);
  });
}

async function loadProjects() {
  try { allProjects = await apiFetch('/api/projects'); } catch { allProjects = []; }
}

async function loadHabits() {
  try { allHabits = await apiFetch('/api/habits'); } catch { allHabits = []; }
}

async function createProject(data) {
  const proj = await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(data) });
  allProjects.push(proj);
  return proj;
}

async function patchProject(id, data) {
  const proj = await apiFetch(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  const idx = allProjects.findIndex(p => p.id === id);
  if (idx !== -1) allProjects[idx] = proj;
  return proj;
}

async function removeProject(id) {
  await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
  allProjects = allProjects.filter(p => p.id !== id);
  allTasks = allTasks.filter(t => t.project_id !== id);
  _saveCachedTasks(allTasks);
}

async function removeTask(id) {
  if (!isOnline) { allTasks = allTasks.filter(t => t.id !== id); _saveCachedTasks(allTasks); _pushOp({ type: 'delete', id }); return; }
  await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
  allTasks = allTasks.filter(t => t.id !== id);
  _saveCachedTasks(allTasks);
}

/* ═══════════════════════════════════════════════════════════
   Matrix rendering
═══════════════════════════════════════════════════════════ */
const QUADRANT_OVERFLOW = 5;

function renderMatrix() {
  const visible = getVisibleTasks();
  const groups  = { q1: [], q2: [], q3: [], q4: [] };
  for (const t of visible) groups[taskQuadrant(t)].push(t);
  for (const h of allHabits) groups[taskQuadrant(habitAsTask(h))].push(habitAsTask(h));

  const allItems = Object.values(groups).flat();
  const total = allItems.length;
  const done  = allItems.filter(t => t.completed).length;
  document.getElementById('task-count').textContent =
    total === 0 ? '' : `${done} / ${total} 件完了`;

  for (const [q, tasks] of Object.entries(groups)) {
    const container = document.getElementById(`cards-${q}`);
    const countEl   = document.getElementById(`qcount-${q}`);
    const quadEl    = document.getElementById(`quadrant-${q}`);
    if (!container) continue;

    container.innerHTML = '';
    countEl.textContent = tasks.length;

    const isOverflow = tasks.length > QUADRANT_OVERFLOW;
    quadEl.classList.toggle('quadrant--overflow', isOverflow);

    // In drilldown mode show all; in normal mode show up to limit
    const limit = drilldownQ ? Infinity : QUADRANT_OVERFLOW;
    const shown = tasks.slice(0, limit);

    if (shown.length === 0) {
      container.innerHTML = '<div class="q-empty">タスクなし</div>';
    } else {
      for (const task of shown) container.appendChild(buildMatrixCard(task));
    }

    // "+N件" indicator when not in drilldown and overflowing
    if (!drilldownQ && tasks.length > QUADRANT_OVERFLOW) {
      const more = document.createElement('div');
      more.className = 'q-more-indicator';
      more.textContent = `+ ${tasks.length - QUADRANT_OVERFLOW}件 (フォーカスで全表示)`;
      container.appendChild(more);
    }
  }
}

function buildMatrixCard(task) {
  const isHabit    = !!task._isHabit;
  const card       = document.createElement('div');
  card.className   = `matrix-card${task.completed ? ' completed' : ''}${!isHabit && task.id === currentTaskId ? ' selected' : ''}${isHabit ? ' habit-card' : ''}`;
  card.dataset.id  = task.id;

  const color      = categoryColor(task.category);
  const doneSteps  = (task.roadmap || []).filter(r => r.done).length;
  const totalSteps = (task.roadmap || []).length;
  const pct        = totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0;
  const dlStatus   = task.deadline ? deadlineStatus(task.deadline) : '';
  const dlHtml     = task.deadline
    ? `<span class="tag-deadline dl-${dlStatus}">${formatDeadlineShort(task.deadline)}</span>` : '';

  const tagsHtml = (task.tags || []).slice(0, 2).map(t =>
    `<span class="tag-item">${escHtml(t)}</span>`
  ).join('');

  const progressHtml = totalSteps > 0 ? `
    <div class="card-progress">
      <span class="card-steps-text">${doneSteps}/${totalSteps}</span>
      <div class="card-progress-bar"><div class="card-progress-fill" style="width:${pct}%"></div></div>
    </div>` : '';

  const habitBadge = isHabit ? `<span class="tag-habit-badge">🔁</span>` : '';

  card.style.setProperty('--card-color', color);
  card.innerHTML = `
    <div class="card-body">
      <input class="task-checkbox" type="checkbox" ${task.completed ? 'checked' : ''}>
      <div class="card-info">
        <div class="card-title">${escHtml(task.title)}</div>
        <div class="card-tags">
          ${habitBadge}
          <span class="tag-category" style="color:${color}">${escHtml(categoryLabel(task.category))}</span>
          ${tagsHtml}
          ${dlHtml}
        </div>
        ${progressHtml}
      </div>
    </div>
  `;

  card.querySelector('.task-checkbox').addEventListener('change', async e => {
    e.stopPropagation();
    if (isHabit) {
      await toggleHabitDone(task.id, e.target.checked);
    } else {
      await patchTask(task.id, { completed: e.target.checked });
      renderMatrix();
      if (currentTaskId === task.id) openDetailPanel(task.id);
    }
  });
  card.addEventListener('click', e => {
    if (e.target.matches('.task-checkbox')) return;
    if (isHabit) return;
    openDetailPanel(task.id);
  });

  return card;
}

/* ═══════════════════════════════════════════════════════════
   Drilldown
═══════════════════════════════════════════════════════════ */
function enterDrilldown(q) {
  drilldownQ = q;
  const cfg = QUADRANT_CONFIG[q];
  document.getElementById('matrix-grid').classList.add('drilldown-active');
  document.querySelectorAll('.quadrant').forEach(el => {
    el.classList.toggle('drilldown-focus',  el.dataset.q === q);
    el.classList.toggle('drilldown-hidden', el.dataset.q !== q);
  });
  document.getElementById('matrix-drilldown-bar').classList.remove('hidden');
  document.getElementById('drilldown-label').textContent = cfg.label;
  renderMatrix();
}

function exitDrilldown() {
  drilldownQ = null;
  document.getElementById('matrix-grid').classList.remove('drilldown-active');
  document.querySelectorAll('.quadrant').forEach(el => {
    el.classList.remove('drilldown-focus', 'drilldown-hidden');
  });
  document.getElementById('matrix-drilldown-bar').classList.add('hidden');
  renderMatrix();
}

/* ═══════════════════════════════════════════════════════════
   Tasks sub-view (matrix / today)
═══════════════════════════════════════════════════════════ */
function switchTasksSubView(view) {
  if (tasksSubView === view) return;
  tasksSubView = view;

  document.querySelectorAll('.tasks-subtab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tasksView === view)
  );
  document.getElementById('tasks-view-matrix').classList.toggle('hidden',  view !== 'matrix');
  document.getElementById('tasks-view-today').classList.toggle('hidden',   view !== 'today');
  document.getElementById('tasks-view-project').classList.toggle('hidden', view !== 'project');
  document.getElementById('tasks-view-habit').classList.toggle('hidden',   view !== 'habit');

  const addTaskBtn = document.getElementById('btn-add-task');
  if (addTaskBtn) addTaskBtn.classList.toggle('hidden', view === 'project' || view === 'habit');

  if (view === 'today')   renderTodayView();
  if (view === 'project') renderProjectView();
  if (view === 'habit')   renderHabitView();
  if (view === 'matrix' && drilldownQ) exitDrilldown();
}

function getWeekDays() {
  const today      = new Date();
  const todayIso   = todayStr();
  const dayOfWeek  = today.getDay(); // 0=日
  const mondayDiff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday     = new Date(today);
  monday.setDate(today.getDate() + mondayDiff);
  const labels = ['月', '火', '水', '木', '金'];
  return labels.map((label, i) => {
    const d   = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return { iso, label, isToday: iso === todayIso, isFuture: iso > todayIso };
  });
}

function buildHabitSquares(h, weekDays, skipToday = false) {
  const color = habitColor(h);
  return weekDays
    .filter(day => !(skipToday && day.isToday))
    .map(day => {
      const done   = h.week_done?.[day.iso];
      const isDone = done === true;
      const cls    = [
        'hg-sq',
        isDone       ? 'done'   : '',
        day.isToday  ? 'today'  : '',
        day.isFuture ? 'future' : '',
      ].filter(Boolean).join(' ');
      const attrs = day.isToday ? `data-habit-id="${h.id}" data-date="${day.iso}"` : '';
      return `<button class="${cls}" ${attrs} style="--card-color:${color}" title="${day.iso}"></button>`;
    }).join('');
}

function renderHabitView() {
  const container = document.getElementById('habit-list');
  if (!container) return;

  if (allHabits.length === 0) {
    container.innerHTML = `
      <div class="project-empty">
        <div class="project-empty-icon">🔁</div>
        <p>習慣がありません</p>
        <p class="project-empty-hint">チャットで「毎日〜したい」と話しかけると<br>AIが一緒に習慣を登録してくれます</p>
        <button class="btn-primary" id="btn-go-chat-habit" style="margin-top:16px">チャットで習慣を作る</button>
      </div>`;
    document.getElementById('btn-go-chat-habit')?.addEventListener('click', () => {
      switchTab('chat'); switchChatMode('task'); resetChat();
    });
    return;
  }

  const weekDays = getWeekDays();

  const headerCells = weekDays.map(d =>
    `<div class="hg-header-cell${d.isToday ? ' hg-header-today' : ''}">${d.label}</div>`
  ).join('');

  const paletteSwatches = HABIT_PALETTE.map(c =>
    `<button class="hg-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`
  ).join('');

  const rowsHtml = allHabits.map(h => {
    const color  = habitColor(h);
    const streak = h.current_streak || 0;
    return `
      <div class="hg-row" data-habit-id="${h.id}" style="--card-color:${color}">
        <div class="hg-title-cell">
          <div class="hg-title-info">
            <span class="hg-title">${escHtml(h.title)}</span>
            ${streak > 0 ? `<span class="habit-streak-badge">🔥 ${streak}日</span>` : ''}
          </div>
          <div class="hg-actions">
            <details class="hg-palette-details" data-habit-id="${h.id}">
              <summary class="hg-palette-btn" title="色を変更">
                <span class="hg-palette-dot" style="background:${color}"></span>
              </summary>
              <div class="hg-palette-popup">${paletteSwatches}</div>
            </details>
            <button class="hg-delete-btn" data-habit-id="${h.id}" title="削除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>
        <div class="hg-squares">${buildHabitSquares(h, weekDays)}</div>
      </div>`;
  }).join('');

  const analyticsHtml = allHabits.map(h => {
    const color    = habitColor(h);
    const streak   = h.current_streak || 0;
    const rate     = h.rate_30d != null ? Math.round(h.rate_30d * 100) : 0;
    return `
      <div class="habit-analytics-item" data-habit-id="${h.id}" style="--card-color:${color}">
        <div class="habit-analytics-header">
          <span class="habit-analytics-name">${escHtml(h.title)}</span>
          <span class="habit-analytics-stats">
            ${streak > 0 ? `<span class="ha-streak">🔥 ${streak}日連続</span>` : ''}
            <span class="ha-rate">${rate}%<span class="ha-rate-label"> / 30日</span></span>
          </span>
        </div>
        <div class="habit-rate-bar">
          <div class="habit-rate-fill" style="width:${rate}%;background:${color}"></div>
        </div>
        <div class="habit-heatmap" id="heatmap-${h.id}">
          <span class="heatmap-loading">…</span>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="habit-grid">
      <div class="hg-header">
        <div class="hg-title-cell"></div>
        <div class="hg-squares">${headerCells}</div>
      </div>
      ${rowsHtml}
    </div>
    <div class="habit-analytics-section">
      <div class="habit-analytics-title">アナリティクス</div>
      <div class="habit-analytics-list">${analyticsHtml}</div>
    </div>`;

  // ヒートマップを非同期で読み込む
  allHabits.forEach(h => loadHabitHeatmap(h));
}

async function loadHabitHeatmap(habit) {
  const el = document.getElementById(`heatmap-${habit.id}`);
  if (!el) return;
  try {
    const logs = await apiFetch(`/api/habits/${habit.id}/logs?days=60`);
    const logMap = {};
    logs.forEach(l => { logMap[l.date] = l.done; });

    const color = habitColor(habit);
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();           // 0-indexed
    const todayIso = isoDate(now);

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // 月初の曜日 (月曜=0 … 日曜=6)
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;

    const cells = [];

    // 月初前の空白セル（習慣の色で塗りつぶす）
    for (let i = 0; i < firstDow; i++) {
      cells.push(`<span class="hm-cell hm-pad" style="background:${color}"></span>`);
    }

    // 当月の各日
    for (let d = 1; d <= daysInMonth; d++) {
      const iso     = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const done    = logMap[iso];
      const future  = iso > todayIso;
      const isToday = iso === todayIso;
      let bg;
      if (future)           bg = 'var(--glass)';
      else if (done === true)  bg = color;
      else if (done === false) bg = 'var(--glass-border)';
      else                     bg = 'var(--glass)';
      const cls = ['hm-cell', future ? 'hm-future' : '', isToday ? 'hm-today' : ''].filter(Boolean).join(' ');
      cells.push(`<span class="${cls}" style="background:${bg}" title="${iso}"></span>`);
    }

    // 末尾の空白セル（最終行を7マスに揃える、習慣の色で塗りつぶす）
    const rem = cells.length % 7;
    if (rem) for (let i = 0; i < 7 - rem; i++) cells.push(`<span class="hm-cell hm-pad" style="background:${color}"></span>`);

    el.innerHTML = cells.join('');
  } catch {
    el.innerHTML = '';
  }
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderTodayView() {
  const container = document.getElementById('today-content');
  if (!container) return;

  const today    = todayStr();
  const visible  = getVisibleTasks();
  const overdue  = visible.filter(t => !t.completed && t.deadline && t.deadline < today)
                          .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const dueToday = visible.filter(t => !t.completed && t.deadline === today);
  const q1Others = visible.filter(t => !t.completed &&
                                       t.importance === 'high' && t.urgency === 'high' &&
                                       (!t.deadline || t.deadline > today));

  container.innerHTML = '';

  const todayHabits = allHabits.map(habitAsTask);

  if (overdue.length === 0 && dueToday.length === 0 && q1Others.length === 0 && todayHabits.length === 0) {
    container.innerHTML = `
      <div class="today-empty">
        <div class="today-empty-icon">✓</div>
        <p>今日やるべきタスクはありません</p>
      </div>`;
    return;
  }

  const sections = [
    { key: 'overdue',   label: '期限切れ',            tasks: overdue,      accent: '#C05050' },
    { key: 'today',     label: '今日が期限',           tasks: dueToday,     accent: '#C07000' },
    { key: 'q1-others', label: '今すぐやるべきタスク', tasks: q1Others,     accent: '#6B8FB5' },
    { key: 'habits',    label: '今日の習慣',           tasks: todayHabits,  accent: '#5B9BD5' },
  ];

  for (const sec of sections) {
    if (sec.tasks.length === 0) continue;
    const wrap = document.createElement('div');
    wrap.className = 'today-section';

    const header = document.createElement('div');
    header.className = 'today-section-header';
    header.innerHTML = `
      <span class="today-section-pip" style="background:${sec.accent}"></span>
      <span class="today-section-label">${sec.label}</span>
      <span class="today-section-count">${sec.tasks.length}</span>
    `;
    wrap.appendChild(header);

    for (const task of sec.tasks) {
      wrap.appendChild(buildTodayCard(task));
    }
    container.appendChild(wrap);
  }
}

function buildTodayCard(task) {
  const isHabit    = !!task._isHabit;
  const color      = categoryColor(task.category);
  const doneSteps  = (task.roadmap || []).filter(r => r.done).length;
  const totalSteps = (task.roadmap || []).length;
  const pct        = totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0;
  const dlStatus   = task.deadline ? deadlineStatus(task.deadline) : '';

  const card = document.createElement('div');
  card.className = `today-card${!isHabit && task.id === currentTaskId ? ' selected' : ''}${isHabit ? ' habit-card' : ''}`;
  card.dataset.id = task.id;
  card.style.setProperty('--card-color', color);

  card.innerHTML = `
    <div class="card-body">
      <input class="task-checkbox" type="checkbox" ${task.completed ? 'checked' : ''}>
      <div class="card-info">
        <div class="card-title">${escHtml(task.title)}</div>
        <div class="card-tags">
          ${isHabit ? '<span class="tag-habit-badge">🔁</span>' : ''}
          <span class="tag-category" style="color:${color}">${escHtml(categoryLabel(task.category))}</span>
          ${task.deadline ? `<span class="tag-deadline dl-${dlStatus}">${escHtml(task.deadline)}</span>` : ''}
        </div>
        ${totalSteps > 0 ? `
        <div class="card-progress">
          <span class="card-steps-text">${doneSteps}/${totalSteps}</span>
          <div class="card-progress-bar"><div class="card-progress-fill" style="width:${pct}%"></div></div>
        </div>` : ''}
      </div>
    </div>
  `;

  card.querySelector('.task-checkbox').addEventListener('change', async e => {
    e.stopPropagation();
    if (isHabit) {
      await toggleHabitDone(task.id, e.target.checked);
    } else {
      await patchTask(task.id, { completed: e.target.checked });
      renderMatrix();
      renderTodayView();
      if (currentTaskId === task.id) openDetailPanel(task.id);
    }
  });
  card.addEventListener('click', e => {
    if (e.target.matches('.task-checkbox')) return;
    if (isHabit) return;
    openDetailPanel(task.id);
  });

  return card;
}

/* ═══════════════════════════════════════════════════════════
   Project View
═══════════════════════════════════════════════════════════ */
function renderProjectView() {
  const list = document.getElementById('project-list');
  if (!list) return;
  list.innerHTML = '';

  if (allProjects.length === 0) {
    list.innerHTML = `
      <div class="project-empty">
        <div class="project-empty-icon">◎</div>
        <p>プロジェクトがありません</p>
        <p class="project-empty-hint">チャットで「〜ヶ月で〜したい」と話しかけると<br>AIが一緒に計画を立ててくれます</p>
      </div>`;
    return;
  }
  for (const proj of allProjects) list.appendChild(buildProjectCard(proj));
}

function buildProjectCard(proj) {
  const color  = categoryColor(proj.category);
  const phases = proj.phases || [];
  const doneN  = phases.filter(p => p.done).length;
  const pct    = phases.length > 0 ? Math.round(doneN / phases.length * 100) : 0;
  const dlStr  = proj.deadline ? `〜${proj.deadline.slice(5).replace('-', '/')}` : '';

  // Milestone fill: up to last done dot position
  const fillPct = phases.length > 1 && doneN > 0
    ? ((doneN - 1) / (phases.length - 1)) * 100
    : (phases.length === 1 && doneN === 1 ? 100 : 0);

  // Collapse state: auto-expand only when 1 project exists
  if (projectExpandState[proj.id] === undefined) {
    projectExpandState[proj.id] = allProjects.length === 1;
  }
  const isExpanded = projectExpandState[proj.id];

  const card = document.createElement('div');
  card.className = 'project-card';
  card.dataset.id = proj.id;
  card.style.setProperty('--card-color', color);

  // ── Header ──────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'project-card-header';
  header.innerHTML = `
    <div class="project-header-left">
      <span class="project-cat-pip" style="background:${color}"></span>
      <div>
        <div class="project-title">${escHtml(proj.title)}</div>
        <div class="project-goal">${escHtml(proj.goal)}</div>
      </div>
    </div>
    <div class="project-header-right">
      <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(categoryLabel(proj.category))}</span>
      ${dlStr ? `<span class="project-deadline">${dlStr}</span>` : ''}
      <span class="project-pct-badge">${pct}%</span>
      <button class="project-toggle-btn" title="すべてのフェーズを展開">${isExpanded ? '▴' : '▾'}</button>
      <button class="project-delete-btn" title="削除">×</button>
    </div>
  `;
  card.appendChild(header);

  // ── Milestone bar ────────────────────────────────────────
  const mbar = document.createElement('div');
  mbar.className = 'milestone-bar';
  mbar.style.setProperty('--card-color', color);
  mbar.innerHTML = `
    <div class="milestone-dots-wrap">
      <div class="milestone-track" style="background:linear-gradient(to right,${color} ${fillPct}%,rgba(0,0,0,0.10) ${fillPct}%)"></div>
      <div class="milestone-dots"></div>
    </div>`;
  const dotsRow = mbar.querySelector('.milestone-dots');
  phases.forEach((ph, i) => {
    const isCurr = !ph.done && phases.slice(0, i).every(p => p.done);
    const status = ph.done ? 'done' : isCurr ? 'current' : 'pending';
    const dot = document.createElement('div');
    dot.className = `milestone-dot ${status}`;
    dot.innerHTML = `<span class="mdot"></span><span class="mlabel">${escHtml(ph.text)}</span>`;
    dot.addEventListener('click', () => onMilestoneDotClick(card, proj, ph, phases));
    dotsRow.appendChild(dot);
  });
  card.appendChild(mbar);

  // ── Phases body (collapsible) ────────────────────────────
  const phasesBody = document.createElement('div');
  phasesBody.className = `project-phases-body${isExpanded ? '' : ' hidden'}`;

  phases.forEach((ph, i) => {
    const isCurr = !ph.done && phases.slice(0, i).every(p => p.done);
    const status = ph.done ? 'done' : isCurr ? 'current' : 'pending';
    const icon   = ph.done ? '✓' : isCurr ? '●' : '○';
    const phKey  = `${proj.id}_${ph.id}`;
    if (phaseExpandState[phKey] === undefined) {
      // プロジェクトが1つのときは現在進行中フェーズを自動展開
      phaseExpandState[phKey] = allProjects.length === 1 && status === 'current';
    }
    const isPhOpen = phaseExpandState[phKey];

    const phEl = document.createElement('div');
    phEl.className = `phase-item phase-${status}`;
    phEl.dataset.phaseId = ph.id;

    const phRow = document.createElement('div');
    phRow.className = 'phase-row';
    phRow.innerHTML = `
      <button class="phase-check-btn" ${ph.done ? 'disabled' : ''} title="${ph.done ? '完了済み' : 'フェーズを完了にする'}">${icon}</button>
      <span class="phase-text">${escHtml(ph.text)}</span>
      <span class="phase-badge phase-badge-${status}">${status === 'done' ? '完了' : status === 'current' ? '進行中' : '未着手'}</span>
      <button class="phase-detail-toggle">${isPhOpen ? '▴' : '▾'}</button>
    `;
    phEl.appendChild(phRow);

    const phDetail = document.createElement('div');
    phDetail.className = `phase-detail${isPhOpen ? '' : ' hidden'}`;
    if (isPhOpen) renderPhaseDetail(phDetail, proj, ph, status);
    phEl.appendChild(phDetail);
    phasesBody.appendChild(phEl);

    phRow.querySelector('.phase-check-btn').addEventListener('click', async () => {
      if (ph.done) return;
      if (!confirm(`「${ph.text}」フェーズを完了にしますか？`)) return;
      const fresh   = allProjects.find(p => p.id === proj.id) || proj;
      const updated = fresh.phases.map(p => p.id === ph.id ? { ...p, done: true } : p);
      const nextIdx = updated.findIndex(p => !p.done);
      await patchProject(proj.id, { phases: updated, current_phase: nextIdx === -1 ? updated.length : nextIdx });
      renderProjectView();
    });

    phRow.querySelector('.phase-detail-toggle').addEventListener('click', () => {
      phaseExpandState[phKey] = !phaseExpandState[phKey];
      phRow.querySelector('.phase-detail-toggle').textContent = phaseExpandState[phKey] ? '▴' : '▾';
      phDetail.classList.toggle('hidden', !phaseExpandState[phKey]);
      if (phaseExpandState[phKey]) {
        const freshProj = allProjects.find(p => p.id === proj.id) || proj;
        const freshPh   = freshProj.phases.find(p => p.id === ph.id) || ph;
        renderPhaseDetail(phDetail, freshProj, freshPh, status);
      } else {
        phDetail.innerHTML = '';
      }
    });
  });

  card.appendChild(phasesBody);

  // ── Toggle all phases ────────────────────────────────────
  header.querySelector('.project-toggle-btn').addEventListener('click', () => {
    projectExpandState[proj.id] = !projectExpandState[proj.id];
    const nowOpen = projectExpandState[proj.id];
    header.querySelector('.project-toggle-btn').textContent = nowOpen ? '▴' : '▾';
    phasesBody.classList.toggle('hidden', !nowOpen);
    if (nowOpen) {
      const freshProj = allProjects.find(p => p.id === proj.id) || proj;
      phasesBody.querySelectorAll('.phase-item').forEach((phEl, i) => {
        const phId   = phEl.dataset.phaseId;
        const ph     = freshProj.phases.find(p => p.id === phId);
        if (!ph) return;
        const phKey  = `${proj.id}_${phId}`;
        const isCurr = !ph.done && freshProj.phases.slice(0, i).every(p => p.done);
        const status = ph.done ? 'done' : isCurr ? 'current' : 'pending';
        phaseExpandState[phKey] = true;
        const detail = phEl.querySelector('.phase-detail');
        const toggle = phEl.querySelector('.phase-detail-toggle');
        if (toggle) toggle.textContent = '▴';
        if (detail) { detail.classList.remove('hidden'); renderPhaseDetail(detail, freshProj, ph, status); }
      });
    }
  });

  // ── Delete ───────────────────────────────────────────────
  header.querySelector('.project-delete-btn').addEventListener('click', async () => {
    if (!confirm(`「${proj.title}」を削除しますか？`)) return;
    await removeProject(proj.id);
    renderProjectView();
    renderMatrix();
    renderTodayView();
  });

  return card;
}

function onMilestoneDotClick(card, proj, ph, phases) {
  // フェーズボディを展開
  projectExpandState[proj.id] = true;
  const phasesBody = card.querySelector('.project-phases-body');
  const toggleBtn  = card.querySelector('.project-toggle-btn');
  if (phasesBody) phasesBody.classList.remove('hidden');
  if (toggleBtn)  toggleBtn.textContent = '▴';

  const freshProj = allProjects.find(p => p.id === proj.id) || proj;

  // 全フェーズを閉じてから、押下したフェーズだけ開く
  card.querySelectorAll('.phase-item').forEach(phEl => {
    const phId  = phEl.dataset.phaseId;
    const phKey = `${proj.id}_${phId}`;
    const isTarget = phId === ph.id;
    phaseExpandState[phKey] = isTarget;
    const detail = phEl.querySelector('.phase-detail');
    const toggle = phEl.querySelector('.phase-detail-toggle');
    if (detail) {
      detail.classList.toggle('hidden', !isTarget);
      if (isTarget) {
        const phIdx  = phases.findIndex(p => p.id === phId);
        const target = phases[phIdx];
        const isCurr = target && !target.done && phases.slice(0, phIdx).every(p => p.done);
        const status = target?.done ? 'done' : isCurr ? 'current' : 'pending';
        const freshPh = freshProj.phases.find(p => p.id === phId) || ph;
        renderPhaseDetail(detail, freshProj, freshPh, status);
      } else {
        detail.innerHTML = '';
      }
    }
    if (toggle) toggle.textContent = isTarget ? '▴' : '▾';
  });
}

function renderPhaseDetail(container, proj, ph, status) {
  container.innerHTML = '';

  const currentTask = ph.current_task_id
    ? allTasks.find(t => t.id === ph.current_task_id)
    : null;

  if (currentTask) {
    const tColor     = categoryColor(currentTask.category);
    const doneSteps  = (currentTask.roadmap || []).filter(r => r.done).length;
    const totalSteps = (currentTask.roadmap || []).length;
    const taskPct    = totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0;
    const taskCard   = document.createElement('div');
    taskCard.className = `phase-task-card${currentTask.completed ? ' completed' : ''}`;
    taskCard.style.setProperty('--card-color', tColor);
    taskCard.innerHTML = `
      <div class="phase-task-header">
        <span class="phase-task-label">${currentTask.completed ? '✓ 完了済み' : '▶ 現在のタスク'}</span>
        <button class="phase-task-open">詳細 →</button>
      </div>
      <div class="phase-task-title">${escHtml(currentTask.title)}</div>
      ${totalSteps > 0 ? `
      <div class="phase-task-progress">
        <span class="phase-task-steps">${doneSteps}/${totalSteps}</span>
        <div class="phase-task-bar"><div class="phase-task-fill" style="width:${taskPct}%;background:${tColor}"></div></div>
        <span class="phase-task-pct">${taskPct}%</span>
      </div>` : ''}
    `;
    taskCard.querySelector('.phase-task-open').addEventListener('click', e => {
      e.stopPropagation(); switchTab('tasks'); setTimeout(() => openDetailPanel(currentTask.id), 60);
    });
    container.appendChild(taskCard);
  }

  // チャットボタンは「現在進行中フェーズ」のみ表示
  if (status !== 'current') return;

  const phChatKey = `${proj.id}_${ph.id}`;
  if (!phaseChatHistories[phChatKey]) phaseChatHistories[phChatKey] = [];
  const chatLabel = !currentTask ? '✦ このフェーズのタスクをAIと決める'
    : currentTask.completed     ? '✦ 次のタスクをAIと決める'
    :                             '✦ このタスクについてAIに相談する';

  const chatSection = document.createElement('div');
  chatSection.className = 'phase-chat-section';
  const chatBtn = document.createElement('button');
  chatBtn.className = 'btn-phase-chat';
  chatBtn.textContent = chatLabel;
  chatSection.appendChild(chatBtn);
  const chatBody = document.createElement('div');
  chatBody.className = `phase-chat-body${phaseChatHistories[phChatKey].length ? '' : ' hidden'}`;
  chatBody.innerHTML = `
    <div class="phase-chat-messages"></div>
    <div class="phase-chat-input-row">
      <input class="phase-chat-input" type="text" placeholder="状況を教えてください..." autocomplete="off">
      <button class="phase-chat-send" title="送信">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 7L13 7M13 7L8 2M13 7L8 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;
  chatSection.appendChild(chatBody);
  container.appendChild(chatSection);

  const chatMsgsEl = chatBody.querySelector('.phase-chat-messages');
  const chatInput  = chatBody.querySelector('.phase-chat-input');
  const chatSend   = chatBody.querySelector('.phase-chat-send');

  phaseChatHistories[phChatKey].forEach(m => appendPhaseMsg(chatMsgsEl, m.role, m.content, []));

  chatBtn.addEventListener('click', () => {
    chatBody.classList.toggle('hidden');
    if (!chatBody.classList.contains('hidden')) chatInput.focus();
  });

  async function sendPhaseMsg(text) {
    if (!text.trim() || chatSend.disabled) return;
    chatSend.disabled = true; chatInput.value = '';
    phaseChatHistories[phChatKey].push({ role: 'user', content: text });
    appendPhaseMsg(chatMsgsEl, 'user', text, []);
    const typing = document.createElement('div');
    typing.className = 'dp-chat-typing'; typing.innerHTML = '<span></span><span></span><span></span>';
    chatMsgsEl.appendChild(typing); chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
    try {
      const res  = await fetch(`/api/projects/${proj.id}/phases/${ph.id}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: phaseChatHistories[phChatKey] }),
      });
      const data = await res.json();
      typing.remove();
      phaseChatHistories[phChatKey].push({ role: 'assistant', content: data.response });
      appendPhaseMsg(chatMsgsEl, 'assistant', data.response, data.task_proposals || []);
    } catch {
      typing.remove();
      appendPhaseMsg(chatMsgsEl, 'assistant', 'エラーが発生しました。もう一度お試しください。', []);
    }
    chatSend.disabled = false; chatInput.focus();
  }
  chatSend.addEventListener('click', () => sendPhaseMsg(chatInput.value.trim()));
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendPhaseMsg(chatInput.value.trim()); });
}

function appendPhaseMsg(container, role, content, taskProposals) {
  const el = document.createElement('div');
  el.className = `dp-chat-msg ${role}`;
  const proposalsHtml = taskProposals.map(tp => buildPhaseTaskProposalHtml(tp)).join('');
  el.innerHTML = `<div class="dp-chat-bubble">${
    role === 'assistant' ? formatMarkdown(content) : escHtml(content).replace(/\n/g, '<br>')
  }</div>${proposalsHtml}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function buildPhaseTaskProposalHtml(task) {
  const color    = categoryColor(task.category);
  const catLabel = categoryLabel(task.category);
  const steps    = (task.roadmap   || []).map((r, i) => `
    <div class="proposal-step"><span class="step-num">${i+1}</span><span>${escHtml(r.text)}</span></div>`).join('');
  const checks   = (task.checklist || []).map(c => `
    <div class="proposal-check"><span class="check-icon">□</span><span>${escHtml(c.text)}</span></div>`).join('');
  return `
    <div class="task-proposal" data-task='${escHtml(JSON.stringify(task))}' data-phase-proposal="1" style="--card-color:${color}">
      <div class="proposal-header">
        <span class="proposal-pip" style="background:${color}"></span>
        <span class="proposal-title">${escHtml(task.title)}</span>
        <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(catLabel)}</span>
      </div>
      ${steps  ? `<div class="proposal-steps">${steps}</div>`  : ''}
      ${checks ? `<div class="proposal-checks">${checks}</div>` : ''}
      <div class="proposal-actions">
        <button class="btn-primary btn-confirm-phase-task">タスクを作成する</button>
        <button class="btn-ghost  btn-modify-phase-task">修正する</button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   Detail Panel
═══════════════════════════════════════════════════════════ */
function openDetailPanel(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  logEvent(taskId, 'sidebar_open');
  currentTaskId = taskId;
  document.querySelectorAll('.matrix-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.id === taskId)
  );
  renderDetailPanelBody(task);
  document.getElementById('detail-panel').classList.add('open');
}

function closeDetailPanel() {
  if (currentTaskId) logEvent(currentTaskId, 'sidebar_close');
  currentTaskId = null;
  document.getElementById('detail-panel').classList.remove('open');
  document.querySelectorAll('.matrix-card').forEach(c => c.classList.remove('selected'));
}

function renderDetailPanelBody(task) {
  const body     = document.getElementById('detail-panel-body');
  const color    = categoryColor(task.category);
  const catLabel = categoryLabel(task.category);
  const quad     = taskQuadrant(task);
  const qConf    = QUADRANT_CONFIG[quad];

  const roadmapItems = task.roadmap || [];
  const doneCount    = roadmapItems.filter(r => r.done).length;
  const totalCount   = roadmapItems.length;
  const progressPct  = totalCount ? Math.round(doneCount / totalCount * 100) : 0;

  const dlStatus = deadlineStatus(task.deadline);
  const dlLabelMap = { overdue: '期限切れ', today: '今日まで', soon: '期限間近', later: '期限 ' + (task.deadline ? formatDeadlineShort(task.deadline) : ''), none: null };
  const dlBadge  = dlLabelMap[dlStatus] ? `<span class="dp-dl-badge dp-dl-badge--${dlStatus}">${dlLabelMap[dlStatus]}</span>` : '';

  const roadmapHtml = roadmapItems.map((item, i) => `
    <div class="roadmap-item" data-rid="${escHtml(item.id)}">
      <span class="roadmap-num ${item.done ? 'done' : ''}" style="border-color:${color}40;color:${item.done ? color : 'var(--text-tertiary)'}">${i + 1}</span>
      <input type="checkbox" ${item.done ? 'checked' : ''}>
      <span class="roadmap-text ${item.done ? 'done' : ''}">${escHtml(item.text)}</span>
      <button class="roadmap-edit" title="編集">✎</button>
      <button class="roadmap-delete" title="削除">×</button>
    </div>
  `).join('') || '<div class="empty-state-sm">ステップがありません</div>';

  const checklistHtml = (task.checklist || []).map(item => `
    <div class="checklist-item" data-cid="${escHtml(item.id)}">
      <input type="checkbox" ${item.done ? 'checked' : ''}>
      <span class="checklist-text ${item.done ? 'done' : ''}">${escHtml(item.text)}</span>
      <button class="checklist-delete" title="削除">×</button>
    </div>
  `).join('') || '<div class="empty-state-sm">準備物がありません</div>';

  const tagsHtml = (task.tags || []).map(t =>
    `<span class="tag-pill" style="background:${color}15;border-color:${color}35;color:${color}">${escHtml(t)}<button class="tag-remove" data-tag="${escHtml(t)}">×</button></span>`
  ).join('');

  body.innerHTML = `
    <!-- ── Header ───────────────────────────────────────────── -->
    <div class="dp-header" style="--cat-color:${color};--q-color:${qConf.color}">
      <div class="dp-header-stripe"></div>
      <div class="dp-header-content">
        <div class="dp-header-badges">
          <span class="dp-q-badge">${qConf.label}</span>
          ${dlBadge}
        </div>
        <div class="dp-task-title">${escHtml(task.title)}</div>
        <span class="badge-category" style="color:${color};border-color:${color}35;background:${color}12">${escHtml(catLabel)}</span>
      </div>
    </div>

    <!-- ── 重要度 × 緊急度 ─────────────────────────────────── -->
    <div class="dp-section">
      <div class="dp-section-title">重要度 × 緊急度</div>
      <div class="matrix-toggles">
        <div class="toggle-row">
          <span class="toggle-label">重要度</span>
          <div class="toggle-group">
            <button class="toggle-btn toggle-btn--imp ${task.importance === 'high' ? 'active' : ''}" data-field="importance" data-val="high">重要</button>
            <button class="toggle-btn ${task.importance === 'low'  ? 'active' : ''}" data-field="importance" data-val="low">重要でない</button>
          </div>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">緊急度</span>
          <div class="toggle-group">
            <button class="toggle-btn toggle-btn--urg ${task.urgency === 'high' ? 'active' : ''}" data-field="urgency" data-val="high">緊急</button>
            <button class="toggle-btn ${task.urgency === 'low'  ? 'active' : ''}" data-field="urgency" data-val="low">急がない</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── タグ ───────────────────────────────────────────── -->
    <div class="dp-section">
      <div class="dp-section-title">タグ</div>
      <div class="tags-wrap" id="dp-tags-wrap">${tagsHtml}</div>
      <div class="add-tag-row">
        <input class="add-tag-input" id="dp-tag-input" type="text" placeholder="タグを追加..." autocomplete="off">
        <button class="btn-sm" id="dp-btn-add-tag">追加</button>
      </div>
    </div>

    <!-- ── 期限 ───────────────────────────────────────────── -->
    <div class="dp-section">
      <div class="dp-section-title">期限</div>
      <div class="dp-deadline-row">
        <input class="dp-deadline-input dp-deadline-input--${dlStatus}" id="dp-deadline-input" type="date" value="${task.deadline || ''}">
        <button class="btn-sm dp-deadline-clear" id="dp-deadline-clear">クリア</button>
      </div>
    </div>

    <!-- ── ロードマップ ────────────────────────────────────── -->
    <div class="dp-section">
      <div class="dp-section-title">
        ロードマップ
        <span class="dp-progress-label">${doneCount} / ${totalCount}</span>
      </div>
      ${totalCount > 0 ? `<div class="dp-progress-track"><div class="dp-progress-fill" style="width:${progressPct}%;background:${color}"></div></div>` : ''}
      <div class="roadmap-list" id="dp-roadmap-list">${roadmapHtml}</div>
      <div class="add-roadmap-row">
        <input class="add-roadmap-input" id="dp-new-step" type="text" placeholder="新しいステップ..." autocomplete="off">
        <button class="btn-sm" id="dp-btn-add-step">追加</button>
      </div>
    </div>

    <!-- ── 準備リスト ──────────────────────────────────────── -->
    <div class="dp-section dp-section--checklist">
      <div class="dp-section-title">準備リスト</div>
      <div class="checklist-list" id="dp-checklist-list">${checklistHtml}</div>
      <div class="add-checklist-row">
        <input class="add-checklist-input" id="dp-new-check" type="text" placeholder="準備するもの..." autocomplete="off">
        <button class="btn-sm" id="dp-btn-add-check">追加</button>
      </div>
    </div>

    <!-- ── メモ・備考 ────────────────────────────────────── -->
    <div class="dp-section">
      <div class="dp-section-title">メモ・備考</div>
      <textarea class="dp-notes-textarea" id="dp-notes-textarea" placeholder="自由にメモを残せます...">${escHtml(task.notes || '')}</textarea>
      <div class="dp-notes-saved" id="dp-notes-saved"></div>
    </div>

    <!-- ── 過去の類似実績 ─────────────────────────────────── -->
    <div class="dp-similar-card">
      <div class="dp-similar-card-header">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M6.5 3.5V7L8.5 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <span>過去の類似実績</span>
        <button class="btn-load-similar" id="dp-btn-similar">確認する</button>
      </div>
      <div class="dp-similar-card-body">
        <div class="similar-tasks-wrap" id="dp-similar-wrap">
          <p class="dp-similar-hint">過去に完了した似たタスクを参照できます</p>
        </div>
      </div>
    </div>

    <!-- ── AI相談 ──────────────────────────────────────────── -->
    <div class="dp-ai-card">
      <div class="dp-ai-card-header">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1.5C7 1.5 9.5 3 9.5 6C9.5 8.5 7 10 7 10C7 10 4.5 8.5 4.5 6C4.5 3 7 1.5 7 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          <path d="M3 5L1.5 7L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M11 5L12.5 7L11 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="7" cy="6" r="1.2" fill="currentColor"/>
        </svg>
        <span>AI アシスタント</span>
      </div>
      <div class="dp-ai-card-body">
        <div class="dp-chat-messages" id="dp-chat-messages"></div>
        <div class="dp-chat-input-row">
          <input class="dp-chat-input" id="dp-chat-input" type="text" placeholder="このタスクについて質問..." autocomplete="off">
          <button class="dp-chat-send" id="dp-chat-send" title="送信">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7L13 7M13 7L8 2M13 7L8 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- ── 操作 ────────────────────────────────────────────── -->
    <div class="dp-section dp-danger" style="margin-top:8px">
      ${task.completed ? `<button class="btn-archive" id="dp-btn-archive">アーカイブする</button>` : ''}
      <button class="btn-danger" id="dp-btn-delete">このタスクを削除</button>
    </div>
  `;

  // ── Matrix toggles ──────────────────────────────────────
  body.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const val   = btn.dataset.val;
      await patchTask(task.id, { [field]: val });
      renderMatrix();
      renderDetailPanelBody(allTasks.find(t => t.id === task.id));
    });
  });

  // ── Tags ────────────────────────────────────────────────
  async function refreshTags() {
    const t = allTasks.find(x => x.id === task.id);
    if (!t) return;
    const wrap = body.querySelector('#dp-tags-wrap');
    wrap.innerHTML = (t.tags || []).map(tg =>
      `<span class="tag-pill">${escHtml(tg)}<button class="tag-remove" data-tag="${escHtml(tg)}">×</button></span>`
    ).join('');
    wrap.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const updated = (t.tags || []).filter(x => x !== btn.dataset.tag);
        await patchTask(task.id, { tags: updated });
        refreshTags();
      });
    });
  }
  refreshTags();

  body.querySelector('#dp-btn-add-tag').addEventListener('click', async () => {
    const input = body.querySelector('#dp-tag-input');
    const tag   = input.value.trim();
    if (!tag) return;
    const t = allTasks.find(x => x.id === task.id);
    if (!t) return;
    const tags = [...new Set([...(t.tags || []), tag])];
    await patchTask(task.id, { tags });
    input.value = '';
    refreshTags();
  });
  body.querySelector('#dp-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') body.querySelector('#dp-btn-add-tag').click();
  });

  // ── Deadline ────────────────────────────────────────────
  body.querySelector('#dp-deadline-input').addEventListener('change', async e => {
    await patchTask(task.id, { deadline: e.target.value || null });
    renderMatrix(); renderSchedulePanel();
  });
  body.querySelector('#dp-deadline-clear').addEventListener('click', async () => {
    body.querySelector('#dp-deadline-input').value = '';
    await patchTask(task.id, { deadline: null });
    renderMatrix(); renderSchedulePanel();
  });

  // ── Roadmap ─────────────────────────────────────────────
  body.querySelectorAll('.roadmap-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const rid = cb.closest('.roadmap-item').dataset.rid;
      const t   = allTasks.find(x => x.id === task.id);
      if (!t) return;
      logEvent(task.id, 'roadmap_step_toggle');
      const roadmap = t.roadmap.map(r => r.id === rid ? { ...r, done: cb.checked } : r);
      await patchTask(task.id, { roadmap });
      renderMatrix();
      renderDetailPanelBody(allTasks.find(x => x.id === task.id));
    });
  });
  body.querySelectorAll('.roadmap-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.closest('.roadmap-item').dataset.rid;
      const t   = allTasks.find(x => x.id === task.id);
      if (!t) return;
      await patchTask(task.id, { roadmap: t.roadmap.filter(r => r.id !== rid) });
      renderMatrix();
      renderDetailPanelBody(allTasks.find(x => x.id === task.id));
    });
  });
  body.querySelectorAll('.roadmap-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.roadmap-item');
      const textSpan = item.querySelector('.roadmap-text');
      const originalText = textSpan.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'roadmap-edit-input';
      input.value = originalText;
      textSpan.replaceWith(input);
      btn.style.display = 'none';
      item.querySelector('.roadmap-delete').style.display = 'none';
      input.focus();
      input.select();

      async function saveEdit() {
        const newText = input.value.trim();
        if (newText && newText !== originalText) {
          const rid = item.dataset.rid;
          const t = allTasks.find(x => x.id === task.id);
          if (t) {
            const roadmap = t.roadmap.map(r => r.id === rid ? { ...r, text: newText } : r);
            await patchTask(task.id, { roadmap });
          }
          renderDetailPanelBody(allTasks.find(x => x.id === task.id));
        } else {
          const span = document.createElement('span');
          span.className = textSpan.className;
          span.textContent = originalText;
          input.replaceWith(span);
          btn.style.display = '';
          item.querySelector('.roadmap-delete').style.display = '';
        }
      }

      let saved = false;
      input.addEventListener('blur', () => { if (!saved) { saved = true; saveEdit(); } });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); saved = true; saveEdit(); }
        if (e.key === 'Escape') {
          saved = true;
          const span = document.createElement('span');
          span.className = textSpan.className;
          span.textContent = originalText;
          input.replaceWith(span);
          btn.style.display = '';
          item.querySelector('.roadmap-delete').style.display = '';
        }
      });
    });
  });
  async function addStep() {
    const input = body.querySelector('#dp-new-step');
    const text  = input.value.trim();
    if (!text) return;
    const t = allTasks.find(x => x.id === task.id);
    if (!t) return;
    const roadmap = [...(t.roadmap || []), { id: String(Date.now()), text, done: false }];
    await patchTask(task.id, { roadmap });
    renderMatrix();
    renderDetailPanelBody(allTasks.find(x => x.id === task.id));
  }
  body.querySelector('#dp-btn-add-step').addEventListener('click', addStep);
  body.querySelector('#dp-new-step').addEventListener('keydown', e => { if (e.key === 'Enter') addStep(); });

  // ── Checklist ───────────────────────────────────────────
  body.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const cid = cb.closest('.checklist-item').dataset.cid;
      const t   = allTasks.find(x => x.id === task.id);
      if (!t) return;
      const checklist = t.checklist.map(c => c.id === cid ? { ...c, done: cb.checked } : c);
      await patchTask(task.id, { checklist });
      renderDetailPanelBody(allTasks.find(x => x.id === task.id));
    });
  });
  body.querySelectorAll('.checklist-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.closest('.checklist-item').dataset.cid;
      const t   = allTasks.find(x => x.id === task.id);
      if (!t) return;
      await patchTask(task.id, { checklist: t.checklist.filter(c => c.id !== cid) });
      renderDetailPanelBody(allTasks.find(x => x.id === task.id));
    });
  });
  async function addCheck() {
    const input = body.querySelector('#dp-new-check');
    const text  = input.value.trim();
    if (!text) return;
    const t = allTasks.find(x => x.id === task.id);
    if (!t) return;
    const checklist = [...(t.checklist || []), { id: String(Date.now()), text, done: false }];
    await patchTask(task.id, { checklist });
    renderDetailPanelBody(allTasks.find(x => x.id === task.id));
  }
  body.querySelector('#dp-btn-add-check').addEventListener('click', addCheck);
  body.querySelector('#dp-new-check').addEventListener('keydown', e => { if (e.key === 'Enter') addCheck(); });

  // ── Notes ───────────────────────────────────────────────
  const notesTextarea = body.querySelector('#dp-notes-textarea');
  const notesSaved    = body.querySelector('#dp-notes-saved');
  let notesSaveTimer  = null;
  notesTextarea.addEventListener('input', () => {
    notesSaved.textContent = '';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(async () => {
      await patchTask(task.id, { notes: notesTextarea.value });
      notesSaved.textContent = '保存しました';
      setTimeout(() => { notesSaved.textContent = ''; }, 2000);
    }, 800);
  });

  // ── Similar past tasks ──────────────────────────────────
  body.querySelector('#dp-btn-similar').addEventListener('click', async () => {
    const wrap = body.querySelector('#dp-similar-wrap');
    const btn  = body.querySelector('#dp-btn-similar');
    btn.disabled    = true;
    btn.textContent = '検索中...';
    wrap.innerHTML  = '<div class="similar-loading">過去の実績を検索しています...</div>';
    try {
      const results = await apiFetch(`/api/tasks/${task.id}/similar`);
      renderSimilarTasks(wrap, results);
    } catch {
      wrap.innerHTML = '<div class="similar-error">検索できませんでした</div>';
    }
    btn.disabled    = false;
    btn.textContent = '再検索';
  });

  // ── AI chat ─────────────────────────────────────────────
  const dpChatInput = body.querySelector('#dp-chat-input');
  const dpChatSend  = body.querySelector('#dp-chat-send');
  const dpChatMsgs  = body.querySelector('#dp-chat-messages');

  (taskChatHistories[task.id] || []).forEach(m => appendDpMsg(dpChatMsgs, m.role, m.content));

  async function sendDpMsg() {
    const text = dpChatInput.value.trim();
    if (!text || dpChatSend.disabled) return;
    dpChatSend.disabled = true;
    dpChatInput.value   = '';
    logEvent(task.id, 'task_chat_sent');
    if (!taskChatHistories[task.id]) taskChatHistories[task.id] = [];
    taskChatHistories[task.id].push({ role: 'user', content: text });
    _saveTaskChats();
    appendDpMsg(dpChatMsgs, 'user', text);
    const typingEl = document.createElement('div');
    typingEl.className = 'dp-chat-typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    dpChatMsgs.appendChild(typingEl);
    dpChatMsgs.scrollTop = dpChatMsgs.scrollHeight;
    try {
      const res  = await fetch(`/api/tasks/${task.id}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: taskChatHistories[task.id] }),
      });
      const data = await res.json();
      typingEl.remove();
      taskChatHistories[task.id].push({ role: 'assistant', content: data.response });
      _saveTaskChats();
      appendDpMsg(dpChatMsgs, 'assistant', data.response);
      if (data.step_updates && data.step_updates.length > 0) {
        const t = allTasks.find(x => x.id === task.id);
        if (t) {
          data.step_updates.forEach(u => {
            if (t.roadmap && t.roadmap[u.index]) t.roadmap[u.index].text = u.new;
          });
          _saveCachedTasks(allTasks);
          renderDetailPanelBody(t);
        }
      }
    } catch {
      typingEl.remove();
      appendDpMsg(dpChatMsgs, 'assistant', 'エラーが発生しました。もう一度お試しください。');
    }
    dpChatSend.disabled = false;
    dpChatInput.focus();
  }
  dpChatSend.addEventListener('click', sendDpMsg);
  dpChatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendDpMsg(); });

  // ── Archive / Delete ────────────────────────────────────
  const archiveBtn = body.querySelector('#dp-btn-archive');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      logEvent(task.id, 'task_archived');
      if (isOnline) {
        await apiFetch(`/api/tasks/${task.id}/archive`, { method: 'POST' });
      } else {
        _pushOp({ type: 'archive', id: task.id });
      }
      allTasks = allTasks.filter(t => t.id !== task.id);
      _saveCachedTasks(allTasks);
      closeDetailPanel();
      renderMatrix();
    });
  }
  body.querySelector('#dp-btn-delete').addEventListener('click', async () => {
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    logEvent(task.id, 'task_deleted');
    await removeTask(task.id);
    closeDetailPanel();
    renderMatrix();
  });
}

function appendDpMsg(container, role, content) {
  const el = document.createElement('div');
  el.className = `dp-chat-msg ${role}`;
  el.innerHTML = `<div class="dp-chat-bubble">${
    role === 'assistant' ? formatMarkdown(content)
                         : escHtml(content).replace(/\n/g, '<br>')
  }</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function renderSimilarTasks(container, tasks) {
  if (tasks.length === 0) {
    container.innerHTML = '<div class="similar-empty">類似した過去のタスクが見つかりませんでした</div>';
    return;
  }
  container.innerHTML = '';
  for (const t of tasks) {
    const color    = categoryColor(t.category);
    const doneSteps  = (t.roadmap || []).filter(r => r.done).length;
    const totalSteps = (t.roadmap || []).length;
    const archivedDate = new Date(t.archived_at);
    const dateLabel = `${archivedDate.getFullYear()}年${archivedDate.getMonth()+1}月${archivedDate.getDate()}日`;

    const card = document.createElement('div');
    card.className = 'similar-card';
    card.style.setProperty('--card-color', color);
    card.innerHTML = `
      <div class="similar-card-header">
        <span class="similar-check-icon">✓</span>
        <div class="similar-card-info">
          <div class="similar-card-title">${escHtml(t.title)}</div>
          <div class="similar-card-meta">
            <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(categoryLabel(t.category))}</span>
            <span class="similar-date">${dateLabel}に完了</span>
            ${totalSteps > 0 ? `<span class="similar-steps">${doneSteps}/${totalSteps}ステップ</span>` : ''}
          </div>
        </div>
        <button class="similar-expand-btn" title="詳細を見る">▾</button>
      </div>
      <div class="similar-card-detail hidden">
        ${totalSteps > 0
          ? (t.roadmap || []).map(r => `<div class="similar-step ${r.done ? 'done' : ''}">${r.done ? '✓' : '○'} ${escHtml(r.text)}</div>`).join('')
          : '<div class="similar-step-empty">ステップなし</div>'
        }
      </div>
    `;
    card.querySelector('.similar-expand-btn').addEventListener('click', () => {
      const detail = card.querySelector('.similar-card-detail');
      const btn    = card.querySelector('.similar-expand-btn');
      const hidden = detail.classList.toggle('hidden');
      btn.textContent = hidden ? '▾' : '▴';
    });
    container.appendChild(card);
  }
}

/* ═══════════════════════════════════════════════════════════
   Archive
═══════════════════════════════════════════════════════════ */
function formatArchivedDate(isoStr) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

async function fetchArchive() {
  const q        = document.getElementById('archive-search')?.value.trim() || '';
  const category = document.getElementById('filter-category')?.value || '';
  const sort     = document.getElementById('filter-sort')?.value || 'newest';
  const params   = new URLSearchParams();
  if (q)        params.set('q', q);
  if (category) params.set('category', category);
  params.set('sort', sort);
  return apiFetch(`/api/archive?${params}`);
}

function buildArchiveCard(task) {
  const color    = categoryColor(task.category);
  const catLabel = categoryLabel(task.category);
  const doneSteps  = (task.roadmap || []).filter(r => r.done).length;
  const totalSteps = (task.roadmap || []).length;
  const pct        = totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0;
  const progressHtml = totalSteps > 0 ? `
    <div class="archive-progress">
      <span class="task-steps-text">${doneSteps} / ${totalSteps}</span>
      <div class="task-progress-bar"><div class="task-progress-fill" style="width:${pct}%"></div></div>
    </div>` : '';

  const card = document.createElement('div');
  card.className = 'archive-card';
  card.dataset.id = task.id;
  card.style.setProperty('--card-color', color);
  card.innerHTML = `
    <div class="archive-card-body">
      <div class="archive-title">${escHtml(task.title)}</div>
      <div class="archive-tags">
        <span class="tag-category" style="color:${color};background:color-mix(in srgb,${color} 12%,transparent);border-color:color-mix(in srgb,${color} 22%,transparent)">${escHtml(catLabel)}</span>
      </div>
      ${progressHtml}
    </div>
    <div class="archive-card-footer">
      <span class="archive-date">${formatArchivedDate(task.archived_at)}</span>
      <div class="archive-actions">
        <button class="btn-restore">復元</button>
        <button class="btn-archive-del">削除</button>
      </div>
    </div>
  `;
  card.querySelector('.btn-restore').addEventListener('click', async () => {
    await apiFetch(`/api/archive/${task.id}/restore`, { method: 'POST' });
    await loadTasks();
    renderMatrix();
    renderArchivePanel();
  });
  card.querySelector('.btn-archive-del').addEventListener('click', async () => {
    if (!confirm(`「${task.title}」を完全に削除しますか？`)) return;
    await apiFetch(`/api/archive/${task.id}`, { method: 'DELETE' });
    renderArchivePanel();
  });
  return card;
}

async function renderArchivePanel() {
  const grid  = document.getElementById('archive-grid');
  const count = document.getElementById('archive-count');
  if (!grid) return;
  let tasks;
  try { tasks = await fetchArchive(); } catch { return; }
  Array.from(grid.querySelectorAll('.archive-card')).forEach(n => n.remove());
  const emptyEl = document.getElementById('archive-empty');
  if (tasks.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    count.textContent = '';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    count.textContent = `${tasks.length} 件`;
    for (const t of tasks) grid.appendChild(buildArchiveCard(t));
  }
}

let archiveSearchTimer = null;
function onArchiveSearchInput() {
  clearTimeout(archiveSearchTimer);
  archiveSearchTimer = setTimeout(renderArchivePanel, 250);
}

/* ═══════════════════════════════════════════════════════════
   Memo (Brain Dump)
═══════════════════════════════════════════════════════════ */
async function renderMemoPanel(forceRefresh = false) {
  if (!memoSessionsCache || forceRefresh) {
    try { memoSessionsCache = await apiFetch('/api/braindump'); } catch { return; }
  }
  if (memoView === 'tree') renderMemoTree(memoSessionsCache);
  else renderMemoCalendar(memoSessionsCache);
}

function switchMemoView(view) {
  if (memoView === view) return;
  memoView = view;
  document.querySelectorAll('.memo-view-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );
  const nav = document.getElementById('memo-cal-nav');
  if (nav) nav.classList.toggle('hidden', view !== 'calendar');
  renderMemoPanel();
}

const MEMO_CATEGORY_ORDER = [
  '仕事・キャリア', '人間関係', '自己成長・学習',
  'アイデア・創造', '感情・メンタル', '日常・生活', '将来・目標', 'その他',
];
const MEMO_CATEGORY_COLORS = {
  '仕事・キャリア':   '#6B8FB5',
  '人間関係':         '#C48080',
  '自己成長・学習':   '#9580B5',
  'アイデア・創造':   '#B8896A',
  '感情・メンタル':   '#7EA882',
  '日常・生活':       '#8E8E93',
  '将来・目標':       '#5A7A9A',
  'その他':           '#A0A0A8',
};

function renderMemoTree(sessions) {
  const wrap = document.getElementById('memo-tree-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (sessions.length === 0) {
    wrap.innerHTML = `<div class="memo-empty">保存されたメモはありません<br><span class="memo-empty-hint">「頭の整理」モードで会話し、「保存」ボタンで記録できます</span></div>`;
    return;
  }
  const grouped = {};
  for (const s of sessions) {
    const cat = s.theme_category || 'その他';
    const sub = s.sub_theme     || 'その他';
    if (!grouped[cat])      grouped[cat] = {};
    if (!grouped[cat][sub]) grouped[cat][sub] = [];
    grouped[cat][sub].push(s);
  }
  const rootEl = document.createElement('div');
  rootEl.className = 'memo-tree-root';
  rootEl.innerHTML = `<span class="memo-tree-root-icon">◈</span><span class="memo-tree-root-label">メモ / 記録</span><span class="memo-tree-root-count">${sessions.length}件</span>`;
  wrap.appendChild(rootEl);
  const trunk = document.createElement('div');
  trunk.className = 'memo-tree-trunk';
  wrap.appendChild(trunk);

  const sortedCats = Object.keys(grouped).sort((a, b) => {
    const ai = MEMO_CATEGORY_ORDER.indexOf(a), bi = MEMO_CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'ja');
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  });

  for (const cat of sortedCats) {
    const color = MEMO_CATEGORY_COLORS[cat] || '#8E8E93';
    const subGroups = grouped[cat];
    const totalCount = Object.values(subGroups).reduce((n, a) => n + a.length, 0);
    const catEl = document.createElement('div');
    catEl.className = 'memo-cat-group open';
    catEl.style.setProperty('--cat-color', color);
    const catHeader = document.createElement('div');
    catHeader.className = 'memo-cat-header';
    catHeader.innerHTML = `<span class="memo-cat-pip" style="background:${color}"></span><span class="memo-cat-label">${escHtml(cat)}</span><span class="memo-cat-count">${totalCount}件</span><span class="memo-cat-arrow">▾</span>`;
    catHeader.addEventListener('click', () => {
      const isOpen = catEl.classList.toggle('open');
      catHeader.querySelector('.memo-cat-arrow').textContent = isOpen ? '▾' : '▸';
    });
    const catBody = document.createElement('div');
    catBody.className = 'memo-cat-body';
    const sortedSubs = Object.keys(subGroups).sort((a, b) => a.localeCompare(b, 'ja'));
    for (const sub of sortedSubs) {
      const subSessions = subGroups[sub].sort((a, b) => b.date.localeCompare(a.date));
      const subEl = document.createElement('div');
      subEl.className = 'memo-sub-group open';
      const subHeader = document.createElement('div');
      subHeader.className = 'memo-sub-header';
      subHeader.innerHTML = `<span class="memo-sub-arrow">▾</span><span class="memo-sub-label">${escHtml(sub)}</span><span class="memo-sub-count">${subSessions.length}</span>`;
      subHeader.addEventListener('click', () => {
        const isOpen = subEl.classList.toggle('open');
        subHeader.querySelector('.memo-sub-arrow').textContent = isOpen ? '▾' : '▸';
      });
      const subBody = document.createElement('div');
      subBody.className = 'memo-sub-body';
      for (const s of subSessions) {
        const [, m, d] = s.date.split('-').map(Number);
        const entry = document.createElement('div');
        entry.className = 'memo-entry';
        entry.innerHTML = `
          <div class="memo-entry-header">
            <span class="memo-entry-date">${m}/${d}</span>
            <span class="memo-entry-title">${escHtml(s.title)}</span>
            <button class="memo-entry-delete" title="削除">×</button>
          </div>
          <div class="memo-entry-body hidden"><div class="memo-entry-summary">${escHtml(s.summary)}</div></div>`;
        entry.querySelector('.memo-entry-header').addEventListener('click', e => {
          if (e.target.closest('.memo-entry-delete')) return;
          entry.querySelector('.memo-entry-body').classList.toggle('hidden');
          entry.classList.toggle('expanded');
        });
        entry.querySelector('.memo-entry-delete').addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm(`「${s.title}」を削除しますか？`)) return;
          await apiFetch(`/api/braindump/${s.id}`, { method: 'DELETE' });
          memoSessionsCache = null;
          renderMemoPanel(true);
        });
        subBody.appendChild(entry);
      }
      subEl.appendChild(subHeader); subEl.appendChild(subBody);
      catBody.appendChild(subEl);
    }
    catEl.appendChild(catHeader); catEl.appendChild(catBody);
    trunk.appendChild(catEl);
  }
}

function renderMemoCalendar(sessions) {
  const wrap = document.getElementById('memo-tree-wrap');
  if (!wrap) return;
  const year = memoRefDate.getFullYear(), month = memoRefDate.getMonth();
  const navLabel = document.getElementById('memo-nav-label');
  if (navLabel) navLabel.textContent = `${year}年${month+1}月`;
  const sessionMap = {};
  for (const s of sessions) {
    if (!sessionMap[s.date]) sessionMap[s.date] = [];
    sessionMap[s.date].push(s);
  }
  const today = todayStr();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const dayNames = ['日','月','火','水','木','金','土'];
  wrap.innerHTML = '';
  const calWrap = document.createElement('div');
  calWrap.className = 'cal-month-wrap';
  const header = document.createElement('div');
  header.className = 'cal-header';
  for (const dn of dayNames) {
    const cell = document.createElement('div'); cell.className = 'cal-header-cell'; cell.textContent = dn;
    header.appendChild(cell);
  }
  calWrap.appendChild(header);
  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (let i = 0; i < firstDay.getDay(); i++) {
    const pad = document.createElement('div'); pad.className = 'cal-cell cal-pad'; grid.appendChild(pad);
  }
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const daySessions = sessionMap[iso] || [];
    const cell = document.createElement('div');
    cell.className = `cal-cell${iso === today ? ' cal-today' : ''}${iso < today ? ' cal-past' : ''}${daySessions.length ? ' has-memos' : ''}`;
    const num = document.createElement('div'); num.className = 'cal-day-num'; num.textContent = day;
    cell.appendChild(num);
    if (daySessions.length > 0) {
      const chips = document.createElement('div'); chips.className = 'memo-cal-chips';
      const maxChips = Math.min(daySessions.length, 2);
      for (let i = 0; i < maxChips; i++) {
        const chip = document.createElement('div'); chip.className = 'memo-cal-chip'; chip.textContent = daySessions[i].title;
        chips.appendChild(chip);
      }
      if (daySessions.length > 2) {
        const more = document.createElement('div'); more.className = 'memo-cal-more'; more.textContent = `+${daySessions.length - 2}件`;
        chips.appendChild(more);
      }
      cell.appendChild(chips);
      const list = document.createElement('div'); list.className = 'memo-cal-list';
      for (const s of daySessions) {
        const item = document.createElement('div'); item.className = 'memo-cal-item';
        const snippet = s.summary.length > 72 ? s.summary.slice(0, 72) + '…' : s.summary;
        item.innerHTML = `<div class="memo-cal-item-title">${escHtml(s.title)}</div><div class="memo-cal-item-summary">${escHtml(snippet)}</div>`;
        list.appendChild(item);
      }
      cell.appendChild(list);
      cell.addEventListener('click', () => cell.classList.toggle('expanded'));
    }
    grid.appendChild(cell);
  }
  calWrap.appendChild(grid);
  wrap.appendChild(calWrap);
}

/* ═══════════════════════════════════════════════════════════
   Schedule
═══════════════════════════════════════════════════════════ */
function renderSchedulePanel() {
  const content = document.getElementById('schedule-content');
  const nav     = document.getElementById('schedule-nav');
  const label   = document.getElementById('schedule-nav-label');
  if (!content) return;
  nav.classList.toggle('hidden', scheduleView === 'list');
  if (scheduleView === 'list')  renderScheduleList(content);
  if (scheduleView === 'month') renderScheduleMonth(content, label);
  if (scheduleView === 'week')  renderScheduleWeek(content, label);
}

function buildScheduleListItem(task) {
  const color  = categoryColor(task.category);
  const status = deadlineStatus(task.deadline);
  const item   = document.createElement('div');
  item.className = `schedule-list-item status-${status}`;
  item.style.setProperty('--card-color', color);
  item.innerHTML = `
    <div class="sl-left">
      <span class="sl-pip" style="background:${color}"></span>
      <div class="sl-body">
        <div class="sl-title${task.completed ? ' completed' : ''}">${escHtml(task.title)}</div>
        <div class="sl-meta">
          <span class="sl-cat">${escHtml(categoryLabel(task.category))}</span>
          ${task.deadline ? `<span class="sl-date dl-${status}">${escHtml(task.deadline)}</span>` : ''}
        </div>
      </div>
    </div>
    <span class="sl-arrow">›</span>`;
  item.addEventListener('click', () => { switchTab('tasks'); setTimeout(() => openDetailPanel(task.id), 60); });
  return item;
}

function renderScheduleList(container) {
  const today = todayStr();
  const week  = dateStr(addDays(new Date(), 7));
  const withDL = allTasks.filter(t => t.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const noDL   = allTasks.filter(t => !t.deadline);
  const groups = [
    { key: 'overdue', label: '期限切れ', tasks: withDL.filter(t => t.deadline < today) },
    { key: 'today',   label: '今日',     tasks: withDL.filter(t => t.deadline === today) },
    { key: 'soon',    label: '今週',     tasks: withDL.filter(t => t.deadline > today && t.deadline <= week) },
    { key: 'later',   label: 'それ以降', tasks: withDL.filter(t => t.deadline > week) },
    { key: 'none',    label: '期限なし', tasks: noDL },
  ];
  container.innerHTML = '';
  const scroll = document.createElement('div');
  scroll.className = 'schedule-list-scroll';
  let hasAny = false;
  for (const g of groups) {
    if (g.tasks.length === 0) continue;
    hasAny = true;
    const sec = document.createElement('div');
    sec.className = `schedule-list-group group-${g.key}`;
    sec.innerHTML = `<div class="schedule-group-label">${g.label}<span class="schedule-group-count">${g.tasks.length}</span></div>`;
    for (const t of g.tasks) sec.appendChild(buildScheduleListItem(t));
    scroll.appendChild(sec);
  }
  if (!hasAny) scroll.innerHTML = '<div class="schedule-empty">スケジュールされたタスクはありません</div>';
  container.appendChild(scroll);
}

function renderScheduleMonth(container, label) {
  const year = scheduleRefDate.getFullYear(), month = scheduleRefDate.getMonth();
  label.textContent = `${year}年${month+1}月`;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const taskMap  = {};
  for (const t of allTasks) {
    if (!t.deadline) continue;
    if (!taskMap[t.deadline]) taskMap[t.deadline] = [];
    taskMap[t.deadline].push(t);
  }
  container.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'cal-month-wrap';
  const dayNames = ['日','月','火','水','木','金','土'];
  const header = document.createElement('div'); header.className = 'cal-header';
  for (const dn of dayNames) { const cell = document.createElement('div'); cell.className = 'cal-header-cell'; cell.textContent = dn; header.appendChild(cell); }
  wrap.appendChild(header);
  const grid = document.createElement('div'); grid.className = 'cal-grid';
  for (let i = 0; i < firstDay.getDay(); i++) { const pad = document.createElement('div'); pad.className = 'cal-cell cal-pad'; grid.appendChild(pad); }
  const today = todayStr();
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const tasks = taskMap[iso] || [];
    const cell = document.createElement('div');
    cell.className = `cal-cell${iso === today ? ' cal-today' : ''}${iso < today ? ' cal-past' : ''}${tasks.length ? ' has-tasks' : ''}`;
    const num = document.createElement('div'); num.className = 'cal-day-num'; num.textContent = day;
    cell.appendChild(num);
    if (tasks.length > 0) {
      const dots = document.createElement('div'); dots.className = 'cal-dots';
      const max = Math.min(tasks.length, 3);
      for (let i = 0; i < max; i++) { const dot = document.createElement('div'); dot.className = 'cal-dot'; dot.style.background = categoryColor(tasks[i].category); dots.appendChild(dot); }
      if (tasks.length > 3) { const more = document.createElement('span'); more.className = 'cal-more'; more.textContent = `+${tasks.length - 3}`; dots.appendChild(more); }
      cell.appendChild(dots);
      const list = document.createElement('div'); list.className = 'cal-task-list';
      for (const t of tasks) {
        const ti = document.createElement('div');
        ti.className = `cal-task-item${t.completed ? ' completed' : ''}`;
        ti.style.setProperty('--card-color', categoryColor(t.category));
        ti.textContent = t.title;
        ti.addEventListener('click', e => { e.stopPropagation(); switchTab('tasks'); setTimeout(() => openDetailPanel(t.id), 60); });
        list.appendChild(ti);
      }
      cell.appendChild(list);
      cell.addEventListener('click', () => cell.classList.toggle('expanded'));
    }
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  container.appendChild(wrap);
}

function renderScheduleWeek(container, label) {
  const d = new Date(scheduleRefDate);
  const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
  const weekEnd = addDays(weekStart, 6);
  const fmt = dt => `${dt.getMonth()+1}/${dt.getDate()}`;
  label.textContent = `${fmt(weekStart)} – ${fmt(weekEnd)}`;
  const taskMap = {};
  for (const t of allTasks) {
    if (!t.deadline) continue;
    if (!taskMap[t.deadline]) taskMap[t.deadline] = [];
    taskMap[t.deadline].push(t);
  }
  const today = todayStr();
  const dayNames = ['日','月','火','水','木','金','土'];
  container.innerHTML = '';
  const week = document.createElement('div'); week.className = 'cal-week';
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const iso = dateStr(day);
    const tasks = taskMap[iso] || [];
    const col = document.createElement('div');
    col.className = `cal-week-col${iso === today ? ' cal-today' : ''}${iso < today ? ' cal-past' : ''}`;
    const head = document.createElement('div'); head.className = 'cal-week-head';
    head.innerHTML = `<span class="cal-week-dow">${dayNames[i]}</span><span class="cal-week-date">${day.getDate()}</span>`;
    col.appendChild(head);
    const body = document.createElement('div'); body.className = 'cal-week-body';
    for (const t of tasks) {
      const item = document.createElement('div');
      item.className = `cal-week-task${t.completed ? ' completed' : ''}`;
      item.style.setProperty('--card-color', categoryColor(t.category));
      item.textContent = t.title;
      item.addEventListener('click', () => { switchTab('tasks'); setTimeout(() => openDetailPanel(t.id), 60); });
      body.appendChild(item);
    }
    col.appendChild(body); week.appendChild(col);
  }
  container.appendChild(week);
}

/* ═══════════════════════════════════════════════════════════
   Report
═══════════════════════════════════════════════════════════ */
let reportCharts = {};
function destroyReportCharts() { Object.values(reportCharts).forEach(c => c.destroy()); reportCharts = {}; }

async function renderReportPanel() {
  const body = document.getElementById('report-body');
  if (!body) return;
  body.innerHTML = '<div class="report-loading">分析中...</div>';
  let data;
  try { data = await apiFetch('/api/report'); } catch {
    body.innerHTML = '<div class="report-empty-state">分析データを取得できませんでした</div>';
    return;
  }
  const tsEl = document.getElementById('report-ts');
  if (tsEl && data.generated_at) {
    const d = new Date(data.generated_at);
    tsEl.textContent = `最終分析: ${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  destroyReportCharts();
  body.innerHTML = buildReportHTML(data);
  initReportCharts(data);
}

function buildReportHTML(data) {
  const tasks = data.tasks || [];
  const attentionTasks = tasks.filter(t => t.flags && t.flags.length > 0);
  const attentionHtml = attentionTasks.length > 0
    ? attentionTasks.map(t => {
        const isCritical = t.flags.includes('deadline_critical');
        const flagLabel  = isCritical ? '期限！' : '回避';
        const flagClass  = isCritical ? 'attention-flag critical' : 'attention-flag';
        return `
          <div class="attention-item" data-task-id="${escHtml(t.id)}">
            <div class="attention-item-left">
              <span class="${flagClass}">${flagLabel}</span>
              <div>
                <div class="attention-title">${escHtml(t.title)}</div>
                <div class="attention-meta">${escHtml(categoryLabel(t.category))} · ${t.days_old}日経過 · 進捗 ${Math.round(t.progress_rate*100)}%</div>
              </div>
            </div>
          </div>`;
      }).join('')
    : '<div class="report-empty-sm">注意が必要なタスクはありません</div>';

  return `
    <div class="report-sections">
      <section class="report-section">
        <div class="report-section-title">注意が必要なタスク</div>
        <div class="attention-list" id="attention-list">${attentionHtml}</div>
      </section>
      <div class="report-ai-result hidden" id="report-ai-result">
        <div class="report-section-title">AIコメント</div>
        <div class="ai-result-text" id="ai-result-text"></div>
      </div>
      <div class="report-charts-grid">
        <section class="report-section">
          <div class="report-section-title">カテゴリー別傾向</div>
          <div class="chart-wrap"><canvas id="chart-radar"></canvas></div>
        </section>
      </div>
    </div>`;
}

function initReportCharts(data) {
  const cats      = ['work', 'health', 'life', 'learning', 'social', 'admin'];
  const catLabels = ['仕事', '健康', '生活', '学習', '人間関係', '手続き'];
  const catStats  = data.category_stats || {};
  const radarCanvas = document.getElementById('chart-radar');
  if (radarCanvas) {
    reportCharts.radar = new Chart(radarCanvas, {
      type: 'radar',
      data: {
        labels: catLabels,
        datasets: [{
          label: '進捗率',
          data: cats.map(c => (catStats[c] || {}).avg_progress || 0),
          borderColor: '#7EA882', backgroundColor: 'rgba(126,168,130,0.14)',
          pointBackgroundColor: '#7EA882', pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        scales: { r: { min: 0, max: 1, ticks: { display: false }, pointLabels: { font: { size: 10 } } } },
        plugins: { legend: { labels: { font: { size: 10 }, boxWidth: 10 } } },
      },
    });
  }
  document.querySelectorAll('.attention-item[data-task-id]').forEach(el => {
    el.addEventListener('click', () => {
      switchTab('tasks');
      setTimeout(() => openDetailPanel(el.dataset.taskId), 60);
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   Milestone / Flow config
   新しい種類を追加するには FLOW_CONFIG にエントリを追加するだけ。
═══════════════════════════════════════════════════════════ */
const FLOW_CONFIG = {
  task: {
    label:    '単発タスク',
    greeting: 'どんなことをしたいですか？\nやりたいこと、困っていること、気になっていることを気軽に話してください。',
    steps: [
      { id: 'type',      label: '種類選択' },
      { id: 'goal',      label: 'やりたいこと' },
      { id: 'steps',     label: 'ステップ整理' },
      { id: 'checklist', label: '準備物' },
      { id: 'priority',  label: '重要度・緊急度' },
      { id: 'deadline',  label: '期限・タグ' },
      { id: 'confirm',   label: '確認・登録' },
    ],
    keywords: [
      null,
      null,
      ['ステップ', '何から始め', 'どんな作業', '具体的', 'できている状態', '完了したら', '道筋', '進め方'],
      ['準備', '用意', '必要なもの', '事前に', 'チェック', '準備するもの'],
      ['重要', '緊急', '価値観', '急いで', '大切', '急ぎ'],
      ['期限', 'いつまで', '締め切り', 'タグ', 'キーワード', '関連する'],
      ['確認', 'よろしい', 'まとめ', '登録しま', 'この内容', 'こんな内容'],
    ],
  },
  project: {
    label:    'プロジェクト',
    greeting: 'どんな長期目標やプロジェクトを考えていますか？\n最終的にどんな状態になっていたいか、教えてください。',
    steps: [
      { id: 'type',     label: '種類選択' },
      { id: 'goal',     label: 'ゴール設定' },
      { id: 'deadline', label: '期限設定' },
      { id: 'phases',   label: 'フェーズ設計' },
      { id: 'tags',     label: 'カテゴリー・タグ' },
      { id: 'confirm',  label: '確認・登録' },
    ],
    keywords: [
      null,
      null,
      ['期限', 'いつまで', 'いつごろ', '何月', '期日', 'いつを'],
      ['フェーズ', '段階', '大きな流れ', 'ステージ', '大きく分け', 'フェーズ案'],
      ['カテゴリー', 'タグ', '分類', 'キーワード', '関連する'],
      ['確認', 'よろしい', 'まとめ', '登録しま', 'この内容', 'こんな内容'],
    ],
  },
  habit: {
    label:    '習慣',
    greeting: 'どんな習慣を身につけたいですか？\n毎日・毎週続けたいことを教えてください。',
    steps: [
      { id: 'type',      label: '種類選択' },
      { id: 'goal',      label: 'どんな習慣か' },
      { id: 'frequency', label: '頻度' },
      { id: 'category',  label: 'カテゴリー・タグ' },
      { id: 'confirm',   label: '確認・登録' },
    ],
    keywords: [
      null,
      null,
      ['毎日', '毎週', '頻度', '週に', '日に', 'どのくらい', '継続'],
      ['カテゴリー', 'タグ', '分類', 'キーワード', '関連'],
      ['確認', 'よろしい', 'まとめ', '登録しま', 'この内容', 'こんな内容'],
    ],
  },
};

function initMilestone(type) {
  milestoneState = { type, currentStep: 1, isOffTrack: false, noAdvanceCount: 0 };
  renderMilestone();
  document.getElementById('chat-milestone-panel').classList.remove('hidden');
}

function resetMilestone() {
  milestoneState = { type: null, currentStep: 0, isOffTrack: false, noAdvanceCount: 0 };
  const panel = document.getElementById('chat-milestone-panel');
  if (panel) {
    panel.classList.add('hidden');
    const stepsEl = document.getElementById('milestone-steps');
    if (stepsEl) stepsEl.innerHTML = '';
    const offtrackEl = document.getElementById('milestone-offtrack');
    if (offtrackEl) offtrackEl.classList.add('hidden');
  }
}

function updateMilestoneFromResponse(text) {
  if (!milestoneState.type) return;
  const flow     = FLOW_CONFIG[milestoneState.type];
  const steps    = flow.steps;
  const keywords = flow.keywords;

  if (text.includes('[[TASK:') || text.includes('[[PROJECT:') || text.includes('[[HABIT:')) {
    milestoneState.currentStep    = steps.length - 1;
    milestoneState.isOffTrack     = false;
    milestoneState.noAdvanceCount = 0;
    renderMilestone();
    return;
  }

  let advanced = false;
  for (let i = milestoneState.currentStep + 1; i < steps.length; i++) {
    const kws = keywords[i];
    if (!kws) continue;
    if (kws.some(kw => text.includes(kw))) {
      milestoneState.currentStep    = i;
      milestoneState.isOffTrack     = false;
      milestoneState.noAdvanceCount = 0;
      advanced = true;
      break;
    }
  }

  if (!advanced) {
    milestoneState.noAdvanceCount++;
    milestoneState.isOffTrack = milestoneState.noAdvanceCount >= 3;
  }

  renderMilestone();
}

function renderMilestone() {
  const { type, currentStep, isOffTrack } = milestoneState;
  if (!type) return;

  const flow          = FLOW_CONFIG[type];
  const steps         = flow.steps;
  const stepsEl       = document.getElementById('milestone-steps');
  const offtrackEl    = document.getElementById('milestone-offtrack');
  const hintTextEl    = document.getElementById('offtrack-hint-text');
  const currentInfoEl = document.getElementById('milestone-current-info');

  if (!stepsEl) return;

  const checkSvg = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  stepsEl.innerHTML = steps.map((step, i) => {
    let cls  = 'pending';
    let icon = '';
    if (i < currentStep)      { cls = 'completed'; icon = checkSvg; }
    else if (i === currentStep) cls = isOffTrack ? 'offtrack' : 'current';
    return `<li class="milestone-step ${cls}" data-step="${i}">
      <div class="milestone-step-indicator">${icon}</div>
      <span class="milestone-step-label">${step.label}</span>
    </li>`;
  }).join('');

  if (currentInfoEl) {
    const label = steps[currentStep]?.label || '';
    currentInfoEl.textContent = isOffTrack
      ? `📍 「${label}」に戻りましょう`
      : `${label}　(${currentStep + 1} / ${steps.length})`;
    currentInfoEl.className = `milestone-current-info${isOffTrack ? ' offtrack' : ''}`;
  }

  if (offtrackEl) {
    offtrackEl.classList.toggle('hidden', !isOffTrack);
    if (isOffTrack && hintTextEl) {
      hintTextEl.textContent = `「${steps[currentStep]?.label || ''}」に戻りましょう`;
    }
  }
}

// ボタン押下 → AI呼び出しなし。静的グリーティングを表示してフロー開始。
function selectTaskType(type) {
  const flow = FLOW_CONFIG[type];
  if (!flow) return;

  // 履歴をリセットして新規フロー開始
  chatHistories[chatMode] = [];

  // マイルストーン初期化（種類選択=完了、次ステップ=現在地）
  initMilestone(type);

  // ウェルカム画面を除去
  const container = chatMessagesEl();
  const welcome   = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // 静的グリーティングをアシスタントメッセージとして表示
  appendMessage('assistant', flow.greeting);

  // AI会話の文脈として履歴に追加（AI側にフロー種別を伝える）
  chatHistories[chatMode].push({ role: 'assistant', content: flow.greeting });
  _saveChats();

  document.getElementById('chat-input').focus();
}

/* ═══════════════════════════════════════════════════════════
   Chat
═══════════════════════════════════════════════════════════ */
const chatMessagesEl = () => document.getElementById('chat-messages');

function appendMessage(role, content, taskProposals = [], projectProposals = [], habitProposals = []) {
  const container = chatMessagesEl();
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;
  if (role === 'assistant') {
    const proposalsHtml = [
      ...taskProposals.map(tp => buildProposalHtml(tp)),
      ...projectProposals.map(pp => buildProjectProposalHtml(pp)),
      ...habitProposals.map(hp => buildHabitProposalHtml(hp)),
    ].join('');
    msgEl.innerHTML = `
      <div class="msg-avatar">✦</div>
      <div class="msg-bubble"><div class="msg-text">${formatMarkdown(content)}</div>${proposalsHtml}</div>`;
  } else {
    msgEl.innerHTML = `<div class="msg-bubble"><div class="msg-text">${escHtml(content).replace(/\n/g, '<br>')}</div></div>`;
  }
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
  return msgEl;
}

function buildHabitProposalHtml(habit) {
  const color    = categoryColor(habit.category);
  const catLabel = categoryLabel(habit.category);
  const freqLabel = habit.frequency === 'weekly' ? '毎週' : '毎日';
  return `
    <div class="habit-proposal" data-habit='${escHtml(JSON.stringify(habit))}' style="--card-color:${color}">
      <div class="proposal-header">
        <span class="proposal-pip" style="background:${color}"></span>
        <span class="proposal-title">${escHtml(habit.title)}</span>
        <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(catLabel)}</span>
        <span class="proposal-q-badge" style="border-color:#6B8E7A30;color:#6B8E7A">🔁 ${freqLabel}</span>
      </div>
      ${habit.notes ? `<div class="proposal-goal">${escHtml(habit.notes)}</div>` : ''}
      <div class="proposal-actions">
        <button class="btn-primary btn-confirm-habit">習慣を作成</button>
        <button class="btn-ghost btn-modify-habit">修正する</button>
      </div>
    </div>`;
}

function buildProjectProposalHtml(proj) {
  const color     = categoryColor(proj.category);
  const catLabel  = categoryLabel(proj.category);
  const phasesHtml = (proj.phases || []).map((ph, i) => `
    <div class="proposal-step">
      <span class="step-num">${i + 1}</span>
      <span>${escHtml(ph.text)}</span>
    </div>`).join('');
  return `
    <div class="project-proposal" data-project='${escHtml(JSON.stringify(proj))}' style="--card-color:${color}">
      <div class="proposal-header">
        <span class="proposal-pip" style="background:${color}"></span>
        <span class="proposal-title">${escHtml(proj.title)}</span>
        <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(catLabel)}</span>
        <span class="proposal-q-badge" style="border-color:#5A7A9A30;color:#5A7A9A">中長期</span>
      </div>
      ${proj.goal ? `<div class="proposal-goal">${escHtml(proj.goal)}</div>` : ''}
      ${phasesHtml ? `<div class="proposal-steps">${phasesHtml}</div>` : ''}
      <div class="proposal-actions">
        <button class="btn-primary btn-confirm-project">プロジェクトを作成</button>
        <button class="btn-ghost btn-modify-project">修正する</button>
      </div>
    </div>`;
}

function buildProposalHtml(task) {
  const color    = categoryColor(task.category);
  const catLabel = categoryLabel(task.category);
  const q        = taskQuadrant(task);
  const qLabel   = QUADRANT_CONFIG[q]?.label || '';

  const steps = (task.roadmap || []).map((r, i) => `
    <div class="proposal-step"><span class="step-num">${i+1}</span><span>${escHtml(r.text)}</span></div>`).join('');
  const checks = (task.checklist || []).map(c => `
    <div class="proposal-check"><span class="check-icon">□</span><span>${escHtml(c.text)}</span></div>`).join('');

  return `
    <div class="task-proposal" data-task='${escHtml(JSON.stringify(task))}' style="--card-color:${color}">
      <div class="proposal-header">
        <span class="proposal-pip" style="background:${color}"></span>
        <span class="proposal-title">${escHtml(task.title)}</span>
        <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(catLabel)}</span>
        <span class="proposal-q-badge" style="border-color:${QUADRANT_CONFIG[q]?.color}20;color:${QUADRANT_CONFIG[q]?.color}">${qLabel}</span>
      </div>
      ${steps ? `<div class="proposal-steps">${steps}</div>` : ''}
      ${checks ? `<div class="proposal-checks">${checks}</div>` : ''}
      <div class="proposal-actions">
        <button class="btn-primary btn-confirm-task">作成する</button>
        <button class="btn-ghost btn-modify-task">修正する</button>
      </div>
    </div>`;
}

function renderChatWelcome() {
  const container = chatMessagesEl();
  resetMilestone();
  if (chatMode === 'task') {
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="welcome-mark">✦</div>
        <h3 class="welcome-title">タスク整理アシスタント</h3>
        <p class="welcome-desc">まず、どちらを作成しますか？</p>
        <div class="task-type-buttons">
          <button class="btn-task-type" data-type="task">
            <span class="task-type-icon">🎯</span>
            <span class="task-type-name">単発タスク</span>
            <span class="task-type-desc">短期・単発の作業</span>
          </button>
          <button class="btn-task-type" data-type="project">
            <span class="task-type-icon">🗓️</span>
            <span class="task-type-name">プロジェクト</span>
            <span class="task-type-desc">中長期の目標</span>
          </button>
          <button class="btn-task-type" data-type="habit">
            <span class="task-type-icon">🔁</span>
            <span class="task-type-name">習慣</span>
            <span class="task-type-desc">毎日・毎週の繰り返し</span>
          </button>
        </div>
      </div>`;
  } else {
    container.innerHTML = `
      <div class="chat-welcome dump-welcome">
        <div class="welcome-mark">◎</div>
        <h3 class="welcome-title">頭の整理スペース</h3>
        <p class="welcome-desc">タスクとは切り離して、今頭にあることを<br>自由に話しかけてください。<br>整理できたら「保存」ボタンで記録できます。</p>
      </div>`;
  }
}

function resetChat() { chatHistories[chatMode] = []; _saveChats(); resetMilestone(); renderChatWelcome(); }

function switchChatMode(mode) {
  if (chatMode === mode) return;
  chatMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  const saveBtn = document.getElementById('chat-save');
  if (saveBtn) saveBtn.classList.toggle('hidden', mode !== 'dump');
  document.getElementById('typing-indicator').classList.add('hidden');
  resetMilestone();
  const container = chatMessagesEl();
  container.innerHTML = '';
  const history = chatHistories[mode];
  if (history.length === 0) renderChatWelcome();
  else for (const msg of history) appendMessage(msg.role, msg.content, []);
}

function showTyping() {
  document.getElementById('typing-indicator').classList.remove('hidden');
  chatMessagesEl().scrollTop = chatMessagesEl().scrollHeight;
}
function hideTyping() { document.getElementById('typing-indicator').classList.add('hidden'); }

async function sendChatMessage(text) {
  if (!text.trim() || isSending) return;
  isSending = true;
  const sendBtn = document.getElementById('chat-send');
  sendBtn.disabled = true;
  const history = chatHistories[chatMode];
  history.push({ role: 'user', content: text });
  _saveChats();
  appendMessage('user', text);
  const textarea = document.getElementById('chat-input');
  textarea.value = ''; textarea.style.height = 'auto';
  showTyping();
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, mode: chatMode }),
    });
    const data = await res.json();
    hideTyping();
    history.push({ role: 'assistant', content: data.response });
    _saveChats();
    const proposals      = chatMode === 'task' ? (data.task_proposals    || []) : [];
    const projProposals  = chatMode === 'task' ? (data.project_proposals || []) : [];
    const habitProposals = chatMode === 'task' ? (data.habit_proposals   || []) : [];
    appendMessage('assistant', data.response, proposals, projProposals, habitProposals);
    if (chatMode === 'task') updateMilestoneFromResponse(data.response);
  } catch {
    hideTyping();
    appendMessage('assistant', '申し訳ありません。エラーが発生しました。もう一度お試しください。');
  }
  isSending = false;
  sendBtn.disabled = false;
  document.getElementById('chat-input').focus();
}

async function saveDumpSession() {
  const history = chatHistories['dump'];
  if (history.length === 0 || isSaving) return;
  isSaving = true;
  const saveBtn = document.getElementById('chat-save');
  saveBtn.disabled = true; saveBtn.textContent = '保存中...';
  try {
    const res = await fetch('/api/braindump/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    appendMessage('assistant', `✓ 「${data.title}」として保存しました。`);
    setTimeout(() => { chatHistories['dump'] = []; _saveChats(); renderChatWelcome(); }, 2200);
  } catch {
    appendMessage('assistant', '保存中にエラーが発生しました。もう一度お試しください。');
  }
  isSaving = false; saveBtn.disabled = false; saveBtn.textContent = '保存';
}

// Confirm task proposal
document.addEventListener('click', async e => {
  const confirmBtn = e.target.closest('.btn-confirm-task');
  if (confirmBtn) {
    const card = confirmBtn.closest('.task-proposal');
    if (!card) return;
    let taskData;
    try { taskData = JSON.parse(card.dataset.task); } catch { return; }
    const roadmap = (taskData.roadmap || []).map((r, i) => ({ id: String(Date.now() + i), text: r.text, done: false }));
    const checklist = (taskData.checklist || []).map((c, i) => ({ id: String(Date.now() + 1000 + i), text: c.text, done: false }));
    await createTask(
      taskData.title, taskData.importance || 'high', taskData.urgency || 'high',
      roadmap, taskData.category || 'life', taskData.deadline || null,
      taskData.tags || [], checklist
    );
    renderMatrix();
    card.innerHTML = `<div class="proposal-confirmed">✓ タスク「${escHtml(taskData.title)}」を作成しました</div>`;
    chatHistories['task'].push({ role: 'assistant', content: `タスク「${taskData.title}」を作成しました。` });
    setTimeout(() => switchTab('tasks'), 800);
    setTimeout(() => switchTab('chat'), 2400);
    return;
  }
  const modifyBtn = e.target.closest('.btn-modify-task');
  if (modifyBtn) {
    const input = document.getElementById('chat-input');
    input.value = 'もう少し内容を調整したいです。';
    input.focus(); input.setSelectionRange(0, input.value.length);
  }

  const confirmProjBtn = e.target.closest('.btn-confirm-project');
  if (confirmProjBtn) {
    const card = confirmProjBtn.closest('.project-proposal');
    if (!card) return;
    let projData;
    try { projData = JSON.parse(card.dataset.project); } catch { return; }
    await createProject(projData);
    card.innerHTML = `<div class="proposal-confirmed">✓ プロジェクト「${escHtml(projData.title)}」を作成しました</div>`;
    chatHistories['task'].push({ role: 'assistant', content: `プロジェクト「${projData.title}」を作成しました。` });
    setTimeout(() => { switchTab('tasks'); switchTasksSubView('project'); }, 800);
    return;
  }

  const modifyProjBtn = e.target.closest('.btn-modify-project');
  if (modifyProjBtn) {
    const input = document.getElementById('chat-input');
    input.value = 'もう少し内容を調整したいです。';
    input.focus(); input.setSelectionRange(0, input.value.length);
  }

  const confirmHabitBtn = e.target.closest('.btn-confirm-habit');
  if (confirmHabitBtn) {
    const card = confirmHabitBtn.closest('.habit-proposal');
    if (!card) return;
    let habitData;
    try { habitData = JSON.parse(card.dataset.habit); } catch { return; }
    const habit = await apiFetch('/api/habits', {
      method: 'POST',
      body: JSON.stringify({
        title:     habitData.title,
        category:  habitData.category  || 'life',
        frequency: habitData.frequency || 'daily',
        tags:      habitData.tags      || [],
        notes:     habitData.notes     || '',
      }),
    });
    if (!habit) return;
    card.innerHTML = `<div class="proposal-confirmed">✓ 習慣「${escHtml(habitData.title)}」を作成しました</div>`;
    chatHistories['task'].push({ role: 'assistant', content: `習慣「${habitData.title}」を作成しました。` });
    return;
  }

  const modifyHabitBtn = e.target.closest('.btn-modify-habit');
  if (modifyHabitBtn) {
    const input = document.getElementById('chat-input');
    input.value = 'もう少し内容を調整したいです。';
    input.focus(); input.setSelectionRange(0, input.value.length);
  }

  const confirmPhaseTaskBtn = e.target.closest('.btn-confirm-phase-task');
  if (confirmPhaseTaskBtn) {
    const proposalCard = confirmPhaseTaskBtn.closest('.task-proposal');
    if (!proposalCard) return;
    let taskData;
    try { taskData = JSON.parse(proposalCard.dataset.task); } catch { return; }
    const roadmap   = (taskData.roadmap   || []).map((r, i) => ({ id: String(Date.now() + i),        text: r.text, done: false }));
    const checklist = (taskData.checklist || []).map((c, i) => ({ id: String(Date.now() + 1000 + i), text: c.text, done: false }));
    const task = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: taskData.title, importance: taskData.importance || 'high',
        urgency: taskData.urgency || 'high', roadmap, checklist,
        category: taskData.category || 'life', deadline: taskData.deadline || null,
        tags: taskData.tags || [], project_id: taskData.project_id, phase_id: taskData.phase_id,
      }),
    });
    if (!task) return;
    allTasks.push(task); _saveCachedTasks(allTasks); logEvent(task.id, 'task_created');
    await loadProjects();
    proposalCard.innerHTML = `<div class="proposal-confirmed">✓ タスク「${escHtml(taskData.title)}」を作成しました</div>`;
    renderMatrix(); renderTodayView(); renderProjectView();
    return;
  }

  const modifyPhaseTaskBtn = e.target.closest('.btn-modify-phase-task');
  if (modifyPhaseTaskBtn) {
    const phaseDetail = modifyPhaseTaskBtn.closest('.phase-detail');
    if (!phaseDetail) return;
    const chatInput = phaseDetail.querySelector('.phase-chat-input');
    if (chatInput) {
      chatInput.value = '修正したい点があります。';
      chatInput.focus();
      chatInput.setSelectionRange(0, chatInput.value.length);
    }
  }
});

/* ═══════════════════════════════════════════════════════════
   Tab switching
═══════════════════════════════════════════════════════════ */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
}

/* ═══════════════════════════════════════════════════════════
   Modal
═══════════════════════════════════════════════════════════ */
function openModal() {
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.classList.add('open');
  backdrop.removeAttribute('aria-hidden');
  setTimeout(() => document.getElementById('input-task-title').focus(), 50);
}
function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
  document.getElementById('input-task-title').value = '';
  document.querySelectorAll('input[name="new-importance"]').forEach(r => { r.checked = r.value === 'high'; });
  document.querySelectorAll('input[name="new-urgency"]').forEach(r => { r.checked = r.value === 'high'; });
  document.getElementById('input-task-category').value = 'life';
  document.getElementById('input-task-deadline').value = '';
}

/* ═══════════════════════════════════════════════════════════
   Boot
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  _setOfflineBanner(!isOnline);
  await loadTasks();
  await loadProjects();
  await loadHabits();
  renderMatrix();

  _loadChats();
  if (chatHistories[chatMode].length > 0) {
    const container = chatMessagesEl();
    container.innerHTML = '';
    for (const msg of chatHistories[chatMode]) appendMessage(msg.role, msg.content, []);
  }

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'archive')  renderArchivePanel();
      if (btn.dataset.tab === 'schedule') renderSchedulePanel();
      if (btn.dataset.tab === 'report')   renderReportPanel();
      if (btn.dataset.tab === 'memo')     renderMemoPanel(true);
    })
  );

  // Tasks sub-tab switching
  document.querySelectorAll('.tasks-subtab').forEach(btn =>
    btn.addEventListener('click', () => switchTasksSubView(btn.dataset.tasksView))
  );

  // Quadrant expand (drilldown)
  document.querySelectorAll('.btn-q-expand').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const q = btn.closest('.quadrant').dataset.q;
      if (drilldownQ === q) exitDrilldown();
      else enterDrilldown(q);
    });
  });

  // Habit week button (event delegation — today only)
  document.getElementById('tasks-view-habit').addEventListener('click', async e => {
    const btn = e.target.closest('.hg-sq.today');
    if (!btn) return;
    const habitId = btn.dataset.habitId;
    const dateStr = btn.dataset.date;
    if (!habitId || !dateStr) return;
    const habit   = allHabits.find(h => h.id === habitId);
    if (!habit) return;
    const newDone = !habit.today_done;
    await apiFetch(`/api/habits/${habitId}/log`, {
      method: 'POST',
      body: JSON.stringify({ date: dateStr, done: newDone }),
    });
    habit.today_done = newDone;
    habit.week_done  = { ...habit.week_done, [dateStr]: newDone };
    const stats = await apiFetch(`/api/habits/${habitId}/stats`);
    habit.current_streak = stats.current_streak;
    renderHabitView();
    renderMatrix();
    renderTodayView();
  });

  // パレット外クリックで閉じる
  document.addEventListener('click', e => {
    if (!e.target.closest('.hg-palette-details')) {
      document.querySelectorAll('.hg-palette-details[open]').forEach(d => d.removeAttribute('open'));
    }
  });

  // Habit palette color selection
  document.getElementById('tasks-view-habit').addEventListener('click', e => {
    const swatch = e.target.closest('.hg-swatch');
    if (!swatch) return;
    const details = swatch.closest('.hg-palette-details');
    const habitId = details?.dataset.habitId;
    if (!habitId) return;
    const color = swatch.dataset.color;
    const h = allHabits.find(x => x.id === habitId);
    if (!h) return;
    h.color = color;
    apiFetch(`/api/habits/${habitId}`, { method: 'PUT', body: JSON.stringify({ color }) });
    details.removeAttribute('open');
    renderHabitView();
    renderMatrix();
    renderTodayView();
  });

  // Habit delete
  document.getElementById('tasks-view-habit').addEventListener('click', async e => {
    const btn = e.target.closest('.hg-delete-btn');
    if (!btn) return;
    const habitId = btn.dataset.habitId;
    const h = allHabits.find(x => x.id === habitId);
    if (!h) return;
    if (!confirm(`「${h.title}」を削除しますか？\nログもすべて削除されます。`)) return;
    await apiFetch(`/api/habits/${habitId}`, { method: 'DELETE' });
    allHabits = allHabits.filter(x => x.id !== habitId);
    renderHabitView();
    renderMatrix();
    renderTodayView();
  });

  // Drilldown back button
  document.getElementById('btn-matrix-back').addEventListener('click', exitDrilldown);

  // Detail panel close
  document.getElementById('detail-panel-close').addEventListener('click', closeDetailPanel);

  // Chat mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => switchChatMode(btn.dataset.mode))
  );

  // Memo view toggle
  document.querySelectorAll('.memo-view-btn').forEach(btn =>
    btn.addEventListener('click', () => switchMemoView(btn.dataset.view))
  );
  document.getElementById('memo-nav-prev').addEventListener('click', () => {
    memoRefDate.setMonth(memoRefDate.getMonth() - 1); renderMemoPanel();
  });
  document.getElementById('memo-nav-next').addEventListener('click', () => {
    memoRefDate.setMonth(memoRefDate.getMonth() + 1); renderMemoPanel();
  });

  // Chat save
  document.getElementById('chat-save').addEventListener('click', saveDumpSession);

  // Report
  document.getElementById('btn-run-report').addEventListener('click', renderReportPanel);
  document.getElementById('btn-ai-report').addEventListener('click', async () => {
    const btn     = document.getElementById('btn-ai-report');
    const resultEl = document.getElementById('report-ai-result');
    const textEl   = document.getElementById('ai-result-text');
    if (!resultEl || !textEl) { await renderReportPanel(); return; }
    btn.disabled = true; btn.textContent = '分析中...';
    resultEl.classList.remove('hidden');
    textEl.innerHTML = '<div class="report-loading-sm">AIが分析中です...</div>';
    try {
      const data = await apiFetch('/api/analyze/ai', { method: 'POST' });
      textEl.innerHTML = formatMarkdown(data.response || '分析できませんでした');
    } catch { textEl.innerHTML = 'エラーが発生しました。'; }
    btn.disabled = false; btn.textContent = 'AI分析';
  });

  // Schedule view toggle
  document.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scheduleView = btn.dataset.view; scheduleRefDate = new Date();
      renderSchedulePanel();
    })
  );
  document.getElementById('schedule-nav-prev').addEventListener('click', () => {
    if (scheduleView === 'month') scheduleRefDate.setMonth(scheduleRefDate.getMonth() - 1);
    else if (scheduleView === 'week') scheduleRefDate.setDate(scheduleRefDate.getDate() - 7);
    renderSchedulePanel();
  });
  document.getElementById('schedule-nav-next').addEventListener('click', () => {
    if (scheduleView === 'month') scheduleRefDate.setMonth(scheduleRefDate.getMonth() + 1);
    else if (scheduleView === 'week') scheduleRefDate.setDate(scheduleRefDate.getDate() + 7);
    renderSchedulePanel();
  });

  // Archive toolbar
  document.getElementById('archive-search').addEventListener('input', onArchiveSearchInput);
  document.getElementById('filter-category').addEventListener('change', renderArchivePanel);
  document.getElementById('filter-sort').addEventListener('change', renderArchivePanel);

  // Add task modal
  document.getElementById('btn-add-task').addEventListener('click', openModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

  document.getElementById('btn-modal-save').addEventListener('click', async () => {
    const title = document.getElementById('input-task-title').value.trim();
    if (!title) { document.getElementById('input-task-title').focus(); return; }
    const importance = document.querySelector('input[name="new-importance"]:checked')?.value || 'high';
    const urgency    = document.querySelector('input[name="new-urgency"]:checked')?.value    || 'high';
    const category   = document.getElementById('input-task-category').value || 'life';
    const deadline   = document.getElementById('input-task-deadline').value || null;
    await createTask(title, importance, urgency, [], category, deadline);
    closeModal();
    renderMatrix();
  });

  document.getElementById('input-task-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-modal-save').click();
    if (e.key === 'Escape') closeModal();
  });

  // Chat reset & send
  document.getElementById('chat-reset').addEventListener('click', resetChat);
  document.getElementById('chat-send').addEventListener('click', () => sendChatMessage(document.getElementById('chat-input').value));

  // Task type selection buttons (event delegation — works for initial HTML and re-rendered welcome)
  document.getElementById('chat-messages').addEventListener('click', e => {
    const btn = e.target.closest('.btn-task-type');
    if (btn) selectTaskType(btn.dataset.type);
  });

  const isMobile = window.matchMedia('(max-width: 600px)').matches;
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendChatMessage(chatInput.value); }
    else if (e.key === 'Enter' && isMobile && !e.shiftKey) { e.preventDefault(); sendChatMessage(chatInput.value); }
  });
  chatInput.addEventListener('input', () => {
    chatInput.style.height = '22px';
    const newH = Math.min(chatInput.scrollHeight, 160);
    chatInput.style.height = newH + 'px';
    chatInput.style.overflowY = newH >= 160 ? 'auto' : 'hidden';
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('modal-backdrop').classList.contains('open')) closeModal();
      else if (drilldownQ) exitDrilldown();
      else if (currentTaskId) closeDetailPanel();
    }
    if (e.ctrlKey && e.key === 'n') {
      if (document.getElementById('panel-tasks').classList.contains('active')) {
        e.preventDefault(); openModal();
      }
    }
  });
});
