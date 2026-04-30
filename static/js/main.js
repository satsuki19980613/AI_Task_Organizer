/* ═══════════════════════════════════════════════════════════
   Config (GTD v2)
═══════════════════════════════════════════════════════════ */

// 親カテゴリのフォールバック（DB から /api/categories で取得するまで使用）
const FALLBACK_PARENT_CATEGORIES = {
  cat_output:  { id: 'cat_output',  name: 'Output',    icon: '📤', color: '#4F46E5', parent_id: null, sort_order: 10 },
  cat_input:   { id: 'cat_input',   name: 'Input',     icon: '📥', color: '#059669', parent_id: null, sort_order: 20 },
  cat_work:    { id: 'cat_work',    name: 'Work',      icon: '🛠', color: '#DC2626', parent_id: null, sort_order: 30 },
  cat_session: { id: 'cat_session', name: 'Session',   icon: '👥', color: '#D97706', parent_id: null, sort_order: 40 },
  cat_routine: { id: 'cat_routine', name: 'ルーティン', icon: '🔁', color: '#7C3AED', parent_id: null, sort_order: 50 },
};

// gtd_status のラベルとアイコン
const STATUS_CONFIG = {
  inbox:           { label: 'オプションなし', icon: '📥', color: '#7A8C9B', desc: '仕分け待ち' },
  next_action:     { label: '次にやるべきこと', icon: '🎯', color: '#5B8FBF', desc: '今週中にやる' },
  waiting:         { label: '依頼中・連絡待ち', icon: '⏳', color: '#D97706', desc: '他者の対応待ち' },
  calendar:        { label: 'カレンダー',     icon: '📅', color: '#059669', desc: '特定日にやる' },
  project_pending: { label: 'プロジェクト化',  icon: '🗂', color: '#7C3AED', desc: '複数ステップ要' },
  someday:         { label: 'いつかやる',     icon: '💭', color: '#8E8E93', desc: '来週以降に検討' },
  trash:           { label: 'ゴミ箱',         icon: '🗑', color: '#9CA3AF', desc: '保管庫' },
  done:            { label: '完了',           icon: '✓',  color: '#10B981', desc: '完了済み' },
};

// 中央カラムの並び順
const LIST_ORDER = ['next_action', 'waiting', 'calendar', 'project_pending', 'someday', 'trash'];

// プロジェクト状態のラベル
const PROJECT_STATUS_LABEL = {
  drafting:  '🟡 作成中',
  active:    '🟢 進行中',
  completed: '✅ 完了',
  archived:  '📦 アーカイブ',
};

// HABIT_PALETTE は習慣カラーピッカーで残置
const HABIT_PALETTE = [
  '#00FFFF','#FF00FF','#FFFF00','#00FF41',
  '#FF003C','#0FF0FC','#FF6600','#BC13FE',
  '#FF1493','#39FF14','#00BFFF','#FF073A',
];

/* ═══════════════════════════════════════════════════════════
   Categories cache (loaded from /api/categories)
═══════════════════════════════════════════════════════════ */
let allCategoriesFlat = Object.values(FALLBACK_PARENT_CATEGORIES);
let allCategoriesTree = [];   // [{...parent, children: [...]}]

function categoryById(id) {
  if (!id) return null;
  return allCategoriesFlat.find(c => c.id === id) || null;
}

function resolveParentCategory(id) {
  let cur = categoryById(id);
  for (let i = 0; i < 5 && cur && cur.parent_id; i++) {
    cur = categoryById(cur.parent_id);
  }
  return cur;
}

function categoryColor(id) {
  const c = categoryById(id);
  return c?.color || '#7A8C9B';
}

function categoryLabel(id) {
  const c = categoryById(id);
  if (!c) return '';
  return c.name;
}

function categoryIcon(id) {
  const c = categoryById(id);
  return c?.icon || '';
}

function habitColor(h) {
  return h.color || categoryColor(h.category_id || 'cat_routine');
}

async function loadCategories() {
  try {
    const data = await apiFetch('/api/categories');
    if (data && Array.isArray(data.all)) {
      allCategoriesFlat = data.all;
      allCategoriesTree = Array.isArray(data.parents) ? data.parents : [];
    }
  } catch {
    // フォールバック維持
  }
}

function populateCategorySelects() {
  const opts = allCategoriesFlat.map(c =>
    `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`
  ).join('');
  const placeholder = '<option value="">（未設定）</option>';
  ['ds-category-id', 'archive-category-filter', 'input-task-category'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = placeholder + opts;
  });
}

function switchTasksSubView(view) {
  tasksSubView = view;
  document.querySelectorAll('.tasks-subview-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tasksView === view)
  );
  document.getElementById('tasks-subview-board')?.classList.toggle('hidden', view !== 'board');
  document.getElementById('tasks-subview-habits')?.classList.toggle('hidden', view !== 'habits');
  const addHabitBtn = document.getElementById('btn-add-habit-toolbar');
  if (addHabitBtn) addHabitBtn.classList.toggle('hidden', view !== 'habits');
  const addTaskBtn = document.getElementById('btn-add-task');
  if (addTaskBtn) addTaskBtn.classList.toggle('hidden', view !== 'board');
  if (view === 'habits') { closeDetailPanel(); renderHabitView(); }
}

/* ═══════════════════════════════════════════════════════════
   State
═══════════════════════════════════════════════════════════ */
let allTasks        = [];
let currentTaskId   = null;
let allHabits       = [];
let allProjects     = [];
let projectsView    = 'active';   // 'active' | 'drafting' | 'completed'
let listCollapseState = { waiting: true, calendar: true, project_pending: true, someday: true, trash: true }; // next_action は初期展開
let tasksSubView    = 'board';    // 'board' | 'habits'

