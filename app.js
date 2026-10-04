/* 问史 · 前端逻辑（无框架单页） */
'use strict';

/* ===== 工具 ===== */
const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const fmtTs = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2200);
}
/* 轻量 markdown：先整体转义（防 XSS），再逐行转换；模型偶尔输出 HTML 标签，先归一化 */
function mdLite(raw) {
  const norm = String(raw || '')
    .replace(/<b\s*>/gi, '**').replace(/<\/b\s*>/gi, '**')
    .replace(/<strong\s*>/gi, '**').replace(/<\/strong\s*>/gi, '**')
    .replace(/<br\s*\/?>/gi, '\n');
  const lines = norm.split(/\r?\n/);
  let out = '', inOl = false;
  const closeOl = () => { if (inOl) { out += '</div>'; inOl = false; } };
  const bold = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  for (let rawLn of lines) {
    const ln = bold(esc(rawLn));
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(ln)) { closeOl(); out += '<hr>'; continue; }
    const h = ln.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { closeOl(); out += `<span class="md-h${h[1].length}"><b>${h[2]}</b></span><br>`; continue; }
    const ol = ln.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) { if (!inOl) { out += '<div class="md-ol">'; inOl = true; } out += `<div class="md-oli">${ol[1]}</div>`; continue; }
    closeOl();
    if (/^\s*[-*•·]\s+/.test(ln)) { out += `<span class="md-li">${ln.replace(/^\s*[-*•·]\s+/, '')}</span>`; continue; }
    if (!ln.trim()) { out += '<span class="md-gap"></span>'; continue; }
    out += ln + '<br>';
  }
  closeOl();
  return out.replace(/<br>$/, '');
}

/* ===== 本地存储 ===== */
const LS = {
  state: 'ws_state', hist: 'ws_hist', kb: 'ws_kb', mem: 'ws_mem',
  rules: 'ws_rules', meta: 'ws_meta',
  seenVer: 'ws_seen_ver', api: 'ws_api', models: 'ws_models_cache',
};
function loadLS(key, dft) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? dft : v; }
  catch (e) { return dft; }
}
function saveLS(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; }
  catch (e) {
    if (typeof toast === 'function') toast('本地存储已满：请「我的→导出备份」后清理数据', 4000);
    return false;
  }
}

const State = {
  s: loadLS(LS.state, null) || {
    syncCode: '', syncOn: true, model: '', digestOn: true, kbOn: true, curSession: '',
  },
  save() { saveLS(LS.state, this.s); },
};

/* ---- 一次性迁移：旧的单聊天记录 → 多会话结构 ---- */
(function migrateHist() {
  if (localStorage.getItem('ws_sessions') !== null) return;   // 键存在（哪怕是 []）就不再迁移
  const old = loadLS('ws_hist', []);
  if (Array.isArray(old) && old.length) {
    const firstQ = old.find(m => m.role === 'user');
    const id = uid();
    saveLS('ws_sessions', [{ id, title: String((firstQ && firstQ.content) || '历史对话').slice(0, 16), ts: now(), msgs: old }]);
    State.s.curSession = id;
    State.save();
  }
})();

/* ===== 多会话管理 ===== */
const Sessions = (() => {
  const MAX_SESS = 30;
  const BUDGET = 3.2 * 1024 * 1024;   // localStorage 预算，超了从最旧会话丢，防静默写失败
  let _cache = null, _cacheKey = '';
  function all() { return loadLS('ws_sessions', []); }
  function curId() { return State.s.curSession || ''; }
  function invalidate() { _cache = null; _cacheKey = ''; }
  function saveAll(list) {
    let out = list.slice(0, MAX_SESS);
    const keepId = curId();
    while (out.length > 1 && JSON.stringify(out).length > BUDGET) {
      let removed = false;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].id !== keepId) { out.splice(i, 1); removed = true; break; }
      }
      if (!removed) break;
    }
    saveLS('ws_sessions', out);
    invalidate();
    Sync.markDirty('hist');
  }
  function cur() { return all().find(s => s.id === curId()) || null; }
  /* 带缓存的消息读取：renderMsgs 等高频路径不再每次全量 JSON.parse */
  function curMsgs() {
    const id = curId();
    if (_cache && _cacheKey === id) return _cache;
    const s = cur();
    _cache = s ? (s.msgs || []) : [];
    _cacheKey = id;
    return _cache;
  }
  function ensure() {
    let c = cur();
    if (!c) {
      c = { id: uid(), title: '', ts: now(), msgs: [] };
      const list = all();
      list.unshift(c);
      _cache = c.msgs; _cacheKey = c.id;
      State.s.curSession = c.id;
      State.save();
      saveLS('ws_sessions', list.slice(0, MAX_SESS));
      Sync.markDirty('hist');
    }
    return c;
  }
  function put(msgs, maxKeep) {
    const list = all();
    const i = list.findIndex(s => s.id === curId());
    if (i < 0) { ensure(); return put(msgs, maxKeep); }
    list[i].msgs = msgs.slice(-(maxKeep || 120));
    list[i].ts = now();
    if (!list[i].title) {
      const firstQ = msgs.find(m => m.role === 'user');
      if (firstQ) list[i].title = String(firstQ.content).slice(0, 16);
    }
    _cache = list[i].msgs; _cacheKey = list[i].id;   // 缓存同步为落盘后的数组
    saveAll(list);
  }
  function switchTo(id) { State.s.curSession = id; State.save(); invalidate(); }
  function remove(id) {
    saveAll(all().filter(s => s.id !== id));
    if (curId() === id) { State.s.curSession = ''; State.save(); invalidate(); }
  }
  function newOne() { State.s.curSession = ''; State.save(); invalidate(); }
  function clearAll() {
    saveLS('ws_sessions', []);
    try { localStorage.removeItem('ws_hist'); } catch (e) { /* 旧键清掉，防迁移复活 */ }
    State.s.curSession = '';
    State.save();
    invalidate();
    Sync.markDirty('hist');
  }
  return { all, cur, curMsgs, ensure, put, switchTo, remove, newOne, clearAll, curId, invalidate };
})();

/* ===== 云端同步（照搬 vocab-flash 模式：裸 fetch + action 协议） ===== */
const API_DEFAULT = 'https://qinfweihe1-d5gxpjjli9f8f238b.service.tcloudbase.com/wsapi';
/* 云端只备份轻量数据；知识库(kb)只存本地（用户要求，云端容量有限），靠导出文件迁移 */
const DOMAINS = ['hist', 'mem', 'settings', 'rules'];
const PUSH_DELAY = 30 * 1000;