function habitAsTask(h) {
  return {
    id: h.id, title: h.title,
    category_id: h.category_id || 'cat_routine',
    tags:        h.tags || [],
    deadline:    null, roadmap: [], checklist: [],
    completed:   h.today_done === true,
    _isHabit:    true,
  };
}
let isSending       = false;
let isSaving        = false;
let chatMode        = 'dump';
const chatHistories = { dump: [] };
const taskChatHistories = {};
let scheduleView    = 'list';
let scheduleRefDate = new Date();
let memoView        = 'tree';
let memoRefDate     = new Date();
let memoSessionsCache = null;
let diaryMode       = 'write';    // 'write' | 'view'
let diaryView       = 'calendar'; // 'calendar' | 'daily'
let diaryRefDate    = new Date();
let diarySelectedDate = null;     // YYYY-MM-DD for daily view
let diaryEntriesCache = null;
let diaryFormReady  = false;
let diaryTimelineChart = null;
// allProjects は v2 で State セクションに集約済み
const projectChatHistories = {};

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
    renderTasksBoard();
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
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr() { return dateStr(new Date()); }
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
function logEvent(_taskId, _action) {
  // GTD 改修で /api/log は廃止（docs/GTD_DESIGN.md Sect.6.3）。
  // 呼び出し元多数のため関数シグネチャだけ残して no-op 化する。
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

async function createTask(taskData) {
  // v2: title/category_id/estimate_minutes/deadline 等を任意フィールドで受ける
  if (!isOnline) {
    const tempId = 'tmp_' + Date.now();
    const task = {
      id: tempId,
      gtd_status: 'inbox',
      is_draft: true,
      tags: [], roadmap: [], checklist: [], notes: '',
      completed: false,
      created_at: new Date().toISOString().slice(0, 19),
      ...taskData,
    };
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
    const stats = await apiFetch(`/api/habits/${habitId}/stats`);
    h.current_streak = stats.current_streak;
  }
  renderTasksBoard();
  refreshDailyPanels();
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

async function archiveTask(taskId) {
  logEvent(taskId, 'task_archived');
  if (isOnline) {
    await apiFetch(`/api/tasks/${taskId}/archive`, { method: 'POST' });
  } else {
    _pushOp({ type: 'archive', id: taskId });
  }
  allTasks = allTasks.filter(t => t.id !== taskId);
  _saveCachedTasks(allTasks);
  if (currentTaskId === taskId) closeDetailPanel();
  renderTasksBoard();
  refreshDailyPanels();
}

function getInboxTasks() {
  return allTasks
    .filter(t => (t.gtd_status || 'inbox') === 'inbox' && !t.completed)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function getTasksByStatus(status) {
  return allTasks
    .filter(t => t.gtd_status === status && !t.completed)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function getDraftTasks() {
  return allTasks
    .filter(t => t.is_draft && !t.completed)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
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
   Mobile Move Sheet (スマホ専用ボトムシート)
═══════════════════════════════════════════════════════════ */

function showMobileMoveSheet(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  const overlay = document.getElementById('mobile-sheet-overlay');
  const body    = document.getElementById('mobile-sheet-body');
  const title   = document.getElementById('mobile-sheet-task');
  if (!overlay) return;

  title.textContent = task.title || '(無題)';
  body.innerHTML = '';

  const addItem = (icon, label, fn) => {
    const btn = document.createElement('button');
    btn.className = 'mobile-sheet-item';
    btn.innerHTML = `<span class="mobile-sheet-item-icon">${icon}</span><span>${escHtml(label)}</span>`;
    btn.addEventListener('click', () => { closeMobileMoveSheet(); fn(); });
    body.appendChild(btn);
  };
  const addSep = () => {
    const sep = document.createElement('div');
    sep.className = 'mobile-sheet-sep';
    body.appendChild(sep);
  };

  // スケジュール操作 (inbox・完了以外)
  if (task.gtd_status !== 'inbox' && !task.completed) {
    if (task.scheduled_for === 'today') {
      addItem('✕', '今日から外す', () => scheduleTaskToSlot(taskId, null));
    } else {
      addItem('📅', '今日に追加', () => scheduleTaskToSlot(taskId, 'today'));
    }
    if (task.scheduled_for === 'tomorrow') {
      addItem('✕', '明日から外す', () => scheduleTaskToSlot(taskId, null));
    } else {
      addItem('📅', '明日に追加', () => scheduleTaskToSlot(taskId, 'tomorrow'));
    }
    addSep();
  }

  // 仕分け操作 (gtd_status 変更)
  const moveTargets = task.gtd_status === 'inbox'
    ? LIST_ORDER
    : ['inbox', ...LIST_ORDER].filter(s => s !== task.gtd_status);
  for (const status of moveTargets) {
    const cfg = STATUS_CONFIG[status] || {};
    addItem(cfg.icon || '→', cfg.label || status, () => attemptMoveTask(taskId, status));
  }

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeMobileMoveSheet() {
  const overlay = document.getElementById('mobile-sheet-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function moveTask(taskId, targetStatus, forceParams = {}) {
  const res = await apiFetch('/api/tasks/move', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, target_status: targetStatus, ...forceParams }),
  });
  if (res.ok === false) return res;
  const updated = res.task || res;
  if (updated && updated.id) {
    const idx = allTasks.findIndex(t => t.id === updated.id);
    if (idx >= 0) allTasks[idx] = updated; else allTasks.push(updated);
    _saveCachedTasks(allTasks);
  }
  renderTasksBoard();
  refreshDailyPanels();
  return res;
}

/* ═══════════════════════════════════════════════════════════
   Tasks Board (v2: 3カラム)
═══════════════════════════════════════════════════════════ */

function renderTasksBoard() {
  const total = allTasks.filter(t => !t.completed).length;
  const inboxCount = getInboxTasks().length;
  document.getElementById('task-count').textContent =
    total === 0 ? '' : `アクティブ ${total} 件 / 仕分け待ち ${inboxCount} 件`;
  renderInboxColumn();
  renderListColumn();
}

function buildTaskCard(task, opts = {}) {
  const color      = categoryColor(task.category_id);
  const icon       = categoryIcon(task.category_id);
  const doneSteps  = (task.roadmap || []).filter(r => r.done).length;
  const totalSteps = (task.roadmap || []).length;
  const pct        = totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0;
  const dlStatus   = task.deadline ? deadlineStatus(task.deadline) : '';

  const card = document.createElement('div');
  card.className = `board-card${task.completed ? ' completed' : ''}${task.id === currentTaskId ? ' selected' : ''}${task.is_draft ? ' is-draft' : ''}`;
  card.dataset.taskId = task.id;
  card.draggable = true;
  card.style.setProperty('--card-color', color);

  const dlHtml = task.deadline
    ? `<span class="tag-deadline dl-${dlStatus}">${formatDeadlineShort(task.deadline)}</span>` : '';
  const estHtml = task.estimate_minutes
    ? `<span class="tag-estimate">⏱ ${task.estimate_minutes}分</span>` : '';
  const catHtml = task.category_id
    ? `<span class="tag-category" style="color:${color}">${icon} ${escHtml(categoryLabel(task.category_id))}</span>` : '';
  const draftHtml = task.is_draft ? '<span class="tag-draft">下書き</span>' : '';
  const projectHtml = task.project_id
    ? '<span class="tag-project">🗂 プロジェクト</span>' : '';
  const progressHtml = totalSteps > 0 ? `
    <div class="card-progress">
      <span class="card-steps-text">${doneSteps}/${totalSteps}</span>
      <div class="card-progress-bar"><div class="card-progress-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>` : '';

  card.innerHTML = `
    <div class="card-body">
      <input class="task-checkbox" type="checkbox" ${task.completed ? 'checked' : ''}>
      <div class="card-info">
        <div class="card-title">${escHtml(task.title || '(無題)')}</div>
        <div class="card-tags">
          ${catHtml}
          ${estHtml}
          ${dlHtml}
          ${draftHtml}
          ${projectHtml}
        </div>
        ${progressHtml}
      </div>
      <button class="card-move-btn" title="移動">⇄</button>
    </div>
  `;

  card.querySelector('.task-checkbox').addEventListener('change', async e => {
    e.stopPropagation();
    if (e.target.checked) {
      await patchTask(task.id, { completed: true, gtd_status: 'done' });
      renderTasksBoard();
      if (currentTaskId === task.id) openDetailPanel(task.id);
      const tid = task.id;
      setTimeout(async () => {
        if (allTasks.some(t => t.id === tid && t.completed)) await archiveTask(tid);
      }, 600);
    } else {
      await patchTask(task.id, { completed: false });
      renderTasksBoard();
      if (currentTaskId === task.id) openDetailPanel(task.id);
    }
  });
  card.addEventListener('click', e => {
    if (e.target.matches('.task-checkbox')) return;
    if (e.target.closest('.card-move-btn')) return;
    openDetailPanel(task.id);
  });
  card.querySelector('.card-move-btn').addEventListener('click', e => {
    e.stopPropagation();
    showMobileMoveSheet(task.id);
  });

  // D&D
  card.addEventListener('dragstart', e => {
    draggedTaskId = task.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', task.id); } catch {}
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedTaskId = null;
  });

  return card;
}

function renderInboxColumn() {
  const body  = document.getElementById('board-inbox-body');
  const count = document.getElementById('board-inbox-count');
  if (!body) return;
  const tasks = getInboxTasks();
  count.textContent = tasks.length;
  body.innerHTML = '';
  if (!tasks.length) {
    body.innerHTML = '<div class="board-col-empty">仕分け待ちのタスクはありません</div>';
    return;
  }
  for (const t of tasks) body.appendChild(buildTaskCard(t));
}

function renderListColumn() {
  const wrap = document.getElementById('board-lists-body');
  if (!wrap) return;
  wrap.innerHTML = '';

  for (const status of LIST_ORDER) {
    const cfg = STATUS_CONFIG[status];
    const tasks = getTasksByStatus(status);
    const collapsed = !!listCollapseState[status];
    const sec = document.createElement('section');
    sec.className = `board-list-section${collapsed ? ' collapsed' : ''}`;
    sec.dataset.status = status;
    sec.innerHTML = `
      <div class="board-list-head" data-toggle-status="${status}" ${collapsed ? `data-drop-status="${status}"` : ''} style="--col-color:${cfg.color}">
        <span class="list-toggle">${collapsed ? '▸' : '▾'}</span>
        <span class="list-icon">${cfg.icon}</span>
        <span class="list-label">${escHtml(cfg.label)}</span>
        <span class="list-count">${tasks.length}</span>
      </div>
      <div class="board-list-body" data-drop-status="${status}"></div>
    `;
    const listBody = sec.querySelector('.board-list-body');
    if (!tasks.length) {
      listBody.innerHTML = '<div class="board-col-empty">なし</div>';
    } else {
      for (const t of tasks) listBody.appendChild(buildTaskCard(t));
    }
    if (collapsed) listBody.classList.add('hidden');
    wrap.appendChild(sec);
  }
}

function toggleListSection(status) {
  listCollapseState[status] = !listCollapseState[status];
  renderListColumn();
}

function renderWorkflowDiagram() {
  const body = document.getElementById('board-flow-body');
  if (!body) return;
  body.innerHTML = `
    <div class="flow-card">
      <div class="flow-step flow-question">
        <span class="flow-q">Q1</span> やる必要がある？
      </div>
      <div class="flow-arrow">└ No → <strong>🗑 ゴミ箱</strong></div>
      <div class="flow-arrow">└ Yes ↓</div>
      <div class="flow-step flow-question"><span class="flow-q">Q2</span> 自分がやる？</div>
      <div class="flow-arrow">└ No → <strong>⏳ 依頼中・連絡待ち</strong></div>
      <div class="flow-arrow">└ Yes ↓</div>
      <div class="flow-step flow-question"><span class="flow-q">Q3</span> すぐ行動できる？</div>
      <div class="flow-arrow">└ No → <strong>🗂 プロジェクト化</strong></div>
      <div class="flow-arrow">└ Yes ↓</div>
      <div class="flow-step flow-question"><span class="flow-q">Q4</span> 特定日にやる？</div>
      <div class="flow-arrow">└ Yes → <strong>📅 カレンダー</strong></div>
      <div class="flow-arrow">└ No ↓</div>
      <div class="flow-step flow-question"><span class="flow-q">Q5</span> 早めにやる？</div>
      <div class="flow-arrow">└ 今週 → <strong>🎯 次にやるべきこと</strong></div>
      <div class="flow-arrow">└ 来週〜 → <strong>💭 いつかやる</strong></div>
      <div class="flow-divider"></div>
      <div class="flow-hint">左カラムから中央のリストへ D&amp;D で仕分けしてください。</div>
    </div>
  `;
}

/* ── D&D ハンドラ ─────────────────────────────────────────── */

function setupTaskDragDrop() {
  const board = document.getElementById('task-board');
  if (board) {
    board.addEventListener('dragover', e => {
      const dropTarget = e.target.closest('[data-drop-status]');
      if (!dropTarget) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('[data-drop-status].drag-over').forEach(el => el.classList.remove('drag-over'));
      dropTarget.classList.add('drag-over');
    });
    board.addEventListener('dragleave', e => {
      const dropTarget = e.target.closest('[data-drop-status]');
      if (!dropTarget) return;
      if (!dropTarget.contains(e.relatedTarget)) dropTarget.classList.remove('drag-over');
    });
    board.addEventListener('drop', async e => {
      e.preventDefault();
      document.querySelectorAll('[data-drop-status].drag-over').forEach(el => el.classList.remove('drag-over'));
      const dropTarget = e.target.closest('[data-drop-status]');
      if (!dropTarget || !draggedTaskId) return;
      const targetStatus = dropTarget.dataset.dropStatus;
      const task = allTasks.find(t => t.id === draggedTaskId);
      if (!task || task.gtd_status === targetStatus) return;
      await attemptMoveTask(draggedTaskId, targetStatus);
    });
  }

  // Daily panel (today / tomorrow) D&D
  const dailyPanel = document.getElementById('daily-panel');
  if (dailyPanel) {
    dailyPanel.addEventListener('dragover', e => {
      const dropTarget = e.target.closest('[data-drop-scope]');
      if (!dropTarget) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('[data-drop-scope].drag-over').forEach(el => el.classList.remove('drag-over'));
      dropTarget.classList.add('drag-over');
    });
    dailyPanel.addEventListener('dragleave', e => {
      const dropTarget = e.target.closest('[data-drop-scope]');
      if (!dropTarget) return;
      if (!dropTarget.contains(e.relatedTarget)) dropTarget.classList.remove('drag-over');
    });
    dailyPanel.addEventListener('drop', async e => {
      e.preventDefault();
      document.querySelectorAll('[data-drop-scope].drag-over').forEach(el => el.classList.remove('drag-over'));
      const dropTarget = e.target.closest('[data-drop-scope]');
      if (!dropTarget || !draggedTaskId) return;
      const slot = dropTarget.dataset.dropScope; // 'today' | 'tomorrow'
      const task = allTasks.find(t => t.id === draggedTaskId);
      if (!task) return;
      if (task.gtd_status === 'inbox' || task.is_draft) {
        showMoveToast('仕分け済みのタスクを今日/明日に追加できます');
        return;
      }
      await scheduleTaskToSlot(draggedTaskId, slot);
    });
  }
}

async function attemptMoveTask(taskId, targetStatus, forceParams = {}) {
  const res = await apiFetch('/api/tasks/move', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, target_status: targetStatus, ...forceParams }),
  });
  if (!res) return;

  if (res.ok === false) {
    if (res.level === 'error') {
      showMoveToast(res.error || '移動できません');
    } else if (res.level === 'confirm') {
      showMoveConfirm(res.error, async () => {
        await attemptMoveTask(taskId, targetStatus, { [res.force_param]: true, ...forceParams });
      });
    }
    return;
  }

  const updated = res.task || res;
  if (updated && updated.id) {
    const idx = allTasks.findIndex(t => t.id === updated.id);
    if (idx >= 0) allTasks[idx] = updated; else allTasks.push(updated);
    _saveCachedTasks(allTasks);
  }
  renderTasksBoard();
  refreshDailyPanels();
  if (currentTaskId === taskId) renderDetailPanelBody(allTasks.find(t => t.id === taskId));
}

function showMoveToast(msg) {
  const toast = document.getElementById('move-toast');
  if (!toast) { alert(msg); return; }
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

function showMoveConfirm(msg, onConfirm) {
  const bd = document.getElementById('move-confirm-backdrop');
  if (!bd) { if (confirm(msg)) onConfirm(); return; }
  bd.querySelector('#move-confirm-message').textContent = msg;
  bd.classList.add('open');
  const yes = bd.querySelector('#btn-move-confirm-yes');
  const no  = bd.querySelector('#btn-move-confirm-no');
  const cleanup = () => { bd.classList.remove('open'); yes.replaceWith(yes.cloneNode(true)); no.replaceWith(no.cloneNode(true)); };
  bd.querySelector('#btn-move-confirm-yes').addEventListener('click', () => { cleanup(); onConfirm(); }, { once: true });
  bd.querySelector('#btn-move-confirm-no').addEventListener('click', cleanup, { once: true });
}

function getWeekDays() {
  const today      = new Date();
  const todayIso   = todayStr();
  const dayOfWeek  = today.getDay(); // 0=日
  const mondayDiff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday     = new Date(today);
  monday.setDate(today.getDate() + mondayDiff);
  const labels = ['月', '火', '水', '木', '金', '土', '日'];
  return labels.map((label, i) => {
    const d   = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = dateStr(d);
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
        <p class="project-empty-hint">上の「＋ 習慣を追加」ボタンから<br>習慣を登録できます</p>
        <button class="btn-primary" id="btn-empty-add-habit" style="margin-top:16px">＋ 習慣を追加</button>
      </div>`;
    document.getElementById('btn-empty-add-habit')?.addEventListener('click', openHabitFormModal);
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
      const bg = (!future && done === true) ? color : 'var(--glass)';
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

// renderTodayView / buildTodayCard は v2 で削除（今日/明日は daily-panel に集約）

/* ═══════════════════════════════════════════════════════════
   Projects Tab (v2)
═══════════════════════════════════════════════════════════ */

function renderProjectsTab() {
  const grid   = document.getElementById('projects-grid');
  const detail = document.getElementById('project-detail-backdrop');
  if (!grid) return;
  const filter = projectsView || 'active';
  const shown  = allProjects.filter(p => {
    if (filter === 'active')    return p.status === 'active';
    if (filter === 'drafting')  return p.status === 'drafting';
    if (filter === 'completed') return p.status === 'completed' || p.status === 'archived';
    return true;
  });
  grid.innerHTML = '';
  if (!shown.length) {
    grid.innerHTML = `<div class="project-empty"><p>プロジェクトがありません</p><p class="project-empty-hint">「＋ プロジェクト追加」ボタンから作成できます</p></div>`;
    return;
  }
  for (const proj of shown) {
    const color = proj.phases?.length
      ? categoryColor(proj.category_id) : '#7A8C9B';
    const statusLabel = PROJECT_STATUS_LABEL[proj.status] || proj.status;
    const projTasks   = allTasks.filter(t => t.project_id === proj.id && !t.completed);
    const tasksHtml   = projTasks.length
      ? projTasks.map(t => `<div class="pc2-task-item">${escHtml(t.title)}</div>`).join('')
      : '<div class="pc2-no-tasks">タスクがありません</div>';
    const card = document.createElement('div');
    card.className = 'project-card-v2';
    card.style.setProperty('--card-color', color);
    card.innerHTML = `
      <div class="pc2-status">${escHtml(statusLabel)}</div>
      <div class="pc2-title">${escHtml(proj.title)}</div>
      ${proj.goal ? `<div class="pc2-goal">${escHtml(proj.goal)}</div>` : ''}
      <div class="pc2-tasks">${tasksHtml}</div>
      <div class="pc2-meta">
        ${proj.deadline ? `<span>〜${proj.deadline.slice(5).replace('-','/')}</span>` : ''}
        <span>${projTasks.length} タスク</span>
      </div>
    `;
    card.addEventListener('click', () => openProjectDetail(proj.id));
    grid.appendChild(card);
  }
}

let projectDetailId = null;
const projectChatHistory = {};

function openProjectDetail(projId) {
  const proj = allProjects.find(p => p.id === projId);
  if (!proj) return;
  projectDetailId = projId;
  const bd = document.getElementById('project-detail-backdrop');
  if (!bd) return;
  renderProjectDetailBody(proj);
  bd.classList.add('open');
  bd.removeAttribute('aria-hidden');
}

function closeProjectDetail() {
  const bd = document.getElementById('project-detail-backdrop');
  if (bd) { bd.classList.remove('open'); bd.setAttribute('aria-hidden', 'true'); }
  projectDetailId = null;
}

function renderProjectDetailBody(proj) {
  const tasks       = allTasks.filter(t => t.project_id === proj.id && !t.completed);
  const statusLabel = PROJECT_STATUS_LABEL[proj.status] || proj.status;

  const titleInput    = document.getElementById('pd-title');
  const statusBadge   = document.getElementById('pd-status-badge');
  const completionEl  = document.getElementById('pd-completion');
  const periodStartEl = document.getElementById('pd-period-start');
  const periodEndEl   = document.getElementById('pd-period-end');
  const childrenEl    = document.getElementById('pd-children');
  const childrenCount = document.getElementById('pd-children-count');
  const actBtn        = document.getElementById('btn-pd-activate');
  const archiveBtn    = document.getElementById('btn-pd-archive');

  if (titleInput)    titleInput.value    = proj.title || '';
  if (statusBadge)   statusBadge.textContent = statusLabel;
  if (completionEl)  completionEl.value  = proj.completion_condition || '';
  if (periodStartEl) periodStartEl.value = proj.period_start || '';
  if (periodEndEl)   periodEndEl.value   = proj.period_end   || '';
  if (childrenCount) childrenCount.textContent = tasks.length;

  if (actBtn)     actBtn.style.display     = proj.status === 'drafting' ? '' : 'none';
  if (archiveBtn) archiveBtn.style.display = proj.status === 'active'   ? '' : 'none';

  if (childrenEl) {
    if (!tasks.length) {
      childrenEl.innerHTML = '<div class="pd-task-empty">タスクがありません</div>';
    } else {
      childrenEl.innerHTML = tasks.map(t => {
        const color = categoryColor(t.category_id);
        return `<div class="pd-task-item" data-task-id="${escHtml(t.id)}" style="--card-color:${color}">
          <span class="pd-task-title">${escHtml(t.title)}</span>
          ${t.estimate_minutes ? `<span class="pd-task-est">⏱${t.estimate_minutes}分</span>` : ''}
        </div>`;
      }).join('');
      childrenEl.querySelectorAll('.pd-task-item').forEach(el => {
        el.addEventListener('click', () => { closeProjectDetail(); openDetailPanel(el.dataset.taskId); });
      });
    }
  }

  if (!projectChatHistories[proj.id]) projectChatHistories[proj.id] = [];
  const chatMsgs = document.getElementById('pd-ai-messages');
  if (chatMsgs) {
    chatMsgs.innerHTML = '';
    projectChatHistories[proj.id].forEach(m => appendDpMsg(chatMsgs, m.role, m.content));
  }
}

async function applyProjectTasksProposal(projId, proposal) {
  if (!proposal?.tasks?.length) return;
  const proj = allProjects.find(p => p.id === projId);
  if (!proj) return;
  for (const td of proposal.tasks) {
    const task = await apiFetch(`/api/projects/${projId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: td.title, estimate_minutes: td.estimate_minutes || null, category_id: td.category_id || null }),
    });
    if (task) { allTasks.push(task); }
  }
  if (proposal.completion_condition) {
    const updated = await patchProject(projId, { completion_condition: proposal.completion_condition });
    if (updated) { const idx = allProjects.findIndex(p => p.id === projId); if (idx >= 0) allProjects[idx] = updated; }
  }
  _saveCachedTasks(allTasks);
  const fresh = allProjects.find(p => p.id === projId);
  if (fresh && projectDetailId === projId) renderProjectDetailBody(fresh);
  renderTasksBoard();
}

/* ── Category Manager Modal ──────────────────────────────── */

function openCategoryManager() {
  const bd = document.getElementById('categories-backdrop');
  if (!bd) return;
  renderCategoryManager();
  bd.classList.add('open');
  bd.removeAttribute('aria-hidden');
}

function closeCategoryManager() {
  const bd = document.getElementById('categories-backdrop');
  if (bd) { bd.classList.remove('open'); bd.setAttribute('aria-hidden', 'true'); }
}

function renderCategoryManager() {
  const tree = document.getElementById('categories-tree');
  if (!tree) return;
  const parents = allCategoriesTree;
  if (!parents.length) {
    tree.innerHTML = '<div class="cat-empty">カテゴリがありません</div>';
    return;
  }
  tree.innerHTML = '';
  for (const parent of parents) {
    const pEl = document.createElement('div');
    pEl.className = 'cat-parent-row';
    pEl.innerHTML = `
      <span class="cat-icon">${parent.icon || ''}</span>
      <span class="cat-name">${escHtml(parent.name)}</span>
      ${parent.is_system ? '<span class="cat-system-badge">システム</span>' : `
        <button class="btn-cat-edit" data-cat-id="${escHtml(parent.id)}" title="編集">✎</button>
        <button class="btn-cat-delete" data-cat-id="${escHtml(parent.id)}" title="削除">×</button>
      `}
    `;
    tree.appendChild(pEl);
    for (const child of (parent.children || [])) {
      const cEl = document.createElement('div');
      cEl.className = 'cat-child-row';
      cEl.innerHTML = `
        <span class="cat-child-indent">└</span>
        <span class="cat-icon">${child.icon || ''}</span>
        <span class="cat-name">${escHtml(child.name)}</span>
        <button class="btn-cat-edit" data-cat-id="${escHtml(child.id)}" title="編集">✎</button>
        <button class="btn-cat-delete" data-cat-id="${escHtml(child.id)}" title="削除">×</button>
      `;
      tree.appendChild(cEl);
    }
    const addChildBtn = document.createElement('button');
    addChildBtn.className = 'btn-cat-add-child';
    addChildBtn.dataset.parentId = parent.id;
    addChildBtn.textContent = `＋ ${escHtml(parent.name)} に追加`;
    tree.appendChild(addChildBtn);
  }

  tree.querySelectorAll('.btn-cat-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cat = allCategoriesFlat.find(c => c.id === btn.dataset.catId);
      if (!cat || cat.is_system) return;
      if (!confirm(`「${cat.name}」を削除しますか？`)) return;
      await apiFetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      await loadCategories();
      renderCategoryManager();
      renderTasksBoard();
    });
  });

  tree.querySelectorAll('.btn-cat-add-child').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = prompt('新しいカテゴリ名を入力してください');
      if (!name?.trim()) return;
      await apiFetch('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), parent_id: btn.dataset.parentId }),
      });
      await loadCategories();
      renderCategoryManager();
    });
  });
}

/* ── Rollover Buttons ────────────────────────────────────── */

async function doManualRollover(timing) {
  const btnId = timing === 'morning' ? 'btn-rollover-morning' : 'btn-rollover-evening';
  const btn   = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }
  try {
    const res = await apiFetch('/api/tasks/rollover/manual', {
      method: 'POST',
      body: JSON.stringify({ timing }),
    });
    if (res && res.moved !== undefined) {
      showMoveToast(`${timing === 'morning' ? '朝' : '夜'}のリセット完了 (${res.moved} 件更新)`);
    }
    await loadTasks();
    renderTasksBoard();
    refreshDailyPanels();
  } catch (err) {
    showMoveToast('リセットに失敗しました');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = timing === 'morning' ? '☀️ 朝のリセット' : '🌙 夜のリセット';
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Detail Panel
═══════════════════════════════════════════════════════════ */
function openDetailPanel(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  logEvent(taskId, 'sidebar_open');
  currentTaskId = taskId;
  document.querySelectorAll('.board-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.id === taskId)
  );
  renderDetailPanelBody(task);
  document.getElementById('detail-panel').classList.add('open');
  if (window.innerWidth > 640) {
    document.getElementById('tasks-subview-board')?.classList.add('has-detail');
  }
}

function closeDetailPanel() {
  if (currentTaskId) logEvent(currentTaskId, 'sidebar_close');
  currentTaskId = null;
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('tasks-subview-board')?.classList.remove('has-detail');
  document.querySelectorAll('.board-card').forEach(c => c.classList.remove('selected'));
}

function renderDetailPanelBody(task) {
  const body     = document.getElementById('detail-panel-body');
  const color    = categoryColor(task.category_id);
  const catLabel = categoryLabel(task.category_id);
  const stConf   = STATUS_CONFIG[task.gtd_status] || STATUS_CONFIG.inbox;

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

  const estLabel = task.estimate_minutes ? `${task.estimate_minutes}分` : '未設定';

  body.innerHTML = `
    <!-- ── Header ───────────────────────────────────────────── -->
    <div class="dp-header" style="--cat-color:${color}">
      <div class="dp-header-stripe"></div>
      <div class="dp-header-content">
        <div class="dp-header-badges">
          <span class="dp-status-badge" style="background:${stConf.color}22;color:${stConf.color}">${stConf.icon} ${stConf.label}</span>
          ${dlBadge}
        </div>
        <div class="dp-task-title">${escHtml(task.title)}</div>
        ${catLabel ? `<span class="badge-category" style="color:${color};border-color:${color}35;background:${color}12">${escHtml(catLabel)}</span>` : ''}
      </div>
    </div>

    <!-- ── 見込み時間 / カテゴリ ─────────────────────────────── -->
    <div class="dp-section dp-meta-row">
      <div class="dp-meta-item">
        <span class="dp-meta-label">見込み時間</span>
        <span class="dp-meta-value" id="dp-estimate-label">${escHtml(estLabel)}</span>
      </div>
      <div class="dp-meta-item">
        <span class="dp-meta-label">カテゴリ</span>
        <span class="dp-meta-value">${catLabel ? escHtml(catLabel) : '未設定'}</span>
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
    renderTasksBoard(); renderCalendarPanel();
  });
  body.querySelector('#dp-deadline-clear').addEventListener('click', async () => {
    body.querySelector('#dp-deadline-input').value = '';
    await patchTask(task.id, { deadline: null });
    renderTasksBoard(); renderCalendarPanel();
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
      renderTasksBoard();
      renderDetailPanelBody(allTasks.find(x => x.id === task.id));
    });
  });
  body.querySelectorAll('.roadmap-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.closest('.roadmap-item').dataset.rid;
      const t   = allTasks.find(x => x.id === task.id);
      if (!t) return;
      await patchTask(task.id, { roadmap: t.roadmap.filter(r => r.id !== rid) });
      renderTasksBoard();
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
    renderTasksBoard();
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
      if (data.detail_proposal) {
        applyDetailProposal(task.id, data.detail_proposal);
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
    archiveBtn.addEventListener('click', () => archiveTask(task.id));
  }
  body.querySelector('#dp-btn-delete').addEventListener('click', async () => {
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    logEvent(task.id, 'task_deleted');
    await removeTask(task.id);
    closeDetailPanel();
    renderTasksBoard();
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
    const color    = categoryColor(t.category_id);
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
            <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(categoryLabel(t.category_id))}</span>
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
  const color    = categoryColor(task.category_id);
  const catLabel = categoryLabel(task.category_id);
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
    renderTasksBoard();
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
   Diary (BEAT)
═══════════════════════════════════════════════════════════ */
function emotionColor(score) {
  const s = Math.max(-10, Math.min(10, Number(score) || 0));
  if (s <= -7) return '#C48080';
  if (s <= -3) return '#D8B0A8';
  if (s <=  2 && s >= -2) return '#D5D5D8';
  if (s <=  6) return '#B8D0B8';
  return '#7EA882';
}

/* ───────────────────────────────────────────────────────────
   Diary Timeline Chart (keyframe-style emotion/body editor)
─────────────────────────────────────────────────────────── */
const DIARY_TL_VB_W = 800;
const DIARY_TL_VB_H = 280;
const DIARY_TL_PAD_L = 40;
const DIARY_TL_PAD_R = 12;
const DIARY_TL_PAD_T = 12;
const DIARY_TL_PAD_B = 28;
const DIARY_TL_T_MAX = 1440; // minutes in a day
const DIARY_TL_V_MIN = -10;
const DIARY_TL_V_MAX = 10;
const DIARY_TL_LONGPRESS_MS = 600;
const DIARY_TL_MOVE_THRESH = 5;
// 睡眠帯（既定: 21:00 就寝 〜 翌 04:00 起床）
const DIARY_TL_SLEEP_END   = 4  * 60;   // 起床時刻
const DIARY_TL_SLEEP_START = 21 * 60;   // 就寝時刻

function mountDiaryTimelineChart(container) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${DIARY_TL_VB_W} ${DIARY_TL_VB_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  container.innerHTML = '';
  container.appendChild(svg);

  function makeBoundary() {
    return [{ t: 0, v: 0, locked: true }, { t: DIARY_TL_T_MAX, v: 0, locked: true }];
  }
  function ensureBoundary(arr) {
    const out = (arr || []).filter(p => p && p.t > 0 && p.t < DIARY_TL_T_MAX)
      .map(p => ({ t: p.t, v: p.v }));
    out.push({ t: 0, v: 0, locked: true });
    out.push({ t: DIARY_TL_T_MAX, v: 0, locked: true });
    out.sort((a, b) => a.t - b.t);
    return out;
  }
  const state = { emotion: makeBoundary(), body: makeBoundary(), activeSeries: 'emotion' };
  const history = { past: [], future: [] };
  let onHistoryChange = null;
  function snapshot() {
    return {
      emotion: state.emotion.map(p => ({ t: p.t, v: p.v, locked: !!p.locked })),
      body:    state.body   .map(p => ({ t: p.t, v: p.v, locked: !!p.locked })),
    };
  }
  function pushHistory() {
    history.past.push(snapshot());
    if (history.past.length > 100) history.past.shift();
    history.future.length = 0;
    if (onHistoryChange) onHistoryChange({ canUndo: true, canRedo: false });
  }
  function applySnapshot(snap) {
    state.emotion = snap.emotion.map(p => ({ ...p }));
    state.body    = snap.body   .map(p => ({ ...p }));
    render();
    if (onHistoryChange) {
      onHistoryChange({ canUndo: history.past.length > 0, canRedo: history.future.length > 0 });
    }
  }
  let dragCtx = null; // { series, idx, longPressTimer, startedMoving, startX, startY, isNew }

  const plotW = DIARY_TL_VB_W - DIARY_TL_PAD_L - DIARY_TL_PAD_R;
  const plotH = DIARY_TL_VB_H - DIARY_TL_PAD_T - DIARY_TL_PAD_B;

  function tToX(t) { return DIARY_TL_PAD_L + (t / DIARY_TL_T_MAX) * plotW; }
  function vToY(v) { return DIARY_TL_PAD_T + ((DIARY_TL_V_MAX - v) / (DIARY_TL_V_MAX - DIARY_TL_V_MIN)) * plotH; }
  function xToT(x) { return Math.round(Math.max(0, Math.min(1, (x - DIARY_TL_PAD_L) / plotW)) * DIARY_TL_T_MAX); }
  function yToV(y) {
    const ratio = Math.max(0, Math.min(1, (y - DIARY_TL_PAD_T) / plotH));
    return Math.round(DIARY_TL_V_MAX - ratio * (DIARY_TL_V_MAX - DIARY_TL_V_MIN));
  }

  function svgPoint(evt) {
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * DIARY_TL_VB_W;
    const y = ((evt.clientY - rect.top)  / rect.height) * DIARY_TL_VB_H;
    return { x, y };
  }

  function el(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // ── 昼/夜のシームレスな背景グラデーション（モダン基調） ───────
    const defs = el('defs');
    // 横方向に時刻ベースで色を遷移させる単一グラデ
    // 0:00=深夜 / 4:00 起床直前 → クリーム / 12:00 暖色ピーク / 21:00 夕暮れ → 深夜
    const bgGrad = el('linearGradient', {
      id: 'tl-bg', x1: String(tToX(0)), y1: '0', x2: String(tToX(DIARY_TL_T_MAX)), y2: '0',
      gradientUnits: 'userSpaceOnUse',
    });
    const stops = [
      ['0%',     '#252a52'], // 深夜（藍とすみれの深いミッドナイト）
      ['14.0%',  '#3d4373'], // 夜明け前
      ['16.5%',  '#a48aa6'], // 薄明（モーブ）
      ['19.5%',  '#f5d2bc'], // 朝焼け（ピーチ）
      ['25%',    '#fdeed7'], // 朝
      ['50%',    '#fef6e6'], // 昼（柔らかいウォームホワイト）
      ['78%',    '#fdeed7'], // 午後
      ['83%',    '#e9b8a4'], // 夕暮れ（コーラル）
      ['86.5%',  '#9479a8'], // トワイライト（ダスキーパープル）
      ['100%',   '#252a52'], // 深夜
    ];
    stops.forEach(([off, col]) => bgGrad.appendChild(el('stop', { offset: off, 'stop-color': col })));
    defs.appendChild(bgGrad);

    // 太陽の柔らかい光彩
    const sunGlow = el('radialGradient', { id: 'tl-sun-glow' });
    sunGlow.appendChild(el('stop', { offset: '0%',   'stop-color': '#ffd980', 'stop-opacity': '0.55' }));
    sunGlow.appendChild(el('stop', { offset: '100%', 'stop-color': '#ffd980', 'stop-opacity': '0' }));
    defs.appendChild(sunGlow);
    // 太陽本体（金属的な陰影）
    const sunBody = el('radialGradient', { id: 'tl-sun-body', cx: '0.35', cy: '0.35', r: '0.8' });
    sunBody.appendChild(el('stop', { offset: '0%',   'stop-color': '#fff2c4' }));
    sunBody.appendChild(el('stop', { offset: '100%', 'stop-color': '#e0a542' }));
    defs.appendChild(sunBody);
    // 月本体
    const moonBody = el('radialGradient', { id: 'tl-moon-body', cx: '0.35', cy: '0.35', r: '0.85' });
    moonBody.appendChild(el('stop', { offset: '0%',   'stop-color': '#f5efd8' }));
    moonBody.appendChild(el('stop', { offset: '100%', 'stop-color': '#a9a08a' }));
    defs.appendChild(moonBody);
    svg.appendChild(defs);

    // 全幅の背景（横グラデ1本で1日を表現）
    svg.appendChild(el('rect', {
      x: DIARY_TL_PAD_L, y: DIARY_TL_PAD_T,
      width: plotW, height: plotH,
      fill: 'url(#tl-bg)', 'fill-opacity': '0.40',
    }));

    // 太陽 — Apple system orange を落ち着かせた金色のフラット円
    const sunCx = tToX((DIARY_TL_SLEEP_END + DIARY_TL_SLEEP_START) / 2);
    const sunCy = DIARY_TL_PAD_T + 22;
    svg.appendChild(el('circle', {
      cx: sunCx, cy: sunCy, r: 7,
      fill: '#f0a948', 'pointer-events': 'none',
    }));

    // 月 — クールな淡シルバーの三日月（パス1本）
    function drawMoon(cx, cy) {
      const r = 8;
      const innerRx = r * 0.55;
      svg.appendChild(el('path', {
        d: `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} A ${innerRx} ${r} 0 0 1 ${cx} ${cy - r} Z`,
        fill: '#dde2ec', 'pointer-events': 'none',
      }));
    }
    drawMoon(tToX(DIARY_TL_SLEEP_END / 2),                       DIARY_TL_PAD_T + 22);
    drawMoon(tToX((DIARY_TL_SLEEP_START + DIARY_TL_T_MAX) / 2),  DIARY_TL_PAD_T + 22);

    // Background hit area
    const bg = el('rect', {
      x: DIARY_TL_PAD_L, y: DIARY_TL_PAD_T,
      width: plotW, height: plotH,
      class: 'bg', fill: 'transparent',
    });
    bg.addEventListener('pointerdown', onBgPointerDown);
    svg.appendChild(bg);

    // Grid: vertical (every 3h)
    for (let h = 0; h <= 24; h += 3) {
      const x = tToX(h * 60);
      svg.appendChild(el('line', {
        x1: x, y1: DIARY_TL_PAD_T, x2: x, y2: DIARY_TL_PAD_T + plotH,
        class: 'grid',
      }));
      const lbl = el('text', {
        x, y: DIARY_TL_VB_H - 10, class: 'label', 'text-anchor': 'middle',
      });
      lbl.textContent = `${h}:00`;
      svg.appendChild(lbl);
    }
    // Grid: horizontal (every 5)
    for (let v = -10; v <= 10; v += 5) {
      const y = vToY(v);
      const isZero = v === 0;
      svg.appendChild(el('line', {
        x1: DIARY_TL_PAD_L, y1: y, x2: DIARY_TL_PAD_L + plotW, y2: y,
        class: isZero ? 'axis-zero' : 'grid',
      }));
      const lbl = el('text', {
        x: DIARY_TL_PAD_L - 6, y: y + 3, class: 'label', 'text-anchor': 'end',
      });
      lbl.textContent = String(v);
      svg.appendChild(lbl);
    }

    drawSeries('body');
    drawSeries('emotion');
  }

  function buildSmoothPath(pts) {
    if (pts.length < 2) return '';
    const xy = pts.map(p => ({ x: tToX(p.t), y: vToY(p.v) }));
    const tension = 0.5; // 0 = straight (linear), 1 = very curvy
    let d = `M ${xy[0].x} ${xy[0].y}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[i - 1] || xy[i];
      const p1 = xy[i];
      const p2 = xy[i + 1];
      const p3 = xy[i + 2] || p2;
      const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
      const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
      const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
      const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  function drawSeries(series) {
    const pts = state[series];
    const isActive = state.activeSeries === series;
    if (pts.length >= 2) {
      svg.appendChild(el('path', {
        class: `polyline series-${series}` + (isActive ? '' : ' inactive'),
        d: buildSmoothPath(pts),
      }));
    }
    pts.forEach((p, idx) => {
      if (p.locked) return; // 両端は円を描画しない
      const cls = ['anchor', `series-${series}`];
      if (!isActive) cls.push('inactive');
      const c = el('circle', {
        cx: tToX(p.t), cy: vToY(p.v), r: 7,
        class: cls.join(' '),
        'data-series': series, 'data-idx': String(idx),
        stroke: series === 'emotion' ? '#a86b6b' : '#6b8aa8',
      });
      c.addEventListener('pointerdown', onAnchorPointerDown);
      c.addEventListener('dblclick', onAnchorDblClick);
      svg.appendChild(c);
    });
  }

  function clearLongPress() {
    if (dragCtx && dragCtx.longPressTimer) {
      clearTimeout(dragCtx.longPressTimer);
      dragCtx.longPressTimer = null;
    }
  }

  function onBgPointerDown(evt) {
    if (evt.button !== undefined && evt.button !== 0) return;
    evt.preventDefault();
    const { x, y } = svgPoint(evt);
    if (x < DIARY_TL_PAD_L || x > DIARY_TL_PAD_L + plotW) return;
    if (y < DIARY_TL_PAD_T || y > DIARY_TL_PAD_T + plotH) return;
    const t = xToT(x);
    if (t <= 0 || t >= DIARY_TL_T_MAX) return; // boundary positions are reserved
    pushHistory();
    const series = state.activeSeries;
    const newPt = { t, v: 0 };
    state[series].push(newPt);
    state[series].sort((a, b) => a.t - b.t);
    const idx = state[series].indexOf(newPt);
    render();
    // Begin dragging the new anchor
    const targetCircle = svg.querySelector(`circle.anchor[data-series="${series}"][data-idx="${idx}"]:not(.locked)`);
    if (targetCircle) startDrag(targetCircle, evt, true);
  }

  function onAnchorPointerDown(evt) {
    if (evt.button !== undefined && evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();
    pushHistory();
    startDrag(evt.currentTarget, evt, false);
  }

  function startDrag(circle, evt, isNew) {
    const series = circle.getAttribute('data-series');
    const idx = Number(circle.getAttribute('data-idx'));
    try { circle.setPointerCapture(evt.pointerId); } catch (e) {}
    circle.classList.add('dragging');
    dragCtx = {
      series, idx, circle,
      pointerId: evt.pointerId,
      startX: evt.clientX, startY: evt.clientY,
      startedMoving: false, isNew,
      longPressTimer: null,
    };
    dragCtx.longPressTimer = setTimeout(() => {
      if (!dragCtx || dragCtx.startedMoving) return;
      // Long press → delete
      removeAnchor(dragCtx.series, dragCtx.idx);
      try { dragCtx.circle.releasePointerCapture(dragCtx.pointerId); } catch (e) {}
      dragCtx = null;
    }, DIARY_TL_LONGPRESS_MS);
    circle.addEventListener('pointermove', onAnchorPointerMove);
    circle.addEventListener('pointerup', onAnchorPointerUp);
    circle.addEventListener('pointercancel', onAnchorPointerUp);
  }

  function onAnchorPointerMove(evt) {
    if (!dragCtx) return;
    const dx = evt.clientX - dragCtx.startX;
    const dy = evt.clientY - dragCtx.startY;
    if (!dragCtx.startedMoving && Math.hypot(dx, dy) > DIARY_TL_MOVE_THRESH) {
      dragCtx.startedMoving = true;
      clearLongPress();
    }
    const { x, y } = svgPoint(evt);
    const arr = state[dragCtx.series];
    if (dragCtx.idx < 0 || dragCtx.idx >= arr.length) return;
    if (arr[dragCtx.idx].locked) return;
    // Clamp t to (prev.t+1, next.t-1) so anchors keep order without crossing
    const prev = arr[dragCtx.idx - 1];
    const next = arr[dragCtx.idx + 1];
    const tMin = prev ? prev.t + 1 : 1;
    const tMax = next ? next.t - 1 : DIARY_TL_T_MAX - 1;
    let t = xToT(x);
    if (t < tMin) t = tMin;
    if (t > tMax) t = tMax;
    const v = yToV(y);
    arr[dragCtx.idx] = { t, v };
    render();
    // Re-acquire circle reference after re-render
    const newCircle = svg.querySelector(`circle.anchor[data-series="${dragCtx.series}"][data-idx="${dragCtx.idx}"]`);
    if (newCircle) {
      newCircle.classList.add('dragging');
      try { newCircle.setPointerCapture(dragCtx.pointerId); } catch (e) {}
      newCircle.addEventListener('pointermove', onAnchorPointerMove);
      newCircle.addEventListener('pointerup', onAnchorPointerUp);
      newCircle.addEventListener('pointercancel', onAnchorPointerUp);
      dragCtx.circle = newCircle;
    }
  }

  function onAnchorPointerUp(evt) {
    if (!dragCtx) return;
    clearLongPress();
    try { dragCtx.circle.releasePointerCapture(dragCtx.pointerId); } catch (e) {}
    dragCtx.circle.classList.remove('dragging');
    dragCtx = null;
  }

  function onAnchorDblClick(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const series = evt.currentTarget.getAttribute('data-series');
    const idx = Number(evt.currentTarget.getAttribute('data-idx'));
    removeAnchor(series, idx);
  }

  function removeAnchor(series, idx) {
    const arr = state[series];
    if (idx < 0 || idx >= arr.length) return;
    if (arr[idx].locked) return;
    pushHistory();
    arr.splice(idx, 1);
    render();
  }

  function setActiveSeries(s) {
    if (s !== 'emotion' && s !== 'body') return;
    state.activeSeries = s;
    render();
  }

  render();

  return {
    getState() {
      const strip = a => a.map(p => ({ t: p.t, v: p.v }));
      return { emotion: strip(state.emotion), body: strip(state.body) };
    },
    setState(next) {
      state.emotion = ensureBoundary(next && next.emotion);
      state.body    = ensureBoundary(next && next.body);
      render();
    },
    setActiveSeries,
    reset() {
      state.emotion = makeBoundary();
      state.body = makeBoundary();
      history.past.length = 0;
      history.future.length = 0;
      render();
      if (onHistoryChange) onHistoryChange({ canUndo: false, canRedo: false });
    },
    undo() {
      if (!history.past.length) return;
      history.future.push(snapshot());
      applySnapshot(history.past.pop());
    },
    redo() {
      if (!history.future.length) return;
      history.past.push(snapshot());
      applySnapshot(history.future.pop());
    },
    setOnHistoryChange(fn) { onHistoryChange = fn; },
    destroy() { container.innerHTML = ''; },
  };
}

function initDiaryForm() {
  if (diaryFormReady) return;
  diaryFormReady = true;

  diaryTimelineChart = mountDiaryTimelineChart(document.getElementById('diary-timeline'));
  document.querySelectorAll('.diary-timeline-series-toggle .series-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diary-timeline-series-toggle .series-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      diaryTimelineChart.setActiveSeries(btn.dataset.series);
    });
  });
  const undoBtn = document.getElementById('diary-tl-undo');
  const redoBtn = document.getElementById('diary-tl-redo');
  undoBtn.addEventListener('click', () => diaryTimelineChart.undo());
  redoBtn.addEventListener('click', () => diaryTimelineChart.redo());
  diaryTimelineChart.setOnHistoryChange(({ canUndo, canRedo }) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  });

  document.getElementById('diary-add-action') .addEventListener('click', () => addDiaryActionRow());
  document.getElementById('diary-add-thought').addEventListener('click', () => addDiaryThoughtRow());
  document.getElementById('diary-save-btn')   .addEventListener('click', saveDiaryEntry);
  const consolidateBtn = document.getElementById('diary-consolidate-btn');
  if (consolidateBtn) consolidateBtn.addEventListener('click', consolidateDiaryToMemo);

  // Mode/view toggle
  document.querySelectorAll('.diary-mode-btn').forEach(btn =>
    btn.addEventListener('click', () => switchDiaryMode(btn.dataset.diaryMode))
  );
  document.querySelectorAll('.diary-view-btn').forEach(btn =>
    btn.addEventListener('click', () => switchDiaryView(btn.dataset.diaryView))
  );
  document.getElementById('diary-nav-prev').addEventListener('click', () => {
    diaryRefDate.setMonth(diaryRefDate.getMonth() - 1); renderDiaryViewArea();
  });
  document.getElementById('diary-nav-next').addEventListener('click', () => {
    diaryRefDate.setMonth(diaryRefDate.getMonth() + 1); renderDiaryViewArea();
  });

  // Seed one empty row each for convenience
  addDiaryActionRow();
  addDiaryThoughtRow();
}