const Sync = (() => {
  const api = () => (localStorage.getItem(LS.api) || API_DEFAULT).trim() || API_DEFAULT;

  async function request(action, payload, timeoutMs) {
    const body = { action, code: State.s.syncCode || '', ...(payload || {}) };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    let res;
    try {
      res = await fetch(api(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
    let j = null;
    try { j = await res.json(); } catch (e) { throw new Error('服务返回异常(' + res.status + ')'); }
    if (!j || j.ok !== true) {
      const err = new Error((j && j.message) || ('HTTP ' + res.status));
      err.code = j && j.error;
      throw err;
    }
    return j;
  }

  /* 域数据快照 */
  function snapshot(domain) {
    if (domain === 'hist') return { sessions: loadLS('ws_sessions', []), cur: Sessions.curId() };
    if (domain === 'kb') return loadLS(LS.kb, []);
    if (domain === 'mem') return loadLS(LS.mem, { profile: '', ts: 0 });
    if (domain === 'rules') return loadLS(LS.rules, []);
    if (domain === 'settings') {
      const { model, digestOn, kbOn } = State.s;
      return { model, digestOn, kbOn, ts: now() };
    }
    return null;
  }

  const hashes = loadLS('ws_sync_hashes', {});
  const dirty = new Set();
  let pushTimer = null, pushing = false, lastState = '';

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function markDirty(...doms) {
    if (!State.s.syncOn || !State.s.syncCode) return;
    for (const d of (doms.length ? doms : DOMAINS)) dirty.add(d);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushAll, PUSH_DELAY);
  }

  async function pushAll(force) {
    if (!State.s.syncOn || !State.s.syncCode) return;
    if (pushing) return;
    pushing = true;
    try {
      for (const d of DOMAINS) {
        if (!force && !dirty.has(d)) continue;
        const data = snapshot(d);
        const h = djb2(JSON.stringify(data));
        if (!force && hashes[d] === h) { dirty.delete(d); continue; }
        await request('state.put', { domain: d, data });
        hashes[d] = h;
        dirty.delete(d);
      }
      saveLS('ws_sync_hashes', hashes);
      setSyncState('已备份 ' + new Date().toTimeString().slice(0, 5));
    } catch (e) {
      setSyncState('备份失败：' + e.message);
    } finally { pushing = false; }
  }

  function setSyncState(txt) { lastState = txt; const el = $('#me-sync-state'); if (el) el.textContent = txt; }

  /* 合并：知识库按 id 并集（同 id 取新），历史按 ts 去重排序，记忆取新，设置只取偏好 */
  function merge(domain, cloud, force) {
    if (cloud == null) return false;
    if (domain === 'kb') {
      const local = loadLS(LS.kb, []);
      const map = new Map(local.map(e => [e.id, e]));
      for (const e of (cloud || [])) {
        const old = map.get(e.id);
        if (!old || (e.ts || 0) >= (old.ts || 0)) map.set(e.id, e);
      }
      const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 500);
      saveLS(LS.kb, merged);
      return true;
    }
    if (domain === 'hist') {
      /* 兼容两种云端格式：
         v1 = 平铺消息数组（早期版本写的）；v2 = { sessions:[...], cur } */
      let cloudSessions = null;
      if (cloud && Array.isArray(cloud.sessions)) cloudSessions = cloud.sessions;
      else if (Array.isArray(cloud)) {
        const firstQ = cloud.find(m => m.role === 'user');
        const ts = cloud.reduce((m, x) => Math.max(m, x.ts || 0), 0);
        cloudSessions = [{
          id: 'legacy-' + ts,
          title: String((firstQ && firstQ.content) || '历史对话').slice(0, 16),
          ts, msgs: cloud,
        }];
      }
      if (!cloudSessions || !cloudSessions.length) return false;
      const local = loadLS('ws_sessions', []);
      if (!local.length) {
        saveLS('ws_sessions', cloudSessions);
        Sessions.invalidate();
        State.s.curSession = (cloud && cloud.cur) || cloudSessions[0].id;
        State.save();
        return true;
      }
      if (force) {
        // 手动「从云端恢复」：并集合并（同 id 取新），本地会话保留不丢
        const map = new Map(local.map(s => [s.id, s]));
        for (const s of cloudSessions) {
          const old = map.get(s.id);
          if (!old || (s.ts || 0) > (old.ts || 0)) map.set(s.id, s);
        }
        const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30);
        saveLS('ws_sessions', merged);
        Sessions.invalidate();
        if (!State.s.curSession) { State.s.curSession = (merged[0] && merged[0].id) || ''; State.save(); }
        return true;
      }
      return false;   // 自动同步路径：本地有数据就不动（防覆盖）
    }
    if (domain === 'mem') {
      const local = loadLS(LS.mem, { profile: '', ts: 0 });
      if ((cloud.ts || 0) >= (local.ts || 0)) { saveLS(LS.mem, cloud); return true; }
      return false;
    }
    if (domain === 'rules') {
      const local = loadLS(LS.rules, []);
      const cloudArr = Array.isArray(cloud) ? cloud : [];
      if (!local.length && cloudArr.length) { saveLS(LS.rules, cloudArr); return true; }
      if (force && cloudArr.length) {
        const seen = new Set(local.map(r => r && r.text));
        const merged = local.concat(cloudArr.filter(r => r && r.text && !seen.has(r.text)));
        saveLS(LS.rules, merged.slice(0, 40));
        return true;
      }
      return false;
    }
    if (domain === 'settings') {
      if (cloud && cloud.model && !State.s.model) State.s.model = cloud.model;
      if (typeof cloud.digestOn === 'boolean') State.s.digestOn = cloud.digestOn;
      if (typeof cloud.kbOn === 'boolean') State.s.kbOn = cloud.kbOn;
      State.save();
      return true;
    }
    return false;
  }

  async function restore(code) {
    const target = (code || State.s.syncCode || '').toUpperCase();
    if (!/^[A-Z2-7]{12}$/.test(target)) throw new Error('同步码格式不对（12 位）');
    const j = await request('state.get', { domain: 'ALL', code: target });
    let n = 0;
    for (const d of DOMAINS) if (merge(d, j[d], true)) n++;   // 手动恢复：强制合并
    return n;
  }

  async function ensureCode() {
    if (State.s.syncCode) return State.s.syncCode;
    try {
      const j = await request('init');
      State.s.syncCode = j.code;
      State.save();
      renderCode();
      markDirty();
      return j.code;
    } catch (e) {
      setSyncState('离线模式：' + e.message);
      return '';
    }
  }

  async function init() {
    renderCode();
    setSyncState(State.s.syncCode ? (lastState || '待同步') : '未生成');
    if (State.s.syncCode && State.s.syncOn) {
      try {
        const j = await request('state.get', { domain: 'ALL' });
        let changed = false;
        for (const d of DOMAINS) if (merge(d, j[d])) changed = true;
        if (changed) { Chat.renderMsgs(); KB.render(); }
        /* 本地非空但云端更新（常见于重装/换设备）→ 不静默丢弃，提示可手动恢复 */
        if (!changed && j.hist && Array.isArray(j.hist.sessions)) {
          const cloudMax = j.hist.sessions.reduce((m, s) => Math.max(m, s.ts || 0), 0);
          const localMax = loadLS('ws_sessions', []).reduce((m, s) => Math.max(m, s.ts || 0), 0);
          if (cloudMax > localMax + 60000) toast('云端有更新的对话，可在「我的 → 从云端恢复」拉取', 3500);
        }
        for (const d of DOMAINS) { const h = djb2(JSON.stringify(snapshot(d))); hashes[d] = h; }
        saveLS('ws_sync_hashes', hashes);
        setSyncState('已同步');
      } catch (e) { setSyncState('云同步失败：' + e.message); }
    } else if (State.s.syncOn) {
      await ensureCode(); // 新设备：先领同步码，聊天/备份都靠它
    }
  }

  return { request, markDirty, pushAll, restore, ensureCode, init, setSyncState };
})();