function addDiaryActionRow(emotion = '', text = '') {
  const list = document.getElementById('diary-actions');
  const row  = document.createElement('div');
  row.className = 'diary-action-row';
  row.innerHTML = `
    <input type="text" class="diary-action-text"    placeholder="行動を記録">
    <input type="text" class="diary-action-emotion" placeholder="感情" maxlength="30">
    <button type="button" class="diary-row-del" title="削除">×</button>`;
  row.querySelector('.diary-action-emotion').value = emotion;
  row.querySelector('.diary-action-text').value    = text;
  row.querySelector('.diary-row-del').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function addDiaryThoughtRow(topic = '', content = '') {
  const list = document.getElementById('diary-thoughts');
  const row  = document.createElement('div');
  row.className = 'diary-thought-row';
  row.innerHTML = `
    <input type="text" class="diary-thought-topic" placeholder="トピック（例：仕事の進め方について）" maxlength="60">
    <textarea class="diary-thought-content" rows="3" placeholder="考えたことを書く"></textarea>
    <button type="button" class="diary-row-del" title="削除">×</button>`;
  row.querySelector('.diary-thought-topic').value   = topic;
  row.querySelector('.diary-thought-content').value = content;
  row.querySelector('.diary-row-del').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function collectDiaryActions() {
  const rows = document.querySelectorAll('#diary-actions .diary-action-row');
  const out  = [];
  rows.forEach(r => {
    const emotion = r.querySelector('.diary-action-emotion').value.trim();
    const text    = r.querySelector('.diary-action-text').value.trim();
    if (emotion || text) out.push({ emotion, text });
  });
  return out;
}

function collectDiaryThoughts() {
  const rows = document.querySelectorAll('#diary-thoughts .diary-thought-row');
  const out  = [];
  rows.forEach(r => {
    const topic   = r.querySelector('.diary-thought-topic').value.trim();
    const content = r.querySelector('.diary-thought-content').value.trim();
    if (topic || content) out.push({ topic, content });
  });
  return out;
}

function resetDiaryForm() {
  if (diaryTimelineChart) diaryTimelineChart.reset();
  document.getElementById('body-text').value = '';
  document.getElementById('emo-text').value = '';
  document.getElementById('diary-actions').innerHTML  = '';
  document.getElementById('diary-thoughts').innerHTML = '';
  addDiaryActionRow();
  addDiaryThoughtRow();
}

async function saveDiaryEntry() {
  const btn = document.getElementById('diary-save-btn');
  if (btn.disabled) return;
  const ts = diaryTimelineChart ? diaryTimelineChart.getState() : { emotion: [], body: [] };
  const payload = {
    date:            todayStr(),
    body_anchors:    ts.body,
    emotion_anchors: ts.emotion,
    body_text:       document.getElementById('body-text').value.trim(),
    emotion_text:    document.getElementById('emo-text').value.trim(),
    actions:         collectDiaryActions(),
    thoughts:        collectDiaryThoughts(),
  };
  const hasContent =
    payload.body_text || payload.emotion_text ||
    payload.actions.length || payload.thoughts.length ||
    ts.body.length || ts.emotion.length;
  if (!hasContent) {
    alert('記録する内容を入力してください。');
    return;
  }
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '記録中...';
  try {
    await apiFetch('/api/diary', { method: 'POST', body: JSON.stringify(payload) });
    diaryEntriesCache = null;
    resetDiaryForm();
    btn.textContent = '✓ 記録しました';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 1200);
  } catch (e) {
    btn.textContent = origText;
    btn.disabled = false;
    alert('保存に失敗しました。');
  }
}

async function consolidateDiaryToMemo() {
  const btn = document.getElementById('diary-consolidate-btn');
  if (btn.disabled) return;
  if (!confirm('これまでの「考えたこと」をAIで整理してメモタブに保存します。よろしいですか？')) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'AI整理中...';
  try {
    const res = await fetch('/api/diary/consolidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error === 'no thoughts to consolidate'
        ? '整理対象の「考えたこと」がありません。'
        : '整理に失敗しました。');
      return;
    }
    const data = await res.json();
    memoSessionsCache = null;
    diaryEntriesCache = null;
    btn.textContent = `✓ ${data.consolidated_count}件をメモに保存`;
    renderDiaryPanel(true);
    setTimeout(() => { btn.textContent = origText; }, 1800);
  } catch (e) {
    alert('整理に失敗しました。');
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function renderDiaryPanel(forceRefresh = false) {
  initDiaryForm();
  const writeWrap    = document.getElementById('diary-write-wrap');
  const viewWrap     = document.getElementById('diary-view-wrap');
  const viewToggle   = document.getElementById('diary-view-toggle');
  const calNav       = document.getElementById('diary-cal-nav');
  const isWrite      = diaryMode === 'write';
  writeWrap.classList.toggle('hidden', !isWrite);
  viewWrap .classList.toggle('hidden',  isWrite);
  viewToggle.classList.toggle('hidden', isWrite);
  if (isWrite) return;

  if (!diaryEntriesCache || forceRefresh) {
    try { diaryEntriesCache = await apiFetch('/api/diary'); } catch { return; }
  }
  updateDiaryViewSummary(diaryEntriesCache);
  calNav.classList.toggle('hidden', diaryView !== 'calendar');
  if (diaryView === 'calendar') renderDiaryCalendar(diaryEntriesCache);
  else                          renderDiaryDaily(diaryEntriesCache);
}

function countUnconsolidatedThoughts(entries) {
  let entryCount = 0, thoughtCount = 0;
  for (const e of entries) {
    if (e.consolidated) continue;
    const tts = Array.isArray(e.thoughts) ? e.thoughts.filter(t => (t.topic || t.content)) : [];
    if (tts.length) { entryCount++; thoughtCount += tts.length; }
  }
  return { entryCount, thoughtCount };
}

function updateDiaryViewSummary(entries) {
  const el  = document.getElementById('diary-view-summary');
  const btn = document.getElementById('diary-consolidate-btn');
  if (!el || !btn) return;
  const { entryCount, thoughtCount } = countUnconsolidatedThoughts(entries);
  if (thoughtCount === 0) {
    el.textContent = '未保存の「考えたこと」はありません';
    btn.disabled = true;
  } else {
    el.textContent = `未保存の「考えたこと」: ${entryCount}件の日記 / ${thoughtCount}トピック`;
    btn.disabled = false;
  }
}

function renderDiaryViewArea() {
  if (diaryMode !== 'view') return;
  const calNav = document.getElementById('diary-cal-nav');
  calNav.classList.toggle('hidden', diaryView !== 'calendar');
  if (diaryView === 'calendar') renderDiaryCalendar(diaryEntriesCache || []);
  else                          renderDiaryDaily(diaryEntriesCache || []);
}

function switchDiaryMode(mode) {
  if (diaryMode === mode) return;
  diaryMode = mode;
  document.querySelectorAll('.diary-mode-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.diaryMode === mode)
  );
  renderDiaryPanel(true);
}

function switchDiaryView(view) {
  if (diaryView === view) return;
  diaryView = view;
  document.querySelectorAll('.diary-view-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.diaryView === view)
  );
  renderDiaryViewArea();
}

function renderDiaryCalendar(entries) {
  const wrap = document.getElementById('diary-view-content');
  if (!wrap) return;
  const year = diaryRefDate.getFullYear(), month = diaryRefDate.getMonth();
  const label = document.getElementById('diary-nav-label');
  if (label) label.textContent = `${year}年${month+1}月`;

  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const today    = todayStr();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const dayNames = ['日','月','火','水','木','金','土'];
  wrap.innerHTML = '';
  const calWrap = document.createElement('div');
  calWrap.className = 'cal-month-wrap';
  const header = document.createElement('div');
  header.className = 'cal-header';
  for (const dn of dayNames) {
    const cell = document.createElement('div');
    cell.className = 'cal-header-cell'; cell.textContent = dn;
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
    const dayEntries = byDate[iso] || [];
    const cell = document.createElement('div');
    cell.className = `cal-cell diary-cell${iso === today ? ' cal-today' : ''}${iso < today ? ' cal-past' : ''}${dayEntries.length ? ' has-memos' : ''}`;
    const num = document.createElement('div'); num.className = 'cal-day-num'; num.textContent = day;
    cell.appendChild(num);

    if (dayEntries.length) {
      const dots = document.createElement('div');
      dots.className = 'diary-cell-dots';
      dayEntries.slice(0, 6).forEach(e => {
        const dot = document.createElement('span');
        dot.className = 'diary-cell-dot' + (e.consolidated ? ' consolidated' : '');
        dot.style.background = emotionColor(e.emotion_score);
        dot.title = `感情: ${e.emotion_score}${e.consolidated ? '（メモ保存済み）' : ''}`;
        dots.appendChild(dot);
      });
      cell.appendChild(dots);
      cell.addEventListener('click', () => {
        diarySelectedDate = iso;
        diaryView = 'daily';
        document.querySelectorAll('.diary-view-btn').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.diaryView === 'daily')
        );
        renderDiaryViewArea();
      });
    }
    grid.appendChild(cell);
  }
  calWrap.appendChild(grid);
  wrap.appendChild(calWrap);
}

function renderDiaryDaily(entries) {
  const wrap = document.getElementById('diary-view-content');
  if (!wrap) return;
  wrap.innerHTML = '';

  const picker = document.createElement('div');
  picker.className = 'diary-day-picker';
  const defaultDate = diarySelectedDate || todayStr();
  picker.innerHTML = `
    <label style="font-size:12px;color:var(--text-secondary);">日付:</label>
    <input type="date" id="diary-daily-date" value="${defaultDate}">`;
  wrap.appendChild(picker);

  const body = document.createElement('div');
  wrap.appendChild(body);

  const renderForDate = (iso) => {
    body.innerHTML = '';
    const dayEntries = entries.filter(e => e.date === iso)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!dayEntries.length) {
      body.innerHTML = `<div class="diary-empty">${iso} の記録はありません</div>`;
      return;
    }
    for (const e of dayEntries) {
      body.appendChild(buildDiaryEntryCard(e));
    }
  };

  picker.querySelector('#diary-daily-date').addEventListener('change', ev => {
    diarySelectedDate = ev.target.value;
    renderForDate(ev.target.value);
  });
  renderForDate(defaultDate);
}

function buildDiaryEntryCard(e) {
  const card = document.createElement('div');
  card.className = 'diary-entry-card';
  const t = (e.created_at || '').slice(11, 16);

  const head = document.createElement('div');
  head.className = 'diary-entry-head';
  const consolidatedBadge = e.consolidated
    ? `<span class="diary-consolidated-badge" title="考えたことをメモタブに保存済み">◇ メモ保存済</span>` : '';
  head.innerHTML = `
    <span class="diary-entry-time">${escHtml(t || '')}</span>
    ${consolidatedBadge}
    <div class="diary-entry-scores">
      <span class="diary-score-chip"><span class="score-dot" style="background:${emotionColor(e.body_score)}"></span>体 ${e.body_score >= 0 ? '+' : ''}${e.body_score}</span>
      <span class="diary-score-chip"><span class="score-dot" style="background:${emotionColor(e.emotion_score)}"></span>感 ${e.emotion_score >= 0 ? '+' : ''}${e.emotion_score}</span>
    </div>
    <button class="diary-entry-delete" title="削除">×</button>`;
  head.querySelector('.diary-entry-delete').addEventListener('click', async () => {
    if (!confirm('この記録を削除しますか？')) return;
    await apiFetch(`/api/diary/${e.id}`, { method: 'DELETE' });
    diaryEntriesCache = null;
    renderDiaryPanel(true);
  });
  card.appendChild(head);

  if (e.body_text) {
    const b = document.createElement('div');
    b.className = 'diary-entry-block';
    b.innerHTML = `<div class="diary-entry-block-label">体調</div><div class="diary-entry-block-body">${escHtml(e.body_text)}</div>`;
    card.appendChild(b);
  }
  if (e.emotion_text) {
    const b = document.createElement('div');
    b.className = 'diary-entry-block';
    b.innerHTML = `<div class="diary-entry-block-label">感情</div><div class="diary-entry-block-body">${escHtml(e.emotion_text)}</div>`;
    card.appendChild(b);
  }
  if (Array.isArray(e.actions) && e.actions.length) {
    const b = document.createElement('div');
    b.className = 'diary-entry-block';
    const items = e.actions.map(a =>
      `<li><span class="emo">${escHtml(a.emotion || '―')}</span><span class="txt">${escHtml(a.text || '')}</span></li>`
    ).join('');
    b.innerHTML = `<div class="diary-entry-block-label">行動</div><div class="diary-entry-block-body"><ul>${items}</ul></div>`;
    card.appendChild(b);
  }
  if (Array.isArray(e.thoughts) && e.thoughts.length) {
    const b = document.createElement('div');
    b.className = 'diary-entry-block';
    const items = e.thoughts.map(t =>
      `<div style="margin-bottom:8px"><span class="thought-topic">${escHtml(t.topic || 'トピック')}</span><span class="thought-content">${escHtml(t.content || '')}</span></div>`
    ).join('');
    b.innerHTML = `<div class="diary-entry-block-label">考えたこと</div><div class="diary-entry-block-body">${items}</div>`;
    card.appendChild(b);
  }
  return card;
}

/* ═══════════════════════════════════════════════════════════
   Calendar（旧 Schedule タブをカレンダータブに統合、2026-04-25）
═══════════════════════════════════════════════════════════ */
function renderCalendarPanel() {
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
  const color     = categoryColor(task.category_id);
  const dateField = task.scheduled_date || task.deadline || '';
  const status    = dateField ? deadlineStatus(dateField) : 'none';
  const item      = document.createElement('div');
  item.className  = `schedule-list-item status-${status}`;
  item.style.setProperty('--card-color', color);
  item.innerHTML = `
    <div class="sl-left">
      <span class="sl-pip" style="background:${color}"></span>
      <div class="sl-body">
        <div class="sl-title${task.completed ? ' completed' : ''}">${escHtml(task.title)}</div>
        <div class="sl-meta">
          <span class="sl-cat">${escHtml(categoryLabel(task.category_id))}</span>
          ${dateField ? `<span class="sl-date dl-${status}">${escHtml(dateField)}</span>` : ''}
        </div>
      </div>
    </div>
    <span class="sl-arrow">›</span>`;
  item.addEventListener('click', () => openDetailPanel(task.id));
  return item;
}

function renderScheduleList(container) {
  const calTasks = allTasks.filter(t => t.gtd_status === 'calendar' && !t.is_draft);
  const today = todayStr();
  const week  = dateStr(addDays(new Date(), 7));
  const key   = t => t.scheduled_date || t.deadline || '';
  const withDate = calTasks.filter(t => key(t)).sort((a, b) => key(a).localeCompare(key(b)));
  const noDate   = calTasks.filter(t => !key(t));
  const groups = [
    { key: 'overdue', label: '過去',       tasks: withDate.filter(t => key(t) < today) },
    { key: 'today',   label: '今日',       tasks: withDate.filter(t => key(t) === today) },
    { key: 'soon',    label: '今週',       tasks: withDate.filter(t => key(t) > today && key(t) <= week) },
    { key: 'later',   label: 'それ以降',   tasks: withDate.filter(t => key(t) > week) },
    { key: 'none',    label: '日付未設定', tasks: noDate },
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
  if (!hasAny) scroll.innerHTML = '<div class="schedule-empty">カレンダーに登録されたタスクはありません</div>';
  container.appendChild(scroll);
}

function renderScheduleMonth(container, label) {
  const year = scheduleRefDate.getFullYear(), month = scheduleRefDate.getMonth();
  label.textContent = `${year}年${month+1}月`;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const taskMap  = {};
  const calTasks = allTasks.filter(t => t.gtd_status === 'calendar' && !t.is_draft);
  for (const t of calTasks) {
    const d = t.scheduled_date || t.deadline;
    if (!d) continue;
    if (!taskMap[d]) taskMap[d] = [];
    taskMap[d].push(t);
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
      for (let i = 0; i < max; i++) { const dot = document.createElement('div'); dot.className = 'cal-dot'; dot.style.background = categoryColor(tasks[i].category_id); dots.appendChild(dot); }
      if (tasks.length > 3) { const more = document.createElement('span'); more.className = 'cal-more'; more.textContent = `+${tasks.length - 3}`; dots.appendChild(more); }
      cell.appendChild(dots);
      const list = document.createElement('div'); list.className = 'cal-task-list';
      for (const t of tasks) {
        const ti = document.createElement('div');
        ti.className = `cal-task-item${t.completed ? ' completed' : ''}`;
        ti.style.setProperty('--card-color', categoryColor(t.category_id));
        ti.textContent = t.title;
        ti.addEventListener('click', e => { e.stopPropagation(); openDetailPanel(t.id); });
        list.appendChild(ti);
      }
      cell.appendChild(list);
    }
    cell.addEventListener('click', () => openCalDayModal(iso));
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
  const calTasks = allTasks.filter(t => t.gtd_status === 'calendar' && !t.is_draft);
  for (const t of calTasks) {
    const dd = t.scheduled_date || t.deadline;
    if (!dd) continue;
    if (!taskMap[dd]) taskMap[dd] = [];
    taskMap[dd].push(t);
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
    head.style.cursor = 'pointer';
    head.addEventListener('click', () => openCalDayModal(iso));
    col.appendChild(head);
    const body = document.createElement('div'); body.className = 'cal-week-body';
    for (const t of tasks) {
      const item = document.createElement('div');
      item.className = `cal-week-task${t.completed ? ' completed' : ''}`;
      item.style.setProperty('--card-color', categoryColor(t.category_id));
      item.textContent = t.title;
      item.addEventListener('click', () => openDetailPanel(t.id));
      body.appendChild(item);
    }
    col.appendChild(body); week.appendChild(col);
  }
  container.appendChild(week);
}

/* ═══════════════════════════════════════════════════════════
   Calendar Day Modal — 完了/未完了/カレンダー登録 を1日分表示
═══════════════════════════════════════════════════════════ */
async function openCalDayModal(dateStr) {
  document.getElementById('cal-day-modal-date').textContent = dateStr;

  const calList   = document.getElementById('cal-day-calendar-list');
  const compList  = document.getElementById('cal-day-completed-list');
  const unfinList = document.getElementById('cal-day-unfinished-list');
  calList.innerHTML   = '<div class="cal-day-empty">読み込み中…</div>';
  compList.innerHTML  = '<div class="cal-day-empty">読み込み中…</div>';
  unfinList.innerHTML = '<div class="cal-day-empty">読み込み中…</div>';

  const backdrop = document.getElementById('cal-day-backdrop');
  backdrop.classList.add('open');
  backdrop.removeAttribute('aria-hidden');

  // 1. カレンダーリストの該当日タスク（gtd_status=calendar かつ scheduled_date or deadline がその日）
  const calTasks = (allTasks || []).filter(t =>
    t.gtd_status === 'calendar' && !t.is_draft &&
    (t.scheduled_date === dateStr || t.deadline === dateStr)
  );
  calList.innerHTML = calTasks.length
    ? calTasks.map(t => buildCalDayItem({
        title: t.title, category_id: t.category_id, task_id: t.id, clickable: true,
      })).join('')
    : '<div class="cal-day-empty">なし</div>';

  // 2. 完了/未完了は /api/daily-log/<date> から
  try {
    const log = await apiFetch(`/api/daily-log/${dateStr}`);
    compList.innerHTML = (log.completed || []).length
      ? log.completed.map(e => buildCalDayItem({
          title: e.title, category_id: e.category_id,
        })).join('')
      : '<div class="cal-day-empty">なし</div>';
    unfinList.innerHTML = (log.unfinished || []).length
      ? log.unfinished.map(e => buildCalDayItem({
          title: e.title, category_id: e.category_id, unfinished: true,
        })).join('')
      : '<div class="cal-day-empty">なし</div>';
  } catch (err) {
    compList.innerHTML  = '<div class="cal-day-empty">取得に失敗しました</div>';
    unfinList.innerHTML = '<div class="cal-day-empty">取得に失敗しました</div>';
  }

  // タスクに紐付くカードはクリックで詳細パネルを開く
  calList.querySelectorAll('.cal-day-item[data-task-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.taskId;
      closeCalDayModal();
      openDetailPanel(id);
    });
  });
}

function buildCalDayItem({ title, category_id, task_id, clickable, unfinished }) {
  const color = categoryColor(category_id);
  const cls = ['cal-day-item'];
  if (clickable) cls.push('clickable');
  if (unfinished) cls.push('unfinished');
  const dataAttr = task_id ? ` data-task-id="${escHtml(task_id)}"` : '';
  return `<div class="${cls.join(' ')}" style="--card-color:${color}"${dataAttr}>
    <span class="cal-day-pip" style="background:${color}"></span>
    <span class="cal-day-title">${escHtml(title || '')}</span>
  </div>`;
}

function closeCalDayModal() {
  const backdrop = document.getElementById('cal-day-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
}

/* ═══════════════════════════════════════════════════════════
   Report（GTD 改修で撤去、2026-04-24）
   → docs/GTD_DESIGN.md Sect.6.3, 8.5 により renderReportPanel / buildReportHTML /
     initReportCharts / Chart.js 依存コードを一括削除
═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Chat
═══════════════════════════════════════════════════════════ */
const chatMessagesEl = () => document.getElementById('chat-messages');

function appendMessage(role, content) {
  const container = chatMessagesEl();
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;
  if (role === 'assistant') {
    msgEl.innerHTML = `
      <div class="msg-avatar">✦</div>
      <div class="msg-bubble"><div class="msg-text">${formatMarkdown(content)}</div></div>`;
  } else {
    msgEl.innerHTML = `<div class="msg-bubble"><div class="msg-text">${escHtml(content).replace(/\n/g, '<br>')}</div></div>`;
  }
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
  return msgEl;
}

function renderChatWelcome() {
  const container = chatMessagesEl();
  container.innerHTML = `
    <div class="chat-welcome dump-welcome" id="chat-welcome-dump">
      <div class="welcome-mark">◎</div>
      <h3 class="welcome-title">頭の中を書き出してみましょう</h3>
      <p class="welcome-desc">思っていること、気になっていることを、そのまま話してください。</p>
      <p class="welcome-desc dump-welcome-hint">こちらから質問しながら、整理のお手伝いをします。</p>
    </div>`;
}

function draftStatusLabel(t) {
  const map = {
    inbox:           '未分類',
    next_action:     '次にやる',
    calendar:        'カレンダー',
    waiting:         '待機中',
    someday:         'いつか',
    project_pending: 'プロジェクト候補',
  };
  return map[t.gtd_status] || '下書き';
}

function resetChat() { chatHistories[chatMode] = []; _saveChats(); renderChatWelcome(); }

function switchChatMode(mode) {
  if (chatMode === mode) return;
  chatMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  const saveBtn = document.getElementById('chat-save');
  if (saveBtn) saveBtn.classList.toggle('hidden', mode !== 'dump');
  document.getElementById('typing-indicator').classList.add('hidden');
  const container = chatMessagesEl();
  container.innerHTML = '';
  const history = chatHistories[mode];
  if (history.length === 0) renderChatWelcome();
  else for (const msg of history) appendMessage(msg.role, msg.content);
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
    appendMessage('assistant', data.response);
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

// 旧 [[TASK:]] / [[PROJECT:]] / [[HABIT:]] proposal クリックハンドラは GTD 改修で削除（2026-04-25）。
// 静的仕分けフロー（Q1〜Q6）と詳細設定モーダルが代替。Phase task proposal のみ project UI 互換のため残置。
document.addEventListener('click', async e => {
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
        title: taskData.title, roadmap, checklist,
        category_id: taskData.category_id || null, deadline: taskData.deadline || null,
        estimate_minutes: taskData.estimate_minutes || null,
        tags: taskData.tags || [], project_id: taskData.project_id,
      }),
    });
    if (!task) return;
    allTasks.push(task); _saveCachedTasks(allTasks); logEvent(task.id, 'task_created');
    await loadProjects();
    proposalCard.innerHTML = `<div class="proposal-confirmed">✓ タスク「${escHtml(taskData.title)}」を作成しました</div>`;
    renderTasksBoard(); refreshDailyPanels(); renderProjectsTab();
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
  document.getElementById('input-task-deadline').value = '';
  const estEl = document.getElementById('input-task-estimate');
  if (estEl) estEl.value = '';
}

/* ═══════════════════════════════════════════════════════════
   GTD: 静的仕分け（Q1〜Q6）+ タスク収集 + 下書き + 詳細設定モーダル
═══════════════════════════════════════════════════════════ */


const GTD_STATUS_LABEL = {
  inbox:           '未分類',
  next_action:     '次にやる',
  waiting:         '待機中',
  calendar:        'カレンダー',
  someday:         'いつか',
  project_pending: 'プロジェクト候補',
  trash:           'ゴミ箱',
  done:            '完了',
};

/* ── Collect Modal (複数タイトル入力) ───────────────────── */
let collectRowCounter = 0;

function openCollectModal() {
  const backdrop = document.getElementById('collect-backdrop');
  const rows     = document.getElementById('collect-rows');
  rows.innerHTML = '';
  collectRowCounter = 0;
  addCollectRow(); addCollectRow(); addCollectRow();
  backdrop.classList.add('open');
  backdrop.removeAttribute('aria-hidden');
  setTimeout(() => {
    const firstInput = rows.querySelector('.collect-input');
    firstInput?.focus();
  }, 50);
}

function closeCollectModal() {
  const backdrop = document.getElementById('collect-backdrop');
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
}