/* ===== 记忆档案 ===== */
const Mem = {
  get() { return loadLS(LS.mem, { profile: '', ts: 0 }); },
  set(profile) { saveLS(LS.mem, { profile: String(profile || '').slice(0, 800), ts: now() }); Sync.markDirty('mem'); },
};

/* ===== 进化法则（用户反馈积累的回答教训，每次都注入 AI） ===== */
const Rules = (() => {
  const MAX = 40;
  function all() { return loadLS(LS.rules, []); }
  function save(l) { saveLS(LS.rules, l.slice(0, MAX)); Sync.markDirty('rules'); }
  function texts() { return all().map(r => r.text); }
  function add(text, src) {
    const id = uid();
    const l = all();
    l.unshift({ id, text: String(text).slice(0, 120), src: src || 'fb', ts: now() });
    save(l);
    return id;   // 返回法则 id，评价反悔时按它撤销
  }
  function remove(id) { save(all().filter(r => r.id !== id)); }
  function replace(list) {
    save((list || []).map(t => ({ id: uid(), text: String(t).slice(0, 120), src: 'review', ts: now() })));
  }
  return { all, texts, add, remove, replace };
})();

/* ===== 线条图标（Feather 风格，替代 emoji） ===== */
const SVG = (() => {
  const wrap = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return {
    good: wrap('<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>'),
    bad: wrap('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>'),
    copy: wrap('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    regen: wrap('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  };
})();

/* ===== 知识库 ===== */
const KB = (() => {
  function all() { return loadLS(LS.kb, []); }
  function save(list) { saveLS(LS.kb, list.slice(0, 500)); }   // 知识库只在本地，不进云同步

  /* 关键词打分：标题*3 + 标签*2 + 内容*1 */
  function score(q, e) {
    const terms = Array.from(new Set((q.toLowerCase().match(/[\u4e00-\u9fa5]{2}|[a-z]{2,}/g) || [])));
    if (!terms.length) return 0;
    let s = 0;
    const title = (e.title || '').toLowerCase(), tags = (e.tags || []).join(' ').toLowerCase(), body = (e.content || '').toLowerCase();
    for (const t of terms) {
      if (title.includes(t)) s += 3;
      if (tags.includes(t)) s += 2;
      if (body.includes(t)) s += 1;
    }
    return s;
  }
  function search(q, n) {
    if (!q || !State.s.kbOn) return [];
    return all().map(e => ({ e, s: score(q, e) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, n || 5)
      .map(x => x.e);
  }
  function add(entries) {
    if (!Array.isArray(entries) || !entries.length) return 0;
    const list = all();
    let added = 0;
    for (const it of entries) {
      const title = String(it.title || '').trim().slice(0, 60);
      const content = String(it.content || '').trim().slice(0, 1200);
      if (!title || !content) continue;
      list.unshift({
        id: uid(), title, content,
        tags: (Array.isArray(it.tags) ? it.tags : []).map(t => String(t).slice(0, 12)).slice(0, 4),
        src: it.src || 'auto', ts: it.ts || now(),
      });
      added++;
    }
    save(list);
    render();
    return added;   // 实际新增条数（此前返回累计总数，toast 永远为真）
  }
  function remove(id) { save(all().filter(e => e.id !== id)); render(); }
  function clearDoc() { save(all().filter(e => e.src !== 'doc')); render(); }

  /* 文档导入：txt/md 按段落聚合成 ~600 字块 */
  function importText(filename, text) {
    const clean = String(text || '')
      .replace(/^#{1,6}\s*/gm, '')           // md 标题符号
      .replace(/[*_`~]{1,3}/g, '')           // 强调符号
      .replace(/\r\n?/g, '\n').trim();
    if (!clean) return 0;
    const paras = clean.split(/\n{2,}|(?<=。)。\s*/).map(s => s.trim()).filter(Boolean);
    const chunks = [];
    let buf = '';
    for (const p of paras) {
      if ((buf + p).length > 600 && buf) { chunks.push(buf); buf = p; }
      else buf = buf ? buf + '\n' + p : p;
    }
    if (buf) chunks.push(buf);
    const base = (filename || '文档').replace(/\.(txt|md|markdown)$/i, '').slice(0, 20);
    const entries = chunks.map((c, i) => ({
      title: `${base}（${i + 1}/${chunks.length}）`,
      content: c, tags: ['文档', base], src: 'doc', ts: now(),
    }));
    return add(entries);
  }

  function render() {
    const q = ($('#kb-search') ? $('#kb-search').value : '').trim().toLowerCase();
    let list = all();
    if (q) {
      const terms = Array.from(new Set((q.match(/[\u4e00-\u9fa5]{2}|[a-z0-9]{2,}/g) || [])));
      list = list.filter(e => {
        const hay = (e.title + ' ' + (e.tags || []).join(' ') + ' ' + e.content).toLowerCase();
        return terms.some(t => hay.includes(t));
      });
    }
    const stat = $('#kb-stat'), wrap = $('#kb-list');
    if (stat) stat.textContent = q ? `匹配 ${list.length} 条 / 共 ${all().length} 条` : `共 ${all().length} 条知识点`;
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = `<div class="kb-empty">${q ? '没有匹配的知识点' : '还没有知识点<br><span>每轮问答会自动提炼入库，也可以导入 txt/md 文档</span>'}</div>`;
      return;
    }
    wrap.innerHTML = list.slice(0, 200).map(e => `
      <div class="kb-item" data-id="${esc(e.id)}">
        <div class="kb-item-top">
          <div class="kb-item-title">${esc(e.title)}</div>
          <span class="kb-src ${e.src === 'doc' ? 'doc' : ''}">${e.src === 'doc' ? '文档' : '提炼'}</span>
          <button class="kb-del" data-del="${esc(e.id)}">删除</button>
        </div>
        <div class="kb-item-body"><span class="clamp">${esc(e.content)}</span></div>
        <div class="kb-item-foot">
          <div class="kb-tags">${(e.tags || []).map(t => `<span class="kb-tag">${esc(t)}</span>`).join('')}</div>
          <span class="kb-time">${fmtTs(e.ts || 0)}</span>
        </div>
      </div>`).join('');
  }

  function bind() {
    const list = $('#kb-list');
    list.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      if (del) { ev.stopPropagation(); remove(del.getAttribute('data-del')); toast('已删除'); return; }
      const item = ev.target.closest('.kb-item');
      if (item) item.classList.toggle('open');
    });
    $('#kb-search').addEventListener('input', render);
    $('#kb-import-btn').addEventListener('click', () => $('#kb-file').click());
    $('#kb-file').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('文件太大（限 2MB）'); return; }
      try {
        const text = await f.text();
        const n = importText(f.name, text);
        toast(n ? `已导入 ${n} 条` : '没解析出内容');
      } catch (e) { toast('读取失败：' + e.message); }
    });
  }

  return { all, add, remove, clearDoc, search, importText, render, bind };
})();

/* ===== 问答 ===== */
const Chat = (() => {
  let sending = false;
  const HIST_MAX = 120, CTX_MAX = 12;
  const REASONS = ['太浅了', '大俗话', '太理论', '例子不好', '立场偏了', '太长'];

  function hist() { return Sessions.curMsgs(); }
  function saveHist(h) { Sessions.put(h, HIST_MAX); }
  function meta() { return loadLS(LS.meta, { rounds: 0 }); }

  /* ---- 打字机状态：{idx, shown}，renderMsgs 按 shown 截断显示 ---- */
  let typingState = null;
  let typingTimer = null;
  function stopTypewriter(finish) {
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    if (finish && typingState) {
      const st = typingState;
      typingState = null;
      const b = bubbleEl(st.idx);
      if (b) b.innerHTML = mdLite((hist()[st.idx] || {}).content || '');
    }
    typingState = null;
  }
  function bubbleEl(idx) {
    return document.querySelector(`.msg.bot[data-idx="${idx}"] .bubble`);
  }
  function startTypewriter(idx, fullText) {
    stopTypewriter(false);
    const len = fullText.length;
    if (!len) return;
    // 总时长 1.8s ~ 6s 自适应：短答案快些，长答案别拖沓
    const dur = Math.min(6000, Math.max(1800, len * 26));
    const tick = 40;
    const per = Math.max(1, Math.ceil(len / (dur / tick)));
    typingState = { idx, shown: Math.min(per, len) };
    renderMsgs();
    typingTimer = setInterval(() => {
      if (!typingState) { clearInterval(typingTimer); typingTimer = null; return; }
      typingState.shown = Math.min(len, typingState.shown + per);
      const b = bubbleEl(idx);
      if (b) b.innerHTML = mdLite(fullText.slice(0, typingState.shown)) + '<span class="caret"></span>';
      // 只在用户本来就贴着底部时才自动跟随，避免打断上翻历史
      const wrap = $('#chat-msgs');
      if (wrap && wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120) wrap.scrollTop = wrap.scrollHeight;
      if (typingState.shown >= len) {
        clearInterval(typingTimer); typingTimer = null;
        typingState = null;
        const b2 = bubbleEl(idx);
        if (b2) b2.innerHTML = mdLite(fullText);
        renderMsgs(); // 补上评价条
      }
    }, tick);
  }

  function fbBarHtml(idx, m) {
    if (m.role !== 'assistant') return '';
    if (typingState && typingState.idx === idx) return ''; // 打字中不显示操作条
    const fb = m.fb || {};
    const isLast = idx === hist().length - 1;
    const hint = (fb.v === 'bad')
      ? '<span class="fb-note-tag">' + (fb.ruleId ? '已生成法则' : (fb.reason || '已记教训')) + '</span>'
      : (fb.v === 'good' ? '<span class="fb-note-tag">已记录</span>' : '');
    return `<div class="fb-bar" data-idx="${idx}">
      <button class="fb-btn ${fb.v === 'good' ? 'on' : ''}" data-fb="good" data-idx="${idx}">${SVG.good}有用</button>
      <button class="fb-btn bad ${fb.v === 'bad' ? 'on' : ''}" data-fb="bad" data-idx="${idx}">${SVG.bad}没用</button>
      <button class="fb-btn" data-copy="${idx}">${SVG.copy}复制</button>
      ${isLast ? `<button class="fb-btn" data-regen="${idx}">${SVG.regen}重答</button>` : ''}
      ${hint}
    </div>`;
  }
  function reasonPanelHtml(idx) {
    return `<div class="fb-panel" data-panel="${idx}">
      <div class="fb-qs">哪里不好？（让 AI 永久记住这条教训）</div>
      <div class="fb-chips">${REASONS.map(r => `<button class="chip small" data-reason="${r}">${r}</button>`).join('')}</div>
      <input class="fb-note" maxlength="120" placeholder="补充说明（可选）">
      <div class="btn-row" style="margin-top:8px">
        <button class="mini-btn wide" data-fb-cancel="${idx}">取消</button>
        <button class="mini-btn wide primary" data-fb-ok="${idx}" disabled>生成法则</button>
      </div>
    </div>`;
  }

  function renderMsgs() {
    const wrap = $('#chat-msgs');
    const h = hist();
    const empty = $('#chat-empty');
    if (empty) empty.classList.toggle('hidden', h.length > 0);
    $$('.msg', wrap).forEach(m => m.remove());
    const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
    const shown = h.slice(-60);
    const base = h.length - shown.length;
    for (let i = 0; i < shown.length; i++) {
      const m = shown[i];
      const idx = base + i;
      if (m.role === 'user') {
        wrap.insertAdjacentHTML('beforeend', `
          <div class="msg user"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`);
      } else {
        const content = (typingState && typingState.idx === idx)
          ? mdLite(String(m.content || '').slice(0, typingState.shown)) + '<span class="caret"></span>'
          : mdLite(m.content);
        wrap.insertAdjacentHTML('beforeend', `
          <div class="msg bot" data-idx="${idx}"><div class="bubble">${content}</div>${fbBarHtml(idx, m)}</div>`);
      }
    }
    if (atBottom || sending) wrap.scrollTop = wrap.scrollHeight;
  }

  /* 等待期提示：三个点 + 超时换文案（长问题 pro 模型会等较久） */
  let waitLabel = null;
  function showTyping() {
    $('#chat-msgs').insertAdjacentHTML('beforeend', `
      <div class="msg bot" id="msg-typing"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span><span id="typing-label" style="font-size:12px;color:var(--ink-3);margin-left:6px"></span></div></div>`);
    $('#chat-msgs').scrollTop = 1e9;
    waitLabel = { el: $('#typing-label'), n: 0, timer: setInterval(() => {
      if (!waitLabel || !waitLabel.el) { clearInterval(waitLabel && waitLabel.timer); return; }
      waitLabel.n++;
      waitLabel.el.textContent = waitLabel.n >= 3 ? '还在想，长问题要多琢磨一会儿…' : (waitLabel.n >= 1 ? '正在思考…' : '');
    }, 4500) };
  }
  function hideTyping() {
    const t = $('#msg-typing'); if (t) t.remove();
    if (waitLabel) { clearInterval(waitLabel.timer); waitLabel = null; }
  }

  function pushMsg(role, content) {
    const h = hist();
    h.push({ role, content, ts: now() });
    saveHist(h);
    renderMsgs();
  }

  /* 反馈 → 法则（可反悔：点另一个切换；再点当前的评价 = 取消并撤销对应法则） */
  async function feedback(idx, v) {
    const h = hist();
    const m = h[idx];
    if (!m || m.role !== 'assistant') return;
    const cur = m.fb || {};
    // 点了当前已有的评价 → 取消评价；若是差评则连同生成的法则一起撤销
    if (cur.v === v) {
      if (cur.ruleId) { Rules.remove(cur.ruleId); toast('已撤销评价，对应法则一并删除'); }
      else toast('已取消评价');
      delete m.fb;
      saveHist(h); renderMsgs();
      return;
    }
    // 从差评切到好评：先撤法则
    if (cur.v === 'bad' && v === 'good') {
      if (cur.ruleId) Rules.remove(cur.ruleId);
    }
    if (v === 'good') {
      m.fb = { v: 'good', ts: now() };
      saveHist(h); renderMsgs();
      toast('已记录，谢谢反馈');
      return;
    }
    // 差评：弹原因面板（在 bind 里处理），这里只处理面板确认后的落库
    m.fb = { v: 'bad', reason: cur.reason || '', ts: now() };
    if (cur.ruleId) { m.fb.ruleId = cur.ruleId; } // 切换保留旧法则（重选原因时会替换）
    saveHist(h); renderMsgs();
  }

  /* 差评确认（原因+补充）→ 落库 + 生成法则 */
  async function feedbackConfirm(idx, reason, note) {
    const h = hist();
    const m = h[idx];
    if (!m || m.role !== 'assistant') return;
    // 重选原因：先撤旧法则再生成新的
    if (m.fb && m.fb.ruleId) Rules.remove(m.fb.ruleId);
    m.fb = { v: 'bad', reason: reason || '', note: note || '', ts: now() };
    saveHist(h); renderMsgs();
    let q = '';
    for (let i = idx - 1; i >= 0; i--) { if (h[i].role === 'user') { q = h[i].content; break; } }
    toast('正在生成进化法则…');
    try {
      const j = await Sync.request('ai.rule', { q, a: m.content, reason: reason || '', note: note || '' }, 60000);
      if (j.rule) {
        const rid = Rules.add(j.rule, 'fb');
        const h2 = hist();
        if (h2[idx] && h2[idx].fb) { h2[idx].fb.ruleId = rid; saveHist(h2); }
        toast('已进化 +1 条法则：' + j.rule.slice(0, 40) + (j.rule.length > 40 ? '…' : ''));
      }
    } catch (e) {
      toast('法则生成失败：' + e.message);
    }
    renderMsgs();
  }

  /* 提炼：一轮问答 → 知识点 + 记忆更新（失败静默，不影响主流程） */
  let digestFail = 0;
  async function digest(q, a) {
    try {
      const j = await Sync.request('ai.digest', { q, a, mem: Mem.get().profile }, 60000);
      let added = 0;
      if (Array.isArray(j.kb) && j.kb.length) added = KB.add(j.kb.map(it => ({ ...it, src: 'auto' })));
      if (j.mem) Mem.set(j.mem);
      digestFail = 0;
      return added;
    } catch (e) {
      digestFail++;
      if (digestFail >= 3) { digestFail = 0; toast('提炼入库连续失败，已暂停本轮'); }
      return 0;
    }
  }

  /* 复盘：AI 重写整套法则（每 20 轮自动 / 设置页手动） */
  async function reviewNow(auto) {
    const recent = hist().slice(-10)
      .map(m => (m.role === 'user' ? '问：' : '答：') + String(m.content).slice(0, 150)).join('\n');
    const j = await Sync.request('ai.review', {
      rules: Rules.texts(), mem: Mem.get().profile, recent,
    }, 90000);
    if (Array.isArray(j.rules) && j.rules.length) Rules.replace(j.rules);
    toast((auto ? '已自动复盘' : '复盘完成') + '：法则 ' + (j.rules || []).length + ' 条');
    try { Me.renderRules(); } catch (e) { /* 设置页未打开 */ }
  }

  async function send(text, opts) {
    const o = opts || {};
    const q = String(text || '').trim();
    if (!q || sending) return;
    sending = true;
    stopTypewriter(true);   // 上一条还在打字就先瞬间补全
    $('#chat-send').disabled = true;
    if (!o.noPushUser) pushMsg('user', q);
    Sessions.ensure();
    showTyping();
    const ctx = hist().slice(-CTX_MAX).map(m => ({ role: m.role, content: m.content }));
    try {
      if (!State.s.syncCode) await Sync.ensureCode();
      if (!State.s.syncCode) throw Object.assign(new Error('网络不可用，稍后再试'), { silent: true });
      const kbHits = KB.search(q).map(e => ({ title: e.title, content: String(e.content).slice(0, 400) }));
      const j = await Sync.request('ai.chat', {
        messages: ctx, mem: String(Mem.get().profile || '').slice(0, 600), kb: kbHits,
        rules: Rules.texts(),
        ...(State.s.model ? { model: State.s.model } : {}),
      }, 120000);
      hideTyping();
      const full = j.text || '（空回答）';
      const h = hist();
      h.push({ role: 'assistant', content: full, ts: now() });
      saveHist(h);
      startTypewriter(hist().length - 1, full);   // 用落盘（含截断）后的真实下标
      if (State.s.digestOn) digest(q, full).then(n => { if (n) toast('已提炼入库'); });
      // 轮次计数 + 每 20 轮自动复盘
      const mt = meta();
      mt.rounds = (mt.rounds || 0) + 1;
      saveLS(LS.meta, mt);
      if (mt.rounds % 20 === 0) reviewNow(true).catch(() => {});
    } catch (e) {
      hideTyping();
      if (!e.silent) {
        const msg = e.code === 'LIMIT' ? e.message : '回答失败：' + e.message;
        $('#chat-msgs').insertAdjacentHTML('beforeend', `
          <div class="msg bot"><div class="bubble msg-err">${esc(msg)}<br><span style="color:var(--ink-3);font-size:12px">内容已保留，稍后可重试</span></div></div>`);
        $('#chat-msgs').scrollTop = 1e9;
      }
    } finally {
      sending = false;
      $('#chat-send').disabled = false;
    }
  }

  /* 重新生成：只对最后一条回答——旧回答记为不满意（不产法则），截断后重问 */
  async function regenerate(idx) {
    if (sending) return;
    const h = hist();
    const m = h[idx];
    if (!m || m.role !== 'assistant' || idx !== h.length - 1) return;
    let q = '';
    for (let i = idx - 1; i >= 0; i--) { if (h[i].role === 'user') { q = h[i].content; break; } }
    if (!q) { toast('找不到原来的问题了'); return; }
    m.fb = { v: 'bad', reason: '重新生成', replaced: true, ts: now() };
    saveHist(h.slice(0, idx));   // 去掉旧回答（含标记）
    renderMsgs();
    send(q, { noPushUser: true });
  }

  function bind() {
    const input = $('#chat-input');
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    if (!coarse) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(input.value); input.value = ''; input.style.height = 'auto'; }
      });
    }
    $('#chat-send').addEventListener('click', () => { send(input.value); input.value = ''; input.style.height = 'auto'; input.focus(); });
    $('#chat-chips').addEventListener('click', (ev) => {
      const c = ev.target.closest('.chip');
      if (c && !c.hasAttribute('data-reason')) send(c.getAttribute('data-q'));
    });

    /* 评价条事件（委托）：点当前已选 = 取消；点另一个 = 切换；差评弹原因面板 */
    $('#chat-msgs').addEventListener('click', async (ev) => {
      const good = ev.target.closest('[data-fb="good"]');
      const bad = ev.target.closest('[data-fb="bad"]');
      if (good) { feedback(Number(good.getAttribute('data-idx')), 'good'); return; }
      if (bad) {
        const idx = Number(bad.getAttribute('data-idx'));
        const m = hist()[idx];
        if (m && m.fb && m.fb.v === 'bad') { feedback(idx, 'bad'); return; } // 再点一次 = 取消差评并撤法则
        const item = bad.closest('.msg');
        const old = item.querySelector('.fb-panel');
        if (old) { old.remove(); return; }
        $$('.fb-panel').forEach(p => p.remove());
        item.insertAdjacentHTML('beforeend', reasonPanelHtml(idx));
        item.scrollIntoView({ block: 'end' });
        return;
      }
      const reason = ev.target.closest('[data-reason]');
      if (reason) {
        reason.classList.toggle('on');
        const panel = reason.closest('.fb-panel');
        panel.querySelector('[data-fb-ok]').disabled = !panel.querySelector('.chip.on');
        return;
      }
      const cancel = ev.target.closest('[data-fb-cancel]');
      if (cancel) { const p = cancel.closest('.fb-panel'); if (p) p.remove(); return; }
      const okBtn = ev.target.closest('[data-fb-ok]');
      if (okBtn && !okBtn.disabled) {
        const panel = okBtn.closest('.fb-panel');
        const idx = Number(okBtn.getAttribute('data-fb-ok'));
        const reason = Array.from(panel.querySelectorAll('.chip.on')).map(c => c.getAttribute('data-reason')).join('、').slice(0, 60);
        const note = (panel.querySelector('.fb-note') || {}).value || '';
        panel.remove();
        feedbackConfirm(idx, reason, note);
      }
      const cp = ev.target.closest('[data-copy]');
      if (cp) {
        const idx = Number(cp.getAttribute('data-copy'));
        const text = String((hist()[idx] || {}).content || '');
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
          .then(() => toast('已复制全文'))
          .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); ta.remove();
            toast('已复制全文');
          });
        return;
      }
      const rg = ev.target.closest('[data-regen]');
      if (rg) { regenerate(Number(rg.getAttribute('data-regen'))); return; }
    });

    /* 回到底部悬浮钮：离底部远时出现 */
    const wrapEl = $('#chat-msgs');
    const tb = $('#to-bottom');
    wrapEl.addEventListener('scroll', () => {
      const far = wrapEl.scrollHeight - wrapEl.scrollTop - wrapEl.clientHeight > 300;
      tb.classList.toggle('hidden', !far);
    });
    tb.addEventListener('click', () => { wrapEl.scrollTop = wrapEl.scrollHeight; tb.classList.add('hidden'); });
  }

  return { renderMsgs, send, bind, hist, reviewNow, meta };
})();

/* ===== 我的页 ===== */
const Me = (() => {
  function renderCode() {
    const el = $('#me-code');
    if (el) el.textContent = State.s.syncCode || '未生成';
  }

  function fillModelSelect() {
    const sel = $('#me-model');
    if (!sel) return;
    const models = loadLS(LS.models, []);
    const cur = State.s.model;
    sel.innerHTML = models.map(m =>
      `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  }

  async function refreshModels(silent) {
    try {
      const j = await Sync.request('ai.models', {}, 30000);
      const list = (j.models || []).map(m => ({ id: m.id, label: m.label || m.id }));
      if (!list.length) throw new Error('模型列表为空');
      saveLS(LS.models, list);
      if (!State.s.model && list[0]) { State.s.model = list[0].id; State.save(); }
      fillModelSelect();
      if (!silent) toast('已更新模型列表（' + list.length + ' 款）');
    } catch (e) {
      if (!silent) toast('拉取失败：' + e.message);
    }
  }

  function exportBackup() {
    const data = {
      app: 'wenshi', v: 3, ts: now(),
      sessions: loadLS('ws_sessions', []), cur: Sessions.curId(),
      kb: loadLS(LS.kb, []),
      mem: loadLS(LS.mem, { profile: '', ts: 0 }),
      rules: loadLS(LS.rules, []), meta: loadLS(LS.meta, { rounds: 0 }),
      settings: { model: State.s.model, digestOn: State.s.digestOn, kbOn: State.s.kbOn },
    };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    a.download = `问史备份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function importBackup(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { toast('文件不是有效备份'); return; }
    if (!j || j.app !== 'wenshi') { toast('不是问史的备份文件'); return; }
    if (Array.isArray(j.kb)) KB.add(j.kb.map(e => ({ ...e, id: e.id || uid() })));
    if (Array.isArray(j.sessions) && j.sessions.length) {
      saveLS('ws_sessions', j.sessions);
      State.s.curSession = j.cur || j.sessions[0].id;
      State.save();
    } else if (Array.isArray(j.hist) && j.hist.length) {
      // 兼容旧版备份：单聊天记录 → 转成一个会话
      const firstQ = j.hist.find(m => m.role === 'user');
      const id = uid();
      saveLS('ws_sessions', [{ id, title: String((firstQ && firstQ.content) || '导入的对话').slice(0, 16), ts: now(), msgs: j.hist }]);
      State.s.curSession = id;
      State.save();
    }
    if (j.mem && j.mem.profile) Mem.set(j.mem.profile);
    if (Array.isArray(j.rules)) { saveLS(LS.rules, j.rules.map(r => (typeof r === 'string' ? { id: uid(), text: r, src: 'fb', ts: now() } : { ...r, id: r.id || uid() }))); Sync.markDirty('rules'); }
    if (j.meta && j.meta.rounds) saveLS(LS.meta, j.meta);
    if (j.settings) {
      if (j.settings.model) { State.s.model = j.settings.model; }
      if (typeof j.settings.digestOn === 'boolean') State.s.digestOn = j.settings.digestOn;
      if (typeof j.settings.kbOn === 'boolean') State.s.kbOn = j.settings.kbOn;
      State.save();
    }
    Chat.renderMsgs(); KB.render(); fillSettings();
    toast('导入完成');
  }

  function fillSettings() {
    $('#me-digest-on').checked = !!State.s.digestOn;
    $('#me-kb-on').checked = !!State.s.kbOn;
    $('#me-sync-on').checked = !!State.s.syncOn;
    $('#me-hist-count').textContent = Chat.hist().length + ' 条';
    fillModelSelect();
    renderRules();
  }

  function renderRules() {
    const wrap = $('#rules-list');
    if (!wrap) return;
    const rules = Rules.all();
    const mt = Chat.meta();
    const nextAt = (Math.floor((mt.rounds || 0) / 20) + 1) * 20;
    $('#rules-count').textContent = rules.length + ' 条 · 第 ' + (mt.rounds || 0) + ' 轮（每 ' + nextAt + ' 轮自动复盘）';
    wrap.innerHTML = rules.length
      ? rules.map(r => `
        <div class="rule-item">
          <div class="rule-text">${esc(r.text)}</div>
          <button class="kb-del" data-rule-del="${esc(r.id)}">删除</button>
        </div>`).join('')
      : '<div class="tip">还没有法则。在问答页给回答点「没用」，AI 就会生成一条永久记住的教训。</div>';
  }

  async function manualReview() {
    if (!Rules.all().length && !Chat.hist().length) { toast('先聊几轮再来复盘'); return; }
    toast('AI 正在复盘…');
    try { await Chat.reviewNow(false); } catch (e) { toast('复盘失败：' + e.message); }
  }

  /* 安卓壳自更新：壳内检查远端版本（Java 侧后台线程拉取，这里轮询结果，不阻塞） */
  async function checkApkUpdate(manual) {
    const shell = window.wsShell;
    if (!shell || !shell.apkVer) {
      if (manual) toast('网页版永远自动最新，无需更新');
      return;
    }
    const local = String(shell.apkVer() || '');
    let remote = '';
    try { remote = String(shell.getRemoteApkVer() || ''); } catch (e) { /* 离线 */ }
    if (!remote) {
      for (let i = 0; i < 6 && !remote; i++) {      // 后台线程最多等 ~9s
        await new Promise(r => setTimeout(r, 1500));
        try { remote = String(shell.getRemoteApkVer() || ''); } catch (e) { break; }
      }
    }
    const bar = $('#apk-update-bar');
    if (remote && local && remote !== local) {
      if (bar) {
        bar.classList.remove('hidden');
        bar.textContent = '安卓壳有新版（' + remote + '），当前 ' + local + '，点此更新';
        bar.onclick = () => { try { shell.updateNow(); } catch (e) { toast('无法启动更新：' + e.message); } };
      }
      if (manual) toast('发现安卓新版 ' + remote + '，点底部提示条更新');
    } else {
      if (bar) bar.classList.add('hidden');
      if (manual) toast(remote ? '安卓壳已是最新（' + local + '）' : '检查失败：网络问题');
    }
  }

  function openCodeModal() {
    $('#modal-code-input').value = '';
    $('#modal-code').classList.remove('hidden');
    $('#modal-code-input').focus();
  }

  function bind() {
    $('#me-code-copy').addEventListener('click', async () => {
      if (!State.s.syncCode) { toast('还没生成同步码'); return; }
      try { await navigator.clipboard.writeText(State.s.syncCode); toast('已复制'); }
      catch (e) {
        const inp = document.createElement('input');
        inp.value = State.s.syncCode; document.body.appendChild(inp);
        inp.select(); document.execCommand('copy'); inp.remove();
        toast('已复制');
      }
    });
    $('#me-sync-on').addEventListener('change', (ev) => {
      State.s.syncOn = ev.target.checked;
      State.save();
      if (State.s.syncOn) { Sync.ensureCode().then(() => Sync.pushAll(true)); }
    });
    $('#me-backup').addEventListener('click', async () => {
      if (!State.s.syncCode) { await Sync.ensureCode(); }
      if (!State.s.syncCode) { toast('网络不可用'); return; }
      toast('备份中…');
      Sync.pushAll(true);
    });
    $('#me-restore').addEventListener('click', () => openCodeModal());
    $('#modal-code-cancel').addEventListener('click', () => $('#modal-code').classList.add('hidden'));
    $('#modal-code-ok').addEventListener('click', async () => {
      const code = $('#modal-code-input').value.trim().toUpperCase();
      let old = State.s.syncCode;
      try {
        State.s.syncCode = code;    // 临时用目标码请求
        const n = await Sync.restore(code);
        toast(n ? '恢复完成' : '云端没有数据');
        $('#modal-code').classList.add('hidden');
        renderCode(); fillSettings(); Chat.renderMsgs(); KB.render();
      } catch (e) {
        State.s.syncCode = old;
        toast('恢复失败：' + e.message);
      }
    });
    $('#me-model').addEventListener('change', (ev) => { State.s.model = ev.target.value; State.save(); Sync.markDirty('settings'); });
    $('#me-models-refresh').addEventListener('click', () => refreshModels(false));
    $('#me-digest-on').addEventListener('change', (ev) => { State.s.digestOn = ev.target.checked; State.save(); Sync.markDirty('settings'); });
    $('#me-kb-on').addEventListener('change', (ev) => { State.s.kbOn = ev.target.checked; State.save(); Sync.markDirty('settings'); });
    $('#me-hist-clear').addEventListener('click', () => {
      if (!confirm('清空全部对话记录？此操作不可撤销（云端备份也会在下次同步时覆盖）')) return;
      Sessions.clearAll();
      Chat.renderMsgs(); fillSettings(); toast('已清空');
    });
    $('#rules-list').addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-rule-del]');
      if (del) { Rules.remove(del.getAttribute('data-rule-del')); renderRules(); toast('已删除'); }
    });
    $('#me-review').addEventListener('click', manualReview);
    $('#me-checkupd').addEventListener('click', () => checkApkUpdate(true));
    $('#me-export').addEventListener('click', exportBackup);
    $('#me-import').addEventListener('click', () => $('#me-import-file').click());
    $('#me-import-file').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      try { importBackup(await f.text()); } catch (e) { toast('读取失败'); }
    });
  }

  return { bind, fillSettings, renderCode, refreshModels, fillModelSelect, renderRules, checkApkUpdate };
})();

/* ===== 历史对话面板 ===== */
const SessPanel = (() => {
  function render() {
    const list = Sessions.all();
    $('#sess-count').textContent = list.length + ' 个';
    $('#sess-list').innerHTML = list.length
      ? list.map(s => `
        <div class="sess-item ${s.id === Sessions.curId() ? 'on' : ''}" data-sess="${esc(s.id)}">
          <div class="sess-title">${esc(s.title || '新对话')}</div>
          <div class="sess-meta">${(s.msgs || []).length} 条 · ${fmtTs(s.ts || 0)}</div>
          <button class="kb-del" data-sess-del="${esc(s.id)}">删除</button>
        </div>`).join('')
      : '<div class="tip">还没有历史对话</div>';
  }
  function open() { render(); $('#modal-sess').classList.remove('hidden'); }
  function close() { $('#modal-sess').classList.add('hidden'); }
  function bind() {
    $('#btn-sessions').addEventListener('click', open);
    $('#btn-newchat').addEventListener('click', () => {
      Sessions.newOne();
      Chat.renderMsgs();
      toast('已开启新对话');
    });
    $('#sess-new').addEventListener('click', () => {
      Sessions.newOne();
      Chat.renderMsgs();
      close();
    });
    $('#sess-list').addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-sess-del]');
      if (del) {
        ev.stopPropagation();
        if (!confirm('删除该对话？不可恢复')) return;
        Sessions.remove(del.getAttribute('data-sess-del'));
        render();
        Chat.renderMsgs();
        return;
      }
      const item = ev.target.closest('[data-sess]');
      if (item) {
        Sessions.switchTo(item.getAttribute('data-sess'));
        close();
        Chat.renderMsgs();
        const w = $('#chat-msgs'); if (w) w.scrollTop = w.scrollHeight;
      }
    });
  }
  return { bind, open, close };
})();

/* ===== 视图切换 ===== */
function nav(view) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  $$('#tabbar .tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-nav') === view));
  if (view === 'kb') KB.render();
  if (view === 'me') Me.fillSettings();
}

/* ===== 启动 ===== */
async function boot() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-nav]');
    if (t) nav(t.getAttribute('data-nav'));
  });
  Chat.bind(); KB.bind(); Me.bind(); SessPanel.bind();
  Me.fillSettings(); Me.renderCode();
  Chat.renderMsgs(); KB.render();
  nav('chat');
  /* 打开即定位到最新消息（底部），不在历史顶部 */
  { const w = $('#chat-msgs'); if (w) w.scrollTop = w.scrollHeight; }

  /* 运行环境标识：一眼分清是安卓壳还是浏览器网页版 */
  try {
    const shell = window.wsShell;
    $('#env-line').textContent = (shell && shell.apkVer && shell.apkVer())
      ? '安卓 App（壳 ' + shell.apkVer() + '）'
      : '浏览器网页版（推荐安装安卓 App）';
  } catch (e) { /* 忽略 */ }

  Sync.init();
  Me.refreshModels(true);
  if (!loadLS(LS.models, []).length) setTimeout(() => Me.refreshModels(true), 4000);
  setTimeout(() => Me.checkApkUpdate(), 3000);   // 启动后再查版本，避免抢首屏

  /* 版本显示 + 更新弹窗（网页版有新版时醒目提醒一次；壳环境用壳版本号） */
  try {
    const shell = window.wsShell;
    const el = $('#ver-line');
    if (shell && shell.apkVer) {
      if (el) el.textContent = '壳 ' + shell.apkVer();
    } else {
      const r = await fetch('./version.json', { cache: 'no-cache' });
      const v = await r.json();
      if (el && v && v.v) el.textContent = v.v;
      if (v && v.v) {
        const seen = localStorage.getItem(LS.seenVer);
        if (seen && seen !== v.v) {
          const vt = $('#modal-ver-text');
          if (vt) vt.innerHTML = '已更新到 <b>' + esc(v.v) + '</b>' + (v.t ? '（' + esc(v.t) + '）' : '') + '。<br>新版功能已生效；若界面没变化，把应用完全关闭再打开一次。';
          const mv = $('#modal-ver');
          if (mv) mv.classList.remove('hidden');
        }
        localStorage.setItem(LS.seenVer, v.v);
      }
    }
  } catch (e) { /* 离线 */ }
  $('#modal-ver-ok').addEventListener('click', () => $('#modal-ver').classList.add('hidden'));

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
document.addEventListener('DOMContentLoaded', boot);