function addCollectRow(value = '') {
  const rows = document.getElementById('collect-rows');
  const id   = `collect-row-${++collectRowCounter}`;
  const row  = document.createElement('div');
  row.className = 'collect-row';
  row.innerHTML = `
    <input class="field-input collect-input" type="text" id="${id}"
           placeholder="タスクのタイトル（例: 会議資料をまとめる）" autocomplete="off" value="${escHtml(value)}">
    <button class="btn-icon collect-row-remove" title="この行を削除" type="button">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </button>`;
  rows.appendChild(row);
  row.querySelector('.collect-row-remove').addEventListener('click', () => {
    row.remove();
    if (!rows.querySelector('.collect-row')) addCollectRow();
  });
  row.querySelector('.collect-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCollectRow(); rows.lastElementChild.querySelector('.collect-input').focus(); }
  });
}

async function submitCollect() {
  const inputs = [...document.querySelectorAll('#collect-rows .collect-input')];
  const titles = inputs.map(i => i.value.trim()).filter(Boolean);
  if (!titles.length) {
    alert('タスクを1件以上入力してください。');
    return;
  }
  let created;
  try {
    created = await apiFetch('/api/tasks/collect', {
      method: 'POST',
      body: JSON.stringify({ titles }),
    });
  } catch (err) {
    alert('タスクの登録に失敗しました: ' + err.message);
    return;
  }
  for (const t of created) allTasks.push(t);
  _saveCachedTasks(allTasks);
  closeCollectModal();
  renderTasksBoard();
}

// Classify Flow (Q1〜Q6) は v2 で削除済み。仕分けは D&D で行う。



/* ── Detail Settings Modal v2 (詳細設定 + AI 相談) ──────── */

let dsCurrentTaskId = null;
let dsLocalState    = null;
const dsChatHistory = {};

function openDetailSettings(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  dsCurrentTaskId = taskId;
  dsLocalState = {
    title:           task.title || '',
    category_id:     task.category_id || null,
    estimate_minutes: task.estimate_minutes || null,
    deadline:        task.deadline || '',
    scheduled_date:  task.scheduled_date || '',
    waiting_for:     task.waiting_for || '',
    roadmap:         (task.roadmap   || []).map(r => ({ text: r.text, done: !!r.done, id: r.id })),
    checklist:       (task.checklist || []).map(c => ({ text: c.text, done: !!c.done })),
  };
  if (!dsChatHistory[taskId]) dsChatHistory[taskId] = [];

  document.getElementById('ds-title').value           = dsLocalState.title;
  document.getElementById('ds-deadline').value        = dsLocalState.deadline || '';
  document.getElementById('ds-scheduled-date').value  = dsLocalState.scheduled_date || '';
  document.getElementById('ds-waiting-for').value     = dsLocalState.waiting_for || '';
  const catSel = document.getElementById('ds-category-id');
  if (catSel) catSel.value = dsLocalState.category_id || '';
  const estInput = document.getElementById('ds-estimate-minutes');
  if (estInput) estInput.value = dsLocalState.estimate_minutes || '';

  renderDsList('roadmap');
  renderDsList('checklist');
  toggleDsStatusFields(task.gtd_status || 'next_action');
  renderDsAiMessages();
  updateDsFinalizeButton();

  const bd = document.getElementById('detail-settings-backdrop');
  bd.classList.add('open');
  bd.removeAttribute('aria-hidden');
  setTimeout(() => document.getElementById('ds-title').focus(), 50);
}

async function closeDetailSettings(saveFirst = true) {
  if (saveFirst && dsCurrentTaskId) await saveDetailSettingsDraft();
  const bd = document.getElementById('detail-settings-backdrop');
  bd.classList.remove('open');
  bd.setAttribute('aria-hidden', 'true');
  dsCurrentTaskId = null;
  dsLocalState    = null;
  renderTasksBoard();
  renderChatWelcome();
  renderCalendarPanel();
}

function toggleDsStatusFields(status) {
  const dl  = document.querySelector('.ds-field-deadline');
  const sd  = document.querySelector('.ds-field-scheduled-date');
  const wf  = document.querySelector('.ds-field-waiting-for');
  if (dl) dl.classList.toggle('hidden', status === 'calendar' || status === 'waiting');
  if (sd) sd.classList.toggle('hidden', status !== 'calendar');
  if (wf) wf.classList.toggle('hidden', status !== 'waiting');
}

function renderDsList(kind) {
  const list = document.getElementById(`ds-${kind}`);
  list.innerHTML = '';
  const items = dsLocalState[kind];
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'ds-list-row';
    row.innerHTML = `
      <input class="field-input ds-list-input" type="text" value="${escHtml(item.text)}"
             placeholder="${kind === 'roadmap' ? 'ステップを入力' : '項目を入力'}">
      <button class="btn-icon ds-list-remove" title="削除" type="button">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>`;
    row.querySelector('.ds-list-input').addEventListener('input', e => {
      dsLocalState[kind][idx].text = e.target.value;
    });
    row.querySelector('.ds-list-remove').addEventListener('click', () => {
      dsLocalState[kind].splice(idx, 1);
      renderDsList(kind);
    });
    list.appendChild(row);
  });
}

function collectDsState() {
  dsLocalState.title           = document.getElementById('ds-title').value.trim();
  dsLocalState.deadline        = document.getElementById('ds-deadline').value || null;
  dsLocalState.scheduled_date  = document.getElementById('ds-scheduled-date').value || null;
  dsLocalState.waiting_for     = document.getElementById('ds-waiting-for').value.trim() || null;
  const catSel = document.getElementById('ds-category-id');
  dsLocalState.category_id     = catSel ? (catSel.value || null) : null;
  const estInput = document.getElementById('ds-estimate-minutes');
  dsLocalState.estimate_minutes = estInput ? (parseInt(estInput.value, 10) || null) : null;
}

function dsMissingFields() {
  const task = allTasks.find(t => t.id === dsCurrentTaskId);
  if (!task) return ['task'];
  const status = task.gtd_status || 'inbox';
  const missing = [];
  if (!dsLocalState.title) missing.push('タイトル');
  if (status === 'calendar' && !dsLocalState.scheduled_date) missing.push('実行日');
  return missing;
}

function updateDsFinalizeButton() {
  collectDsState();
  const btn  = document.getElementById('btn-ds-save');
  const hint = document.getElementById('ds-hint');
  if (!btn) return;
  const missing = dsMissingFields();
  if (missing.length) {
    btn.disabled     = true;
    if (hint) hint.textContent = `必須: ${missing.join(' / ')}`;
  } else {
    btn.disabled     = false;
    if (hint) hint.textContent = '';
  }
}

async function saveDetailSettingsDraft() {
  if (!dsCurrentTaskId) return;
  collectDsState();
  const patch = {
    title:            dsLocalState.title,
    category_id:      dsLocalState.category_id,
    estimate_minutes: dsLocalState.estimate_minutes,
    deadline:         dsLocalState.deadline,
    scheduled_date:   dsLocalState.scheduled_date,
    waiting_for:      dsLocalState.waiting_for,
    roadmap:   dsLocalState.roadmap.map((r, i) => ({
      id: r.id || String(Date.now() + i), text: r.text.trim(), done: !!r.done,
    })).filter(r => r.text),
    checklist: dsLocalState.checklist.map(c => ({
      text: c.text.trim(), done: !!c.done,
    })).filter(c => c.text),
  };
  try { await patchTask(dsCurrentTaskId, patch); } catch { /* ignore save failure */ }
}

async function finalizeDetailSettings() {
  collectDsState();
  if (dsMissingFields().length) return;
  await saveDetailSettingsDraft();
  await closeDetailSettings(false);
  switchTab('tasks');
}

/* ── Detail Settings AI Chat ([[DETAIL:]] 対応) ─────────── */

function renderDsAiMessages() {
  const container = document.getElementById('ds-ai-messages');
  const history   = dsChatHistory[dsCurrentTaskId] || [];
  container.innerHTML = history.map(m => `
    <div class="ds-ai-msg ds-ai-msg-${m.role}">
      <div class="ds-ai-bubble">${m.role === 'assistant' ? formatMarkdown(m.content) : escHtml(m.content).replace(/\n/g, '<br>')}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendDsAiMessage() {
  const input = document.getElementById('ds-ai-input');
  const text  = input.value.trim();
  if (!text || !dsCurrentTaskId) return;
  const history = dsChatHistory[dsCurrentTaskId];
  history.push({ role: 'user', content: text });
  input.value = '';
  renderDsAiMessages();
  const typing = document.createElement('div');
  typing.className = 'ds-ai-msg ds-ai-msg-assistant ds-ai-typing';
  typing.innerHTML = '<div class="ds-ai-bubble">…</div>';
  document.getElementById('ds-ai-messages').appendChild(typing);

  try {
    const res = await fetch(`/api/tasks/${dsCurrentTaskId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    history.push({ role: 'assistant', content: data.response || '' });
    renderDsAiMessages();
    if (data.detail_proposal) applyDetailProposal(data.detail_proposal);
  } catch (err) {
    history.push({ role: 'assistant', content: 'エラーが発生しました: ' + err.message });
    renderDsAiMessages();
  }
}

function applyDetailProposal(taskId, proposal) {
  if (!proposal) return;
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  const patch = {};
  if (proposal.category_id && !task.category_id)       patch.category_id      = proposal.category_id;
  if (proposal.estimate_minutes && !task.estimate_minutes) patch.estimate_minutes = proposal.estimate_minutes;
  if (Array.isArray(proposal.roadmap)   && !task.roadmap?.length)
    patch.roadmap   = proposal.roadmap.map((r, i) => ({ id: String(Date.now()+i), text: r.text, done: false }));
  if (Array.isArray(proposal.checklist) && !task.checklist?.length)
    patch.checklist = proposal.checklist.map(c => ({ text: c.text, done: false }));

  if (!Object.keys(patch).length) return;
  patchTask(taskId, patch).then(() => {
    if (currentTaskId === taskId) renderDetailPanelBody(allTasks.find(t => t.id === taskId));
    if (dsCurrentTaskId === taskId) {
      Object.assign(dsLocalState, patch);
      if (patch.category_id) {
        const catSel = document.getElementById('ds-category-id');
        if (catSel) catSel.value = patch.category_id;
      }
      if (patch.estimate_minutes) {
        const estInput = document.getElementById('ds-estimate-minutes');
        if (estInput) estInput.value = patch.estimate_minutes;
      }
      if (patch.roadmap)   renderDsList('roadmap');
      if (patch.checklist) renderDsList('checklist');
      updateDsFinalizeButton();
    }
  });
}

/* ── Status-specific tabs (calendar / waiting / someday) ── */

function renderStatusListTab(status) {
  const bodyId = {
    calendar: 'calendar-list-body',
    waiting:  'waiting-list-body',
    someday:  'someday-list-body',
  }[status];
  const body = document.getElementById(bodyId);
  if (!body) return;
  const items = allTasks.filter(t =>
    t.gtd_status === status && !t.is_draft && !t.completed
  );
  if (status === 'calendar') {
    items.sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  } else {
    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  if (!items.length) {
    body.innerHTML = `<div class="status-empty">該当するタスクがありません</div>`;
    return;
  }
  body.innerHTML = items.map(t => buildStatusItem(t, status)).join('');
}

function buildStatusItem(t, status) {
  const color = categoryColor(t.category_id);
  const catLabel = categoryLabel(t.category_id);
  const metaPieces = [];
  if (status === 'calendar' && t.scheduled_date) metaPieces.push(`📅 ${t.scheduled_date}`);
  if (status === 'waiting'  && t.waiting_for)    metaPieces.push(`⏳ ${escHtml(t.waiting_for)}`);
  if (t.estimate_minutes) metaPieces.push(`⏱ ${t.estimate_minutes}分`);
  if (t.deadline)         metaPieces.push(`期限 ${t.deadline}`);
  return `
    <div class="status-item" data-task-id="${escHtml(t.id)}" style="--card-color:${color}">
      <div class="status-item-head">
        <span class="status-item-pip" style="background:${color}"></span>
        <span class="status-item-title">${escHtml(t.title)}</span>
        <span class="badge-category" style="color:${color};border-color:${color}20;background:${color}12">${escHtml(catLabel)}</span>
      </div>
      ${metaPieces.length ? `<div class="status-item-meta">${metaPieces.join(' · ')}</div>` : ''}
      <div class="status-item-actions">
        <button class="btn-ghost btn-status-edit"    data-act="edit">編集</button>
        <button class="btn-ghost btn-status-promote" data-act="promote">次にやるへ</button>
        <button class="btn-ghost btn-status-done"    data-act="done">完了</button>
        <button class="btn-ghost btn-status-trash"   data-act="trash">ゴミ箱へ</button>
      </div>
    </div>`;
}

async function handleStatusAction(taskId, act) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  if (act === 'edit') {
    openDetailPanel(taskId);
    return;
  }
  if (act === 'done') {
    await patchTask(taskId, { completed: true, gtd_status: 'done' });
    await archiveTask(taskId);
  } else if (act === 'promote') {
    await moveTask(taskId, 'next_action');
    return;
  } else if (act === 'trash') {
    if (!confirm('このタスクをゴミ箱へ移しますか？')) return;
    await moveTask(taskId, 'trash');
    return;
  }
  renderTasksBoard();
  renderCalendarPanel();
}

/* ── Today / Tomorrow side panel ────────────────────────── */

let dailyTab = 'today';
let dailyCache = { today: null, tomorrow: null };

async function refreshDailyPanels() {
  try {
    const [today, tomorrow] = await Promise.all([
      apiFetch('/api/today'), apiFetch('/api/tomorrow'),
    ]);
    dailyCache.today    = today;
    dailyCache.tomorrow = tomorrow;
    renderDailyPanel('today');
    renderDailyPanel('tomorrow');
  } catch { /* silent */ }
}

function renderDailyPanel(which) {
  const data    = dailyCache[which];
  const dropId  = `daily-tasks-${which}`;
  const habitId = `daily-habits-${which}`;
  const drop    = document.getElementById(dropId);
  const habitEl = document.getElementById(habitId);
  if (!drop || !habitEl) return;

  const tasks          = data?.tasks           || [];
  const completedToday = data?.completed_today || [];
  const habits         = data?.habits          || [];

  if (tasks.length === 0 && completedToday.length === 0) {
    drop.innerHTML = `<div class="daily-empty">ここにマトリクスからドラッグ</div>`;
  } else {
    const activeHtml = tasks.map(t => {
      const color = categoryColor(t.category_id);
      return `
        <div class="daily-task-card" data-task-id="${escHtml(t.id)}" style="--card-color:${color}">
          <input type="checkbox" class="daily-task-check" data-task-id="${escHtml(t.id)}">
          <span class="daily-task-pip" style="background:${color}"></span>
          <span class="daily-task-title">${escHtml(t.title)}</span>
          <button class="btn-icon daily-task-remove" title="解除" type="button">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>`;
    }).join('');
    const completedHtml = completedToday.map(t => {
      const color = categoryColor(t.category_id);
      return `
        <div class="daily-task-card completed" data-task-id="${escHtml(t.id)}" style="--card-color:${color}">
          <input type="checkbox" class="daily-task-check" checked disabled>
          <span class="daily-task-pip" style="background:${color}"></span>
          <span class="daily-task-title">${escHtml(t.title)}</span>
        </div>`;
    }).join('');
    drop.innerHTML = activeHtml + completedHtml;
  }

  if (habits.length === 0) {
    habitEl.innerHTML = `<div class="daily-empty daily-empty-sm">(習慣なし)</div>`;
  } else {
    habitEl.innerHTML = habits.map(h => {
      const color = habitColor(h);
      const checked = h.done ? 'checked' : '';
      return `
        <label class="daily-habit-row" style="--card-color:${color}">
          <input type="checkbox" class="daily-habit-check" data-habit-id="${escHtml(h.id)}" data-date="${escHtml(data.date)}" ${checked}>
          <span class="daily-habit-title">${escHtml(h.title)}</span>
        </label>`;
    }).join('');
  }
}

function switchDailyTab(tab) {
  dailyTab = tab;
  document.querySelectorAll('.daily-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.dailyTab === tab)
  );
  document.getElementById('daily-panel-today').classList.toggle('hidden',    tab !== 'today');
  document.getElementById('daily-panel-tomorrow').classList.toggle('hidden', tab !== 'tomorrow');
}

async function scheduleTaskToSlot(taskId, slot) {
  try {
    const updated = await apiFetch(`/api/tasks/${taskId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_for: slot }),
    });
    const idx = allTasks.findIndex(t => t.id === updated.id);
    if (idx >= 0) allTasks[idx] = updated;
    _saveCachedTasks(allTasks);
    await refreshDailyPanels();
  } catch (err) {
    alert('予定設定に失敗しました: ' + err.message);
  }
}

/* ── List view (next_action 一覧) ───────────────────────── */

function renderTasksListView() {
  const wrap = document.getElementById('tasks-list-wrap');
  if (!wrap) return;
  const tasks = getTasksByStatus('next_action').filter(t => !t.completed).slice();
  tasks.sort((a, b) => {
    const ad = a.deadline || '9999-12-31';
    const bd = b.deadline || '9999-12-31';
    return ad.localeCompare(bd);
  });
  if (!tasks.length) {
    wrap.innerHTML = `<div class="status-empty">次にやるタスクがありません</div>`;
    return;
  }
  wrap.innerHTML = `
    <table class="tasks-list-table">
      <thead><tr>
        <th>タイトル</th><th>見込み</th><th>期限</th><th>カテゴリー</th><th></th>
      </tr></thead>
      <tbody>
        ${tasks.map(t => {
          const color = categoryColor(t.category_id);
          return `
            <tr class="tasks-list-row" data-task-id="${escHtml(t.id)}">
              <td>${escHtml(t.title)}</td>
              <td>${t.estimate_minutes ? `${t.estimate_minutes}分` : '—'}</td>
              <td>${t.deadline ? escHtml(t.deadline) : '—'}</td>
              <td style="color:${color}">${escHtml(categoryLabel(t.category_id) || '')}</td>
              <td><button class="btn-ghost btn-list-open" type="button">詳細</button></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/* ── Weekly Review tab ──────────────────────────────────── */

let reviewSummaryCache = null;
let reviewActiveStep   = null;

async function renderReviewTab() {
  const stepsEl = document.getElementById('review-steps');
  const titleEl = document.getElementById('review-detail-title');
  const bodyEl  = document.getElementById('review-detail-body');
  if (!stepsEl) return;
  let summary;
  try { summary = await apiFetch('/api/review/summary'); } catch { summary = null; }
  reviewSummaryCache = summary;
  const items = [
    { id: 'drafts',       label: 'Step 1: オプションなしを整理',    count: summary?.drafts            ?? 0 },
    { id: 'next_actions', label: 'Step 2: 次にやるを見直す',     count: summary?.next_actions      ?? 0 },
    { id: 'waiting',      label: 'Step 3: 待機中をつつく',        count: summary?.waiting           ?? 0 },
    { id: 'someday',      label: 'Step 4: いつか・多分を棚卸し', count: summary?.someday           ?? 0 },
    { id: 'trash',        label: 'Step 5: ゴミ箱を確認',          count: summary?.trash             ?? 0 },
    { id: 'next_week',    label: 'Step 6: 来週のカレンダー',     count: summary?.next_week_calendar ?? 0 },
    { id: 'this_week',    label: 'Step 7: 今週の完了振り返り',   count: summary?.this_week_done     ?? 0 },
  ];
  stepsEl.innerHTML = items.map(it => `
    <button class="review-step-card${reviewActiveStep === it.id ? ' active' : ''}" data-step="${it.id}" type="button">
      <span class="review-step-label">${escHtml(it.label)}</span>
      <span class="review-step-count">${it.count}件</span>
    </button>`).join('');
  if (reviewActiveStep) renderReviewStepDetail(reviewActiveStep);
  else {
    titleEl.textContent = 'Step を選んでください';
    bodyEl.innerHTML    = '<div class="review-empty">左のステップをクリックすると、該当タスクの一覧と操作が表示されます。</div>';
  }
}

function renderReviewStepDetail(stepId) {
  reviewActiveStep = stepId;
  document.querySelectorAll('.review-step-card').forEach(b =>
    b.classList.toggle('active', b.dataset.step === stepId)
  );
  // モバイル: ステップ一覧を隠して詳細を表示（初回遷移時のみ history state を積む）
  if (window.innerWidth <= 640) {
    const layout = document.querySelector('.review-layout');
    if (layout) {
      if (!layout.classList.contains('review-detail-active')) {
        history.pushState({ reviewDetail: true }, '');
      }
      layout.classList.add('review-detail-active');
    }
  }
  const titleEl = document.getElementById('review-detail-title');
  const bodyEl  = document.getElementById('review-detail-body');
  const filterMap = {
    drafts:       t => t.gtd_status === 'inbox' && !t.completed,
    next_actions: t => t.gtd_status === 'next_action' && !t.is_draft && !t.completed,
    waiting:      t => t.gtd_status === 'waiting'     && !t.is_draft,
    someday:      t => t.gtd_status === 'someday',
    trash:        t => t.gtd_status === 'trash',
    next_week:    t => {
      if (t.gtd_status !== 'calendar') return false;
      const sd = t.scheduled_date || '';
      const ws = reviewSummaryCache?.week_start || todayStr();
      const we = reviewSummaryCache?.week_end   || todayStr();
      const nws = isoDate(addDays(new Date(we), 1));
      const nwe = isoDate(addDays(new Date(we), 7));
      return sd >= nws && sd <= nwe;
    },
    this_week:    t => {
      if (t.gtd_status !== 'done') return false;
      const ws = reviewSummaryCache?.week_start || todayStr();
      const we = reviewSummaryCache?.week_end   || todayStr();
      const ca = (t.completed_at || '').slice(0, 10);
      return ca >= ws && ca <= we;
    },
  };
  const labelMap = {
    drafts:       'オプションなし', next_actions: '次にやる', waiting: '待機中',
    someday:      'いつか', trash: 'ゴミ箱', next_week: '来週のカレンダー',
    this_week:    '今週の完了',
  };
  const filterFn = filterMap[stepId];
  const tasks = filterFn ? allTasks.filter(filterFn) : [];
  titleEl.textContent = labelMap[stepId] || '';
  if (!tasks.length) {
    bodyEl.innerHTML = '<div class="review-empty">対象のタスクはありません。</div>';
    return;
  }
  bodyEl.innerHTML = tasks.map(t => {
    const color = categoryColor(t.category_id);
    return `
      <div class="review-task" data-task-id="${escHtml(t.id)}" data-step="${stepId}" style="--card-color:${color}">
        <div class="review-task-head">
          <span class="review-task-pip" style="background:${color}"></span>
          <span class="review-task-title">${escHtml(t.title || '(無題)')}</span>
          <span class="review-task-status">${escHtml(GTD_STATUS_LABEL[t.gtd_status] || '')}</span>
        </div>
        <div class="review-task-actions">
          ${buildReviewActions(stepId, t)}
        </div>
      </div>`;
  }).join('');
}

function buildReviewActions(stepId, t) {
  const btn = (act, label) => `<button class="btn-ghost btn-review-act" data-act="${act}">${label}</button>`;
  switch (stepId) {
    case 'drafts':       return btn('edit', '詳細設定を開く') + btn('trash', '削除');
    case 'next_actions': return btn('edit', '詳細設定') + btn('done', '完了') + btn('someday', 'いつかへ') + btn('trash', '削除');
    case 'waiting':      return btn('edit', '詳細設定') + btn('done', '解消→完了') + btn('promote', '次にやるへ') + btn('trash', '削除');
    case 'someday':      return btn('edit', '詳細設定') + btn('promote', '次にやるへ昇格') + btn('trash', '削除');
    case 'trash':        return btn('edit', '詳細設定') + btn('restore', '復元→いつか') + btn('delete', '完全削除');
    case 'next_week':    return btn('edit', '詳細設定');
    case 'this_week':    return '';
    default:             return '';
  }
}

async function handleReviewAction(taskId, act) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  if (act === 'edit')    { switchTab('tasks'); openDetailPanel(taskId); return; }
  if (act === 'done')    {
    await patchTask(taskId, { completed: true, gtd_status: 'done' });
    await archiveTask(taskId);
  } else if (act === 'promote') {
    await moveTask(taskId, 'next_action');
    return;
  } else if (act === 'someday') {
    await patchTask(taskId, { gtd_status: 'someday' });
  } else if (act === 'trash') {
    await patchTask(taskId, { gtd_status: 'trash' });
  } else if (act === 'restore') {
    await patchTask(taskId, { gtd_status: 'someday' });
  } else if (act === 'delete') {
    if (!confirm('このタスクを完全に削除します。よろしいですか？')) return;
    await removeTask(taskId);
  }
  await renderReviewTab();
  renderTasksBoard();
}

async function completeWeeklyReview() {
  if (!confirm('今週のレビュー完了を記録しますか？')) return;
  try {
    await apiFetch('/api/review/complete', {
      method: 'POST',
      body: JSON.stringify({
        drafts_processed:       0, someday_promoted: 0, trash_deleted: 0,
        waiting_resolved:       0, next_actions_completed: 0, notes: '',
      }),
    });
    alert('レビュー完了を記録しました。');
    await renderReviewTab();
  } catch (err) {
    alert('記録に失敗しました: ' + err.message);
  }
}

/* ═══════════════════════════════════════════════════════════
   Habit Form Modal (Phase 5)
═══════════════════════════════════════════════════════════ */
function openHabitFormModal() {
  const bd = document.getElementById('habit-form-backdrop');
  if (!bd) return;
  // フォームをデフォルトに戻す
  document.getElementById('habit-form-title-input').value = '';
  document.querySelector('input[name="habit-form-frequency"][value="daily"]').checked = true;
  document.getElementById('habit-form-weekday').value     = '0';
  document.getElementById('habit-form-category').value    = 'life';
  document.getElementById('habit-form-tags').value        = '';
  document.getElementById('habit-form-notes').value       = '';
  toggleHabitWeekdayField();
  bd.classList.add('open');
  bd.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('habit-form-title-input')?.focus(), 50);
}

function closeHabitFormModal() {
  const bd = document.getElementById('habit-form-backdrop');
  if (!bd) return;
  bd.classList.remove('open');
  bd.setAttribute('aria-hidden', 'true');
}

function toggleHabitWeekdayField() {
  const freq = document.querySelector('input[name="habit-form-frequency"]:checked')?.value || 'daily';
  const wf   = document.getElementById('habit-form-weekday-field');
  if (!wf) return;
  if (freq === 'weekly') wf.classList.remove('hidden');
  else                   wf.classList.add('hidden');
}

async function saveHabitFromForm() {
  const title = document.getElementById('habit-form-title-input').value.trim();
  if (!title) {
    alert('タイトルを入力してください');
    return;
  }
  const frequency = document.querySelector('input[name="habit-form-frequency"]:checked')?.value || 'daily';
  const category  = document.getElementById('habit-form-category').value || 'life';
  const tagsRaw   = document.getElementById('habit-form-tags').value || '';
  const notes     = document.getElementById('habit-form-notes').value || '';
  const tags      = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

  const body = { title, frequency, category, tags, notes };
  if (frequency === 'weekly') {
    const wd = parseInt(document.getElementById('habit-form-weekday').value, 10);
    if (Number.isNaN(wd) || wd < 0 || wd > 6) {
      alert('曜日を選択してください'); return;
    }
    body.weekday = wd;
  }

  try {
    await apiFetch('/api/habits', { method: 'POST', body: JSON.stringify(body) });
    closeHabitFormModal();
    await loadHabits();
    renderHabitView();
    refreshDailyPanels();
  } catch (err) {
    alert('保存に失敗しました: ' + err.message);
  }
}

/* ═══════════════════════════════════════════════════════════
   Boot
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  _setOfflineBanner(!isOnline);
  await loadCategories();
  await loadTasks();
  await loadProjects();
  await loadHabits();
  populateCategorySelects();
  renderTasksBoard();

  _loadChats();
  if (chatHistories['dump'].length > 0) {
    const container = chatMessagesEl();
    container.innerHTML = '';
    for (const msg of chatHistories['dump']) appendMessage(msg.role, msg.content);
  }

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'archive')   renderArchivePanel();
      if (btn.dataset.tab === 'memo')      renderMemoPanel(true);
      if (btn.dataset.tab === 'diary')     renderDiaryPanel(true);
      if (btn.dataset.tab === 'calendar')  renderCalendarPanel();
      if (btn.dataset.tab === 'review')    renderReviewTab();
      if (btn.dataset.tab === 'projects')  renderProjectsTab();
      if (btn.dataset.tab === 'tasks')     refreshDailyPanels();
    })
  );

  // Tasks sub-view toggle (board / habits)
  document.querySelectorAll('.tasks-subview-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTasksSubView(btn.dataset.tasksView))
  );

  // モバイル列ナビ（スマホ専用、CSS で 640px 以下のみ表示）
  const tasksBody = document.getElementById('tasks-body-v2');
  if (tasksBody) tasksBody.dataset.col = 'inbox';

  function switchMobileCol(col) {
    document.querySelectorAll('.mobile-col-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.col === col)
    );
    if (tasksBody) tasksBody.dataset.col = col;
    if (col === 'daily') refreshDailyPanels();
  }

  document.querySelectorAll('.mobile-col-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMobileCol(btn.dataset.col));
  });

  // スマホ: 左右スワイプで隣接列に切り替え (inbox ↔ lists ↔ daily)
  {
    const mobileColOrder = ['inbox', 'lists', 'daily'];
    let swipeTouchStartX = 0;
    let swipeTouchStartY = 0;
    tasksBody?.addEventListener('touchstart', e => {
      swipeTouchStartX = e.changedTouches[0].clientX;
      swipeTouchStartY = e.changedTouches[0].clientY;
    }, { passive: true });
    tasksBody?.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - swipeTouchStartX;
      const dy = e.changedTouches[0].clientY - swipeTouchStartY;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      const cur = tasksBody.dataset.col || 'inbox';
      const idx = mobileColOrder.indexOf(cur);
      const next = dx < 0
        ? Math.min(idx + 1, mobileColOrder.length - 1)
        : Math.max(idx - 1, 0);
      if (next !== idx) switchMobileCol(mobileColOrder[next]);
    }, { passive: true });
  }

  // Habit sub-view event delegation
  const habitSubView = document.getElementById('tasks-subview-habits');
  if (habitSubView) {
    habitSubView.addEventListener('click', async e => {
      const paletteBtn = e.target.closest('.hg-palette-btn');
      if (paletteBtn) {
        const thisDetails = paletteBtn.closest('.hg-palette-details');
        document.querySelectorAll('.hg-palette-details[open]').forEach(d => {
          if (d !== thisDetails) d.removeAttribute('open');
        });
      }
      const sq = e.target.closest('.hg-sq.today');
      if (sq) {
        const habitId = sq.dataset.habitId;
        const dateStr = sq.dataset.date;
        if (habitId && dateStr) {
          const habit = allHabits.find(h => h.id === habitId);
          if (habit) {
            const newDone = !habit.today_done;
            await apiFetch(`/api/habits/${habitId}/log`, {
              method: 'POST',
              body: JSON.stringify({ date: dateStr, done: newDone }),
            });
            habit.today_done = newDone;
            habit.week_done = { ...habit.week_done, [dateStr]: newDone };
            const stats = await apiFetch(`/api/habits/${habitId}/stats`);
            habit.current_streak = stats.current_streak;
            renderHabitView();
            refreshDailyPanels();
          }
        }
        return;
      }
      const swatch = e.target.closest('.hg-swatch');
      if (swatch) {
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
        refreshDailyPanels();
        return;
      }
      const delBtn = e.target.closest('.hg-delete-btn');
      if (delBtn) {
        const habitId = delBtn.dataset.habitId;
        const h = allHabits.find(x => x.id === habitId);
        if (!h) return;
        if (!confirm(`「${h.title}」を削除しますか？\nログもすべて削除されます。`)) return;
        await apiFetch(`/api/habits/${habitId}`, { method: 'DELETE' });
        allHabits = allHabits.filter(x => x.id !== habitId);
        renderHabitView();
        refreshDailyPanels();
        return;
      }
    });
  }

  // Palette close on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.hg-palette-details')) {
      document.querySelectorAll('.hg-palette-details[open]').forEach(d => d.removeAttribute('open'));
    }
  });

  // Detail panel close
  document.getElementById('detail-panel-close').addEventListener('click', closeDetailPanel);

  // Mobile move sheet: cancel button + overlay tap
  document.getElementById('mobile-sheet-cancel')?.addEventListener('click', closeMobileMoveSheet);
  document.getElementById('mobile-sheet-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeMobileMoveSheet();
  });

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

  // Chat save / reset / send
  document.getElementById('chat-save').addEventListener('click', saveDumpSession);
  document.getElementById('chat-reset').addEventListener('click', resetChat);
  document.getElementById('chat-send').addEventListener('click', () => sendChatMessage(document.getElementById('chat-input').value));

  // Calendar view toggle (list / month / week)
  document.querySelectorAll('#panel-calendar .view-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#panel-calendar .view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scheduleView = btn.dataset.view; scheduleRefDate = new Date();
      renderCalendarPanel();
    })
  );
  document.getElementById('schedule-nav-prev').addEventListener('click', () => {
    if (scheduleView === 'month') scheduleRefDate.setMonth(scheduleRefDate.getMonth() - 1);
    else if (scheduleView === 'week') scheduleRefDate.setDate(scheduleRefDate.getDate() - 7);
    renderCalendarPanel();
  });
  document.getElementById('schedule-nav-next').addEventListener('click', () => {
    if (scheduleView === 'month') scheduleRefDate.setMonth(scheduleRefDate.getMonth() + 1);
    else if (scheduleView === 'week') scheduleRefDate.setDate(scheduleRefDate.getDate() + 7);
    renderCalendarPanel();
  });

  // Archive toolbar
  document.getElementById('archive-search').addEventListener('input', onArchiveSearchInput);
  document.getElementById('filter-category').addEventListener('change', renderArchivePanel);
  document.getElementById('filter-sort').addEventListener('change', renderArchivePanel);

  // Add task modal
  document.getElementById('btn-add-task').addEventListener('click', openModal);
  document.getElementById('btn-add-task-footer').addEventListener('click', openModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

  document.getElementById('btn-modal-save').addEventListener('click', async () => {
    const title    = document.getElementById('input-task-title').value.trim();
    if (!title) { document.getElementById('input-task-title').focus(); return; }
    const deadline = document.getElementById('input-task-deadline').value || null;
    const estEl    = document.getElementById('input-task-estimate');
    const estimate_minutes = estEl ? (parseInt(estEl.value, 10) || null) : null;
    const catEl    = document.getElementById('input-task-category');
    const category_id = catEl?.value || null;
    const task = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, deadline, estimate_minutes, category_id }),
    });
    allTasks.push(task);
    _saveCachedTasks(allTasks);
    closeModal();
    renderTasksBoard();
  });

  document.getElementById('input-task-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-modal-save').click();
    if (e.key === 'Escape') closeModal();
  });

  // GTD: Detail Settings Modal v2
  const dsClose = document.getElementById('btn-detail-settings-close');
  if (dsClose) dsClose.addEventListener('click', () => closeDetailSettings(true));
  const dsBd = document.getElementById('detail-settings-backdrop');
  if (dsBd) dsBd.addEventListener('click', e => { if (e.target === e.currentTarget) closeDetailSettings(true); });
  const dsSave = document.getElementById('btn-ds-save');
  if (dsSave) dsSave.addEventListener('click', finalizeDetailSettings);
  const dsAddRm = document.getElementById('btn-ds-add-roadmap');
  if (dsAddRm) dsAddRm.addEventListener('click', () => { dsLocalState.roadmap.push({ text: '', done: false, id: String(Date.now()) }); renderDsList('roadmap'); });
  const dsAddCl = document.getElementById('btn-ds-add-checklist');
  if (dsAddCl) dsAddCl.addEventListener('click', () => { dsLocalState.checklist.push({ text: '', done: false }); renderDsList('checklist'); });
  ['ds-title', 'ds-deadline', 'ds-scheduled-date', 'ds-waiting-for', 'ds-category-id', 'ds-estimate-minutes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', updateDsFinalizeButton); el.addEventListener('change', updateDsFinalizeButton); }
  });
  document.getElementById('btn-ds-cat-add')?.addEventListener('click', async () => {
    const name = prompt('新しいカテゴリー名を入力してください');
    if (!name?.trim()) return;
    try {
      const cat = await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await loadCategories();
      populateCategorySelects();
      const sel = document.getElementById('ds-category-id');
      if (sel && cat?.id) sel.value = cat.id;
    } catch (err) { alert('カテゴリー追加に失敗しました: ' + err.message); }
  });
  const dsAiSend = document.getElementById('btn-ds-ai-send');
  if (dsAiSend) dsAiSend.addEventListener('click', sendDsAiMessage);
  const dsAiInput = document.getElementById('ds-ai-input');
  if (dsAiInput) dsAiInput.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendDsAiMessage(); } });

  // GTD: Daily panel tabs
  document.querySelectorAll('.daily-tab').forEach(btn =>
    btn.addEventListener('click', () => switchDailyTab(btn.dataset.dailyTab))
  );
  document.getElementById('daily-panel').addEventListener('change', async e => {
    const habitCb = e.target.closest('.daily-habit-check');
    if (habitCb) {
      const habitId = habitCb.dataset.habitId;
      const date    = habitCb.dataset.date;
      const done    = habitCb.checked;
      try {
        await apiFetch(`/api/habits/${habitId}/log`, {
          method: 'POST',
          body: JSON.stringify({ date, done }),
        });
        const habit = allHabits.find(h => h.id === habitId);
        if (habit) {
          habit.week_done = { ...habit.week_done, [date]: done };
          if (date === todayStr()) habit.today_done = done;
          try {
            const stats = await apiFetch(`/api/habits/${habitId}/stats`);
            habit.current_streak = stats.current_streak;
          } catch { /* silent */ }
          if (tasksSubView === 'habits') renderHabitView();
          refreshDailyPanels();
        }
      } catch { /* silent */ }
      return;
    }
    const taskCb = e.target.closest('.daily-task-check');
    if (taskCb && !taskCb.disabled && taskCb.checked) {
      const taskId = taskCb.dataset.taskId;
      try {
        await patchTask(taskId, { completed: true, gtd_status: 'done' });
        await archiveTask(taskId);
        await refreshDailyPanels();
      } catch (err) {
        alert('完了処理に失敗しました: ' + err.message);
      }
    }
  });
  document.getElementById('daily-panel').addEventListener('click', async e => {
    const btn = e.target.closest('.daily-task-remove');
    if (!btn) return;
    const card = btn.closest('.daily-task-card');
    const tid  = card?.dataset.taskId;
    if (!tid) return;
    await scheduleTaskToSlot(tid, null);
  });

  // GTD v2: Board D&D (inbox -> lists, lists -> daily panel)
  setupTaskDragDrop();

  // GTD v2: Board list-head collapse toggle
  document.getElementById('board-lists-body')?.addEventListener('click', e => {
    const head = e.target.closest('[data-toggle-status]');
    if (head) toggleListSection(head.dataset.toggleStatus);
  });

  // GTD v2: Projects tab view toggle
  document.querySelectorAll('.projects-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      projectsView = btn.dataset.projectsView;
      document.querySelectorAll('.projects-view-btn').forEach(b => b.classList.toggle('active', b.dataset.projectsView === projectsView));
      renderProjectsTab();
    });
  });

  // GTD v2: Add project button
  function openAddProjectModal() {
    const bd = document.getElementById('add-project-backdrop');
    const inp = document.getElementById('input-project-title');
    if (!bd || !inp) return;
    inp.value = '';
    bd.classList.add('open');
    bd.setAttribute('aria-hidden', 'false');
    setTimeout(() => inp.focus(), 50);
  }
  function closeAddProjectModal() {
    const bd = document.getElementById('add-project-backdrop');
    if (!bd) return;
    bd.classList.remove('open');
    bd.setAttribute('aria-hidden', 'true');
  }
  async function saveAddProject() {
    const title = document.getElementById('input-project-title')?.value.trim();
    if (!title) { document.getElementById('input-project-title')?.focus(); return; }
    closeAddProjectModal();
    try {
      const proj = await apiFetch('/api/projects', {
        method: 'POST', body: JSON.stringify({ title }),
      });
      allProjects.push(proj);
      projectsView = 'drafting';
      document.querySelectorAll('.projects-view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.projectsView === projectsView)
      );
      renderProjectsTab();
      openProjectDetail(proj.id);
    } catch (err) { showMoveToast(err.message || 'プロジェクト作成に失敗しました'); }
  }
  document.getElementById('btn-add-project')?.addEventListener('click', openAddProjectModal);
  document.getElementById('btn-add-project-cancel')?.addEventListener('click', closeAddProjectModal);
  document.getElementById('add-project-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddProjectModal();
  });
  document.getElementById('btn-add-project-save')?.addEventListener('click', saveAddProject);
  document.getElementById('input-project-title')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveAddProject();
    if (e.key === 'Escape') closeAddProjectModal();
  });

  // Calendar Day Modal close
  document.getElementById('cal-day-modal-close')?.addEventListener('click', closeCalDayModal);
  document.getElementById('cal-day-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCalDayModal();
  });

  // GTD v2: Project detail modal
  document.getElementById('btn-project-detail-close')?.addEventListener('click', closeProjectDetail);
  document.getElementById('project-detail-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProjectDetail();
  });
  document.getElementById('btn-pd-activate')?.addEventListener('click', async () => {
    if (!projectDetailId) return;
    try {
      const res = await apiFetch(`/api/projects/${projectDetailId}/activate`, { method: 'POST' });
      const idx = allProjects.findIndex(p => p.id === projectDetailId);
      if (idx >= 0) allProjects[idx] = res;
      renderProjectDetailBody(res);
      renderProjectsTab();
    } catch (err) { showMoveToast(err.message || 'アクティブ化に失敗しました'); }
  });
  // 保存ボタン
  document.getElementById('btn-pd-save')?.addEventListener('click', async () => {
    if (!projectDetailId) return;
    const title = document.getElementById('pd-title')?.value.trim();
    if (!title) { showMoveToast('プロジェクト名は必須です'); return; }
    try {
      const updated = await patchProject(projectDetailId, {
        title,
        completion_condition: document.getElementById('pd-completion')?.value.trim() || null,
        period_start: document.getElementById('pd-period-start')?.value || null,
        period_end:   document.getElementById('pd-period-end')?.value   || null,
      });
      renderProjectDetailBody(updated);
      renderProjectsTab();
      showMoveToast('保存しました');
    } catch (err) { showMoveToast(err.message || '保存に失敗しました'); }
  });

  // 子タスク追加ボタン
  document.getElementById('btn-pd-add-child')?.addEventListener('click', async () => {
    if (!projectDetailId) return;
    const input = document.getElementById('pd-new-child-title');
    const title = input?.value.trim();
    if (!title) return;
    try {
      const task = await apiFetch(`/api/projects/${projectDetailId}/tasks`, {
        method: 'POST', body: JSON.stringify({ title }),
      });
      allTasks.push(task);
      if (input) input.value = '';
      const proj = allProjects.find(p => p.id === projectDetailId);
      if (proj) renderProjectDetailBody(proj);
      renderTasksBoard();
    } catch (err) { showMoveToast(err.message || 'タスク追加に失敗しました'); }
  });
  document.getElementById('pd-new-child-title')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-pd-add-child')?.click();
  });

  // 完了にするボタン
  document.getElementById('btn-pd-archive')?.addEventListener('click', async () => {
    if (!projectDetailId) return;
    const proj = allProjects.find(p => p.id === projectDetailId);
    if (!confirm(`「${proj?.title}」を完了にしますか？`)) return;
    try {
      const updated = await patchProject(projectDetailId, {
        status: 'completed', archived: true, completed_at: new Date().toISOString(),
      });
      closeProjectDetail();
      projectsView = 'completed';
      document.querySelectorAll('.projects-view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.projectsView === projectsView)
      );
      renderProjectsTab();
    } catch (err) { showMoveToast(err.message || '完了処理に失敗しました'); }
  });

  // 削除ボタン
  document.getElementById('btn-pd-delete')?.addEventListener('click', async () => {
    if (!projectDetailId) return;
    const proj = allProjects.find(p => p.id === projectDetailId);
    if (!confirm(`「${proj?.title}」を削除しますか？\n子タスクのプロジェクト所属は解除されますが、タスク自体は残ります。`)) return;
    try {
      await apiFetch(`/api/projects/${projectDetailId}`, { method: 'DELETE' });
      allTasks.forEach(t => { if (t.project_id === projectDetailId) t.project_id = null; });
      _saveCachedTasks(allTasks);
      allProjects = allProjects.filter(p => p.id !== projectDetailId);
      closeProjectDetail();
      renderProjectsTab();
      renderTasksBoard();
    } catch (err) { showMoveToast(err.message || '削除に失敗しました'); }
  });

  const pdAiSend  = document.getElementById('btn-pd-ai-send');
  const pdAiInput = document.getElementById('pd-ai-input');
  async function sendProjectAiChat() {
    if (!projectDetailId || !pdAiInput?.value.trim()) return;
    const text = pdAiInput.value.trim();
    pdAiInput.value = '';
    if (!projectChatHistories[projectDetailId]) projectChatHistories[projectDetailId] = [];
    projectChatHistories[projectDetailId].push({ role: 'user', content: text });
    const chatMsgs = document.getElementById('pd-ai-messages');
    if (chatMsgs) appendDpMsg(chatMsgs, 'user', text);
    if (pdAiSend) pdAiSend.disabled = true;
    try {
      const res = await fetch(`/api/projects/${projectDetailId}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: projectChatHistories[projectDetailId] }),
      });
      const data = await res.json();
      projectChatHistories[projectDetailId].push({ role: 'assistant', content: data.response });
      if (chatMsgs) appendDpMsg(chatMsgs, 'assistant', data.response);
      if (data.project_tasks_proposal) {
        await applyProjectTasksProposal(projectDetailId, data.project_tasks_proposal);
      }
    } catch {
      if (chatMsgs) appendDpMsg(chatMsgs, 'assistant', 'エラーが発生しました。');
    }
    if (pdAiSend) pdAiSend.disabled = false;
  }
  pdAiSend?.addEventListener('click', sendProjectAiChat);
  pdAiInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendProjectAiChat(); } });

  document.getElementById('move-confirm-backdrop')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.target.classList.remove('open');
  });

  // GTD: Weekly Review
  document.getElementById('review-steps').addEventListener('click', e => {
    const btn = e.target.closest('.review-step-card');
    if (btn) renderReviewStepDetail(btn.dataset.step);
  });
  document.getElementById('review-detail-body').addEventListener('click', e => {
    const btn = e.target.closest('.btn-review-act');
    if (!btn) return;
    const card = btn.closest('.review-task');
    if (!card) return;
    handleReviewAction(card.dataset.taskId, btn.dataset.act);
  });
  document.getElementById('btn-review-complete').addEventListener('click', completeWeeklyReview);
  // モバイル: 詳細 → ステップ一覧に戻る（← 一覧へボタン）
  document.getElementById('review-back-btn')?.addEventListener('click', () => {
    reviewActiveStep = null;
    document.querySelector('.review-layout')?.classList.remove('review-detail-active');
    if (history.state?.reviewDetail) history.back();
  });
  // モバイル: Androidバック / iOSスワイプバック
  window.addEventListener('popstate', () => {
    const layout = document.querySelector('.review-layout');
    if (layout?.classList.contains('review-detail-active')) {
      reviewActiveStep = null;
      layout.classList.remove('review-detail-active');
    }
  });

  // Habit form modal
  document.getElementById('btn-add-habit-toolbar')?.addEventListener('click', openHabitFormModal);
  document.getElementById('btn-habit-form-close')?.addEventListener('click', closeHabitFormModal);
  document.getElementById('btn-habit-form-cancel')?.addEventListener('click', closeHabitFormModal);
  document.getElementById('btn-habit-form-save')?.addEventListener('click', saveHabitFromForm);
  document.querySelectorAll('input[name="habit-form-frequency"]').forEach(r =>
    r.addEventListener('change', toggleHabitWeekdayField)
  );
  document.getElementById('habit-form-backdrop')?.addEventListener('click', e => {
    if (e.target.id === 'habit-form-backdrop') closeHabitFormModal();
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
      else if (currentTaskId) closeDetailPanel();
    }
    if (e.ctrlKey && e.key === 'n') {
      if (document.getElementById('panel-tasks').classList.contains('active')) {
        e.preventDefault(); openModal();
      }
    }
  });
});

// Reset board state on bfcache restore
window.addEventListener('pageshow', (event) => {
  if (event.persisted) renderTasksBoard();
});

// Mobile: visualViewport resize → update --vvh for keyboard avoidance
if (window.visualViewport) {
  const _updateVVH = () => {
    document.documentElement.style.setProperty('--vvh', `${window.visualViewport.height}px`);
  };
  window.visualViewport.addEventListener('resize', _updateVVH);
  _updateVVH();
}
