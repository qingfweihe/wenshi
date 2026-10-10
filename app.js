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

/* 会话标题：原先直接截首问前 16 字，经常断在句子中间
   （"一句话回答：中华人民共和国哪年成"、"详细讲讲唐朝从安史之乱到灭亡的历史脉络"）。
   这里先剥掉口头语前缀，再优先在自然停顿处断开，读起来才像个"话题"。
   标题栏本身还有省略号兜底，所以长度略超不会溢出。 */
const TITLE_PREFIX = /^(一句话回答|一句话|用大白话讲一讲|用大白话讲讲|用大白话讲|大白话讲|详细讲讲|详细说说|详细讲|简单讲讲|简单说说|简单讲|讲一讲|讲一下|说说|说一下|我想知道|想请教|想问问|请问|问一下|帮我|麻烦|你觉得|你认为|大家觉得|如何看待|怎么看待)[，,：:、\s]*/;
function cleanTitle(raw) {
  const src = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!src) return '';
  let s = src.replace(TITLE_PREFIX, '').trim();
  if (!s) s = src;                                  // 全被剥光就退回原文
  /* 1) 有句末标点且位置合适 → 就断在那 */
  const hard = s.search(/[。！？；!?;\n]/);
  if (hard >= 4 && hard <= 20) {
    s = s.slice(0, hard);
  } else {
    /* 2) 取 [6,20] 内最靠后的自然停顿（逗号/顿号/冒号） */
    let cut = -1;
    for (let i = 6; i <= Math.min(20, s.length - 1); i++) if ('，,、：:'.includes(s[i])) cut = i;
    if (cut >= 6) s = s.slice(0, cut);
    else { s = s.slice(0, 16); if (src.length > 16) s += '…'; }   // 3) 实在没有停顿才硬截
  }
  s = s.replace(/[，,、：:；;。\s]+$/, '').trim();
  return (s || src.slice(0, 16)).slice(0, 24);
}

/* 显示用标题：把"旧式截前16字"的标题现算成可读标题。
   放在显示层而不是只做一次性迁移，是为了让**任何来源**的数据都能立刻正确显示 ——
   恢复/导入进来的会话是启动之后才落地的，只靠启动迁移会漏掉它们。
   手动改过名的标题对不上旧式样，原样保留。 */
function displayTitle(s) {
  if (!s) return '新对话';
  const firstQ = (s.msgs || []).find(m => m && m.role === 'user' && m.content);
  if (!s.title) return (firstQ && cleanTitle(firstQ.content)) || '新对话';
  if (firstQ && s.title === String(firstQ.content).slice(0, 16)) {
    return cleanTitle(firstQ.content) || s.title;
  }
  return s.title;
}
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2200);
}
/* 轻量 markdown：先整体转义（防 XSS），再逐行转换；模型偶尔输出 HTML 标签，先归一化。
   支持：粗体 / 斜体 / 删除线 / 行内代码 / 围栏代码块 / 标题 / 有序无序列表 / 表格 / 引用 / 链接 / 分隔线。
   链接只放行 http(s)，防 javascript: / data: 注入；代码块内容单独转义，不参与其它语法解析。 */
function mdLite(raw) {
  const norm = String(raw || '')
    .replace(/<b\s*>/gi, '**').replace(/<\/b\s*>/gi, '**')
    .replace(/<strong\s*>/gi, '**').replace(/<\/strong\s*>/gi, '**')
    .replace(/<br\s*\/?>/gi, '\n');

  /* 1) 围栏代码块整段摘出为占位符，避免块内 md 语法被误转换 */
  const codes = [];
  const src = norm.replace(/```[ \t]*([\w+#.:-]*)[ \t]*\n?([\s\S]*?)```/g, (m, lang, code) => {
    codes.push({ lang: String(lang || '').trim(), code: String(code).replace(/\n+$/, '') });
    return '\u0001C' + (codes.length - 1) + '\u0001';
  });

  /* 2) 行内语法（入参必须是已转义文本） */
  const inline = (s) => String(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
    .replace(/(^|[\s（(【])\*([^*\n]+?)\*(?=$|[\s，。；：！？、）)】])/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const isSep = (s) => /^[\s|:-]+$/.test(s) && /-/.test(s);
  const lines = src.split(/\r?\n/);
  let out = '', inOl = false;
  const closeOl = () => { if (inOl) { out += '</div>'; inOl = false; } };

  for (let i = 0; i < lines.length; i++) {
    const rawLn = lines[i];

    /* 代码块占位符 */
    const ph = rawLn.trim().match(/^\u0001C(\d+)\u0001$/);
    if (ph) {
      closeOl();
      const c = codes[Number(ph[1])] || { code: '', lang: '' };
      out += '<pre class="md-pre"' + (c.lang ? ' data-lang="' + esc(c.lang) + '"' : '') + '><code>' + esc(c.code) + '</code></pre>';
      continue;
    }

    /* 表格：本行含 |，且下一行是 |---| 分隔行 */
    if (rawLn.indexOf('|') >= 0 && i + 1 < lines.length && isSep(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => inline(esc(c.trim())));
      const head = cells(rawLn);
      i++;                                   // 吃掉分隔行
      let body = '';
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].indexOf('|') >= 0) {
        i++;
        const cs = cells(lines[i]);
        body += '<tr>' + head.map((_, k) => '<td>' + (cs[k] == null ? '' : cs[k]) + '</td>').join('') + '</tr>';
      }
      closeOl();
      out += '<div class="md-tbl-wrap"><table class="md-tbl"><thead><tr>'
        + head.map(h => '<th>' + h + '</th>').join('')
        + '</tr></thead><tbody>' + body + '</tbody></table></div>';
      continue;
    }

    const ln = inline(esc(rawLn));
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(ln)) { closeOl(); out += '<hr>'; continue; }
    const h = ln.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { closeOl(); out += `<span class="md-h${h[1].length}"><b>${h[2]}</b></span><br>`; continue; }
    const ol = ln.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ol) { if (!inOl) { out += '<div class="md-ol">'; inOl = true; } out += `<div class="md-oli">${ol[1]}</div>`; continue; }
    closeOl();
    const bq = ln.match(/^\s*&gt;\s?(.*)$/);
    if (bq) { out += `<div class="md-quote">${bq[1]}</div>`; continue; }
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
  noStream: 'ws_nostream',   // 逃生开关：置 1 则永久退回非流式（不改代码即可回滚）
  nosum: 'ws_nosum',         // 逃生开关：置 1 则关闭 S3 滚动摘要（earlier 退回旧问题清单）
  jsonBody: 'ws_jsonbody',   // 逃生开关：置 1 则请求体退回 application/json（备用）
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
    syncCode: '', syncOn: true, model: '', digestOn: true, kbOn: true, rememberOn: true,
    curSession: '', pwMode: false,
  },
  save() { saveLS(LS.state, this.s); },
};

/* 新增状态字段的补全（老用户的 state 里没有这些键，只在内存里补是隐性的）
   为什么必须落地：所有判断都写 `!== false`，行为上等价于 true，但字段本身是 undefined 会被
   原样带进 settings 域同步（JSON.stringify 直接丢键），留下一个长期悬空的字段；
   日后谁写 `if (State.s.rememberOn)` 就会踩坑。
   只增键、绝不删改任何已有值；已是最新格式时不会触发写入。
   2026-10-08 由 upgradeprobe.cjs 实测发现。 */
if (!State.s || typeof State.s !== 'object') State.s = {};
if (typeof State.s.rememberOn !== 'boolean') { State.s.rememberOn = true; State.save(); }

/* ---- 一次性迁移：旧的单聊天记录 → 多会话结构 ---- */
(function migrateHist() {
  if (localStorage.getItem('ws_sessions') !== null) return;   // 键存在（哪怕是 []）就不再迁移
  const old = loadLS('ws_hist', []);
  if (Array.isArray(old) && old.length) {
    const firstQ = old.find(m => m.role === 'user');
    const id = uid();
    saveLS('ws_sessions', [{ id, title: cleanTitle((firstQ && firstQ.content) || '') || '历史对话', ts: now(), msgs: old }]);
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
      if (firstQ) list[i].title = cleanTitle(firstQ.content);
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
  /* 重命名 / 置顶（置顶排前）/ 导出单条对话 */
  function rename(id, title) {
    const list = all();
    const i = list.findIndex(s => s.id === id);
    if (i < 0) return;
    const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (t) list[i].title = t;
    saveAll(list);
  }
  function setPinned(id, v) {
    const list = all();
    const i = list.findIndex(s => s.id === id);
    if (i < 0) return;
    list[i].pinned = !!v;
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
    saveAll(list);
  }
  function exportMd(id) {
    const s = all().find(x => x.id === id);
    if (!s) return null;
    const lines = ['# ' + displayTitle(s), '', '导出时间：' + new Date().toLocaleString('zh-CN'), ''];
    for (const m of (s.msgs || [])) {
      lines.push(m.role === 'user' ? '**我：**' : '**问史：**', '', String(m.content || ''), '');
    }
    return {
      name: String(displayTitle(s) || 'wenshi-history').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) + '.md',
      text: lines.join('\n'),
    };
  }
  /* 一次性升级：把早期"直接截前 16 字"的标题换成可读标题。
     只动"当前标题恰好等于旧式样"的会话 —— 手动改过名的对不上，不会被覆盖。 */
  function migrateTitles() {
    const list = all();
    let n = 0;
    for (const s of list) {
      const firstQ = (s.msgs || []).find(m => m && m.role === 'user' && m.content);
      if (!firstQ) continue;
      const legacy = String(firstQ.content).slice(0, 16);
      if (s.title && s.title === legacy) {
        const t = cleanTitle(firstQ.content);
        if (t && t !== s.title) { s.title = t; n++; }
      } else if (!s.title) {
        const t = cleanTitle(firstQ.content);
        if (t) { s.title = t; n++; }
      }
    }
    if (n) saveAll(list);
    return n;
  }
  /* S3：写入/清除某会话的滚动摘要。**按 id 定位**——压缩是异步的，await 期间
     用户可能已经切了会话；只动 sum 一个字段，messages/标题/置顶一概不碰。 */
  function setSum(id, sum) {
    if (!id) return false;
    const list = all();
    const i = list.findIndex(s => s.id === id);
    if (i < 0) return false;
    if (sum) list[i].sum = sum; else delete list[i].sum;
    saveAll(list);
    return true;
  }
  return { all, cur, curMsgs, ensure, put, switchTo, remove, newOne, clearAll, curId, invalidate, rename, setPinned, exportMd, migrateTitles, setSum };
})();

/* ===== 云端同步（照搬 vocab-flash 模式：裸 fetch + action 协议） ===== */
const API_DEFAULT = 'https://qinfweihe1-d5gxpjjli9f8f238b.service.tcloudbase.com/wsapi';
/* 流式接口（方案 A）：独立的 HTTP 云函数 wsstream，只承接 ai.chat 的 SSE 流式输出。
   实测两个默认域名（service / 网关 app.<env>.<region>.app）都能路由本路径，
   故默认与 API_DEFAULT 同域名，仅把 /wsapi 换成 /wsstream；自定义 api 时按同规则替换。 */
const API_STREAM_DEFAULT = 'https://qinfweihe1-d5gxpjjli9f8f238b.service.tcloudbase.com/wsstream';
function streamApiOf(base) {
  const b = String(base || '').trim();
  if (!b) return API_STREAM_DEFAULT;
  if (/\/wsapi\/?$/.test(b)) return b.replace(/\/wsapi\/?$/, '/wsstream');
  return b.replace(/\/+$/, '') + '/wsstream';
}
/* 云端只备份轻量数据；知识库(kb)只存本地（用户要求，云端容量有限），靠导出文件迁移 */
/* 云同步数据域。kb（知识库）原先只存本地，但重装/换机必丢且体量最大，故已并入云备份。
   改动需与服务端 wsapi/index.js 的 DOMAINS 保持一致。 */
const DOMAINS = ['hist', 'mem', 'settings', 'rules', 'kb'];
const PUSH_DELAY = 30 * 1000;

/* ---- 单域请求体预算（两道上限都要守）----
   ① 服务端自检 MAX_STATE_CHARS = 256K **字符**（wsapi/index.js）→ 超了回 TOO_BIG（可读）；
   ② 网关请求体上限：**application/json 只有 100KB 字节**，text/plain 实测约 3MB。
      超限由网关直接 413，**该响应不带 CORS 头** → 浏览器只能抛 TypeError
      （WebKit 文案正是 "Load failed"）→ 前端会误报「网络不可用」。详见 2026-10-10 分析。
   故取 240K 字符（给服务端留余量）+ 3MB 字节（正常永远触发不到，是防平台收回 text/plain 的兜底）。
   SAFE 档用于「疑似撞了网关包体上限」时的自动重发。 */
const DOMAIN_CHAR_CAP = 240 * 1024;
const DOMAIN_BYTE_CAP = 3 * 1024 * 1024;
const DOMAIN_BYTE_CAP_SAFE = 96 * 1024;   // 比 102400 留 4KB 给信封，退回 json 也安全

/* UTF-8 字节数。TextEncoder 优先；老环境手算兜底（中文 3 字节、代理对 4 字节）。 */
function utf8Len(s) {
  if (typeof TextEncoder !== 'undefined') {
    try { return new TextEncoder().encode(s).length; } catch (e) { /* 落到手算 */ }
  }
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const Sync = (() => {
  const api = () => (localStorage.getItem(LS.api) || API_DEFAULT).trim() || API_DEFAULT;
  const streamApi = () => streamApiOf(api());

  /* 请求体 Content-Type（A 项修复）。
     CloudBase 对事件型云函数的「文本类型请求体」硬上限是 **100KB**，而 application/json
     被判为文本类型 → 备份包一超 100KB 就被网关 413 拦下；该 413 **不带 CORS 头**，
     浏览器只能抛 TypeError（WebKit 文案正是 "Load failed"），前端因而误报「网络不可用」。
     实测 text/plain 可到 ~3MB（约 30 倍余量），且它是 CORS 安全列表类型 → 连预检都不必发。
     服务端 event.body + JSON.parse 原样可用，无需任何改动。
     ws_jsonbody=1 可退回 application/json（不改代码的逃生开关）。 */
  const CT = () => (loadLS(LS.jsonBody, false) ? 'application/json' : 'text/plain;charset=UTF-8');

  async function rawRequest(action, payload, timeoutMs, externalSignal) {
    const body = { action, code: State.s.syncCode || '', ...(payload || {}) };
    const ctl = new AbortController();
    let byUser = false;
    const onAbort = () => { byUser = true; ctl.abort(); };
    if (externalSignal) {
      if (externalSignal.aborted) { byUser = true; ctl.abort(); }
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    let res;
    try {
      res = await fetch(api(), {
        method: 'POST',
        headers: { 'Content-Type': CT() },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error(byUser ? '已停止' : '请求超时');
        err.abortedByUser = byUser;
        err.timeout = !byUser;
        throw err;
      }
      const err = new Error('网络不可用：' + ((e && e.message) || '连接失败'));
      err.network = true;
      throw err;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
    /* 网关「请求体超限」的原文又长又是英文，翻成能照着行动的提示 */
    const humanize = (msg) => {
      const s = String(msg || '');
      if (/EXCEED_MAX_PAYLOAD_SIZE|max payload size/i.test(s)) {
        return '数据包超过云端网关上限（单次请求 100KB），本次已跳过';
      }
      return s;
    };
    let j = null;
    try { j = await res.json(); }
    catch (e) {
      const err = new Error(res.status === 413
        ? '数据包超过云端网关上限（单次请求 100KB），本次已跳过'
        : '服务返回异常(' + res.status + ')');
      err.network = res.status >= 500;
      err.status = res.status;
      err.tooBig = res.status === 413;      // 备注：网关 413 通常不带 CORS 头，浏览器里到不了这一步
      throw err;
    }
    if (!j || j.ok !== true) {
      const raw = (j && j.message) || ('HTTP ' + res.status);
      const err = new Error(humanize(raw));
      err.code = j && j.error;
      err.status = res.status;
      err.tooBig = res.status === 413 || err.code === 'TOO_BIG' || /payload size/i.test(raw);
      throw err;
    }
    return j;
  }

  /* 网络类错误自动重试（指数退避）；业务错误（LIMIT / AI_AUTH / BAD_CODE…）不重试 */
  const RETRYABLE = new Set(['AI_UPSTREAM', 'AI_EMPTY', 'READ_ERR', 'NO_USER']);
  async function request(action, payload, timeoutMs, opts) {
    const o = opts || {};
    const tries = o.retries == null ? 0 : o.retries;
    let lastErr = null;
    for (let i = 0; i <= tries; i++) {
      try {
        return await rawRequest(action, payload, timeoutMs, o.signal);
      } catch (e) {
        lastErr = e;
        if (e.abortedByUser || e.timeout) throw e;
        const retryable = e.network === true || (e.code && RETRYABLE.has(e.code)) || (!e.code && e.status >= 500);
        if (!retryable || i === tries) throw e;
        if (o.onRetry) o.onRetry(i + 1);
        await new Promise(r => setTimeout(r, 700 * Math.pow(2, i)));
      }
    }
    throw lastErr;
  }

  /* ---- 流式 ai.chat（方案 A）----
     与 request 的差异：这里是「边收边用」，不能等整包；也不做自动重试——
     流式一旦开始吐字，重试会导致内容重复。调用方需自行决定降级策略。
     事件协议（服务端定义）：
       {"type":"start","model":..} / {"type":"delta","text":..} /
       {"type":"end","left":..,"model":..,"chars":..} / {"type":"error","error":..,"message":..}
     抛出：e.noStream=true 表示环境不支持流式读（调用方应永久降级）；
           e.code 为业务错误码（与 wsapi 契约一致）；e.abortedByUser 为用户点了停止。 */
  async function streamChat(payload, opts) {
    const o = opts || {};
    const body = { action: 'ai.chat', code: State.s.syncCode || '', ...(payload || {}) };
    let res;
    try {
      res = await fetch(streamApi(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: o.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('已停止'); err.abortedByUser = true; throw err;
      }
      const err = new Error('网络不可用：' + ((e && e.message) || '连接失败'));
      err.network = true; throw err;
    }
    const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
    if (!res.ok || ct.indexOf('text/event-stream') < 0) {
      /* 前置错误（未开始流式）：服务端返回普通 JSON，错误码契约与 wsapi 一致 */
      let j = null; try { j = await res.json(); } catch (e) { /* 非 JSON */ }
      const err = new Error((j && j.message) || ('HTTP ' + res.status));
      err.code = j && j.error;
      err.status = res.status;
      err.network = res.status >= 500;
      throw err;
    }
    if (!res.body || typeof res.body.getReader !== 'function' || typeof TextDecoder === 'undefined') {
      const err = new Error('当前环境不支持流式读取'); err.noStream = true; throw err;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '', text = '', model = '', left = null, evErr = null;
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); }
      catch (e) {
        if (o.signal && o.signal.aborted) { const err = new Error('已停止'); err.abortedByUser = true; throw err; }
        throw e;
      }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.slice(0, 6) !== 'data: ') continue;
        const s = line.slice(6).trim();
        if (!s) continue;
        let ev = null; try { ev = JSON.parse(s); } catch (e) { continue; }
        if (ev.type === 'delta' && ev.text) {
          text += ev.text;
          if (o.onDelta) o.onDelta(ev.text);
        } else if (ev.type === 'start') {
          model = ev.model || '';
        } else if (ev.type === 'end') {
          if (ev.model) model = ev.model;
          if (typeof ev.left === 'number') left = ev.left;
        } else if (ev.type === 'error') {
          evErr = ev;
        }
      }
    }
    if (evErr && !text) {
      const err = new Error(evErr.message || '流式中断');
      err.code = evErr.error || 'AI_UPSTREAM';
      throw err;
    }
    return { text, left, model, partial: !!evErr };
  }

  /* ---- 域数据快照（C 项：按预算装箱，超了如实告知）----
     返回 { data, s, bytes, truncated }：
       s = data 的 JSON 串（供 djb2 比对，避免重复 stringify）；
       truncated = 本次为了塞进预算而少传了东西 —— 界面必须说出来，
       否则用户会以为「备份是完整的」，那比报错更危险。 */
  function snapshot(domain, opts) {
    const o = opts || {};
    const maxChars = o.maxChars || DOMAIN_CHAR_CAP;
    const maxBytes = o.maxBytes || DOMAIN_BYTE_CAP;

    if (domain === 'hist') {
      /* 会话按「新→旧」装箱，装不下的旧会话**只留在本地**。
         merge 是并集、导出备份也不受影响，所以「少传」不会删掉任何东西。 */
      const all = loadLS('ws_sessions', []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const cur = Sessions.curId();
      const base = JSON.stringify({ sessions: [], cur });
      let chars = base.length, bytes = utf8Len(base);
      const out = [];
      let truncated = false;
      for (const sess of all) {
        const one = JSON.stringify(sess);
        const c = one.length + (out.length ? 1 : 0);      // 数组元素间的逗号
        const b = utf8Len(one) + (out.length ? 1 : 0);
        if (chars + c > maxChars || bytes + b > maxBytes) { truncated = true; break; }
        out.push(sess); chars += c; bytes += b;
      }
      /* 连最新一条都装不下（单会话体量过大）：只留它最近几条消息。
         更早的内容本来就在 S3 滚动摘要里，不会全丢。 */
      if (!out.length && all.length) {
        const first = all[0];
        const msgs = Array.isArray(first.msgs) ? first.msgs : [];
        let keep = 0;
        for (let n = msgs.length; n >= 1; n--) {
          const t = JSON.stringify({ sessions: [{ ...first, msgs: msgs.slice(-n) }], cur });
          if (t.length <= maxChars && utf8Len(t) <= maxBytes) { keep = n; break; }
        }
        out.push({ ...first, msgs: msgs.slice(-keep) });
        truncated = true;
      }
      const data = { sessions: out, cur };
      const s = JSON.stringify(data);
      return { data, s, bytes: utf8Len(s), truncated };
    }

    if (domain === 'kb') {
      /* 知识库按「新条目优先」装箱，同样守双预算。 */
      const all = loadLS(LS.kb, []);
      const out = [];
      let chars = 2, bytes = 2;                            // "[]"
      let truncated = false;
      for (const e of all) {
        const one = JSON.stringify(e);
        const c = one.length + (out.length ? 1 : 0);
        const b = utf8Len(one) + (out.length ? 1 : 0);
        if (chars + c > maxChars || bytes + b > maxBytes) { truncated = true; break; }
        out.push(e); chars += c; bytes += b;
      }
      const s = JSON.stringify(out);
      return { data: out, s, bytes: utf8Len(s), truncated };
    }

    /* 其余域（mem / settings）体量天然很小，不做裁剪 */
    if (domain === 'mem') {
      const data = loadLS(LS.mem, { profile: '', ts: 0 });
      const s = JSON.stringify(data);
      return { data, s, bytes: utf8Len(s), truncated: false };
    }
    if (domain === 'rules') {
      /* 法则同理按「新→旧」装箱；正常只有几十条，这里纯属防线 */
      const all = loadLS(LS.rules, []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const out = [];
      let chars2 = 2, bytes2 = 2;
      let cut = false;
      for (const r of all) {
        const one = JSON.stringify(r);
        const c = one.length + (out.length ? 1 : 0);
        const n = utf8Len(one) + (out.length ? 1 : 0);
        if (chars2 + c > maxChars || bytes2 + n > maxBytes) { cut = true; break; }
        out.push(r); chars2 += c; bytes2 += n;
      }
      const s = JSON.stringify(out);
      return { data: out, s, bytes: utf8Len(s), truncated: cut };
    }
    if (domain === 'settings') {
      const { model, digestOn, kbOn, rememberOn } = State.s;
      const data = { model, digestOn, kbOn, rememberOn, ts: now() };
      const s = JSON.stringify(data);
      return { data, s, bytes: utf8Len(s), truncated: false };
    }
    return { data: null, s: 'null', bytes: 4, truncated: false };
  }

  const hashes = loadLS('ws_sync_hashes', {});
  const dirty = new Set();
  let pushTimer = null, pushing = false, lastState = '', lastErr = '';

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
    if (!State.s.syncOn || !State.s.syncCode) return false;
    if (pushing) return false;
    pushing = true;
    const failed = [], trimmed = [];
    let firstErr = '';
    try {
      for (const d of DOMAINS) {
        if (!force && !dirty.has(d)) continue;
        /* C 项①：每个域**独立结算**。
           原先任一域抛错就整个 catch 退出 —— 一个超限的 hist 会把
           mem/settings/rules/kb 一起带下水（实测后果：界面 9 条法则，云端只有 1 条）。 */
        try {
          let pack = snapshot(d);
          if (!force && hashes[d] === djb2(pack.s)) { dirty.delete(d); continue; }
          try {
            await request('state.put', { domain: d, data: pack.data });
          } catch (e) {
            /* C 项②：网关超限的 413 **不带 CORS 头**，前端只能看到 TypeError，
               连错误码都拿不到 → 只能按「包体太大」猜一次，用保守档重裁重发。
               猜错了（真网络抖动）也只是多试一次，无害。 */
            /* 只在「包确实很大」时才猜：小包遇到网络错就是网络错，别拿裁剪去掩盖它，
               否则真抖动会被记成一次"少传"，白白缩小云端备份。 */
            if (!e.network || pack.bytes <= 100 * 1024) throw e;
            const small = snapshot(d, { maxChars: DOMAIN_CHAR_CAP, maxBytes: DOMAIN_BYTE_CAP_SAFE });
            if (small.bytes >= pack.bytes) throw e;   // 裁不小 → 不是包体问题，别瞎猜
            await request('state.put', { domain: d, data: small.data });
            pack = small;
          }
          hashes[d] = djb2(pack.s);
          if (pack.truncated) trimmed.push(d);
          dirty.delete(d);
        } catch (e) {
          failed.push(d);                              // 该域留着 dirty，下次重试
          /* 带上域名：否则用户只看到一句「单域数据超上限」，不知道是哪个域、该去清哪里 */
          if (!firstErr) firstErr = d + ' 域 ' + ((e && e.message) || '未知错误');
        }
      }
      saveLS('ws_sync_hashes', hashes);
      if (failed.length) {
        lastErr = firstErr;
        setSyncState('备份未完成：' + firstErr
          + (failed.length > 1 ? ('（另有 ' + failed.slice(1).join('/') + ' 也失败）') : ''));
        return false;
      }
      lastErr = '';
      setSyncState('已备份 ' + new Date().toTimeString().slice(0, 5)
        + (trimmed.length ? '（' + trimmed.join('/') + ' 只上传了最近部分）' : ''));
      return true;
    } finally { pushing = false; }
  }

  function setSyncState(txt) { lastState = txt; const el = $('#me-sync-state'); if (el) el.textContent = txt; }
  const lastError = () => lastErr;

  /* 合并：知识库按 id 并集（同 id 取新），历史按 ts 去重排序，记忆取新，设置只取偏好。
     返回 { changed, added } —— changed = 本机数据是否真的被改动；added = 新增条目数。
     为什么不再返回裸 boolean：恢复完成的提示原先说「取回 N 类数据」，而 settings 域原本恒为
     true、kb 域也恒为 true，于是「4 类数据」可能对应「其实一条新数据都没有」，严重误导用户。 */
  function merge(domain, cloud, force) {
    const NONE = { changed: false, added: 0 };
    if (cloud == null) return NONE;
    if (domain === 'kb') {
      const local = loadLS(LS.kb, []);
      const map = new Map(local.map(e => [e.id, e]));
      let added = 0, updated = 0;
      for (const e of (cloud || [])) {
        const old = map.get(e.id);
        if (!old) { added++; map.set(e.id, e); continue; }
        if ((e.ts || 0) >= (old.ts || 0)) {
          if (JSON.stringify(old) !== JSON.stringify(e)) updated++;   // 同 id 内容变新也算「有变化」
          map.set(e.id, e);
        }
      }
      const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 500);
      /* 写盘失败（本地存储满）绝不能算成功 —— 否则界面报「新增 N」，实际一条没落盘 */
      if (!saveLS(LS.kb, merged)) return { changed: false, added: 0, saveFailed: true };
      return { changed: (added + updated) > 0, added, updated };
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
          title: cleanTitle((firstQ && firstQ.content) || '') || '历史对话',
          ts, msgs: cloud,
        }];
      }
      if (!cloudSessions || !cloudSessions.length) return NONE;
      const local = loadLS('ws_sessions', []);
      if (!local.length) {
        if (!saveLS('ws_sessions', cloudSessions)) return { changed: false, added: 0, saveFailed: true };
        Sessions.invalidate();
        State.s.curSession = (cloud && cloud.cur) || cloudSessions[0].id;
        State.save();
        return { changed: true, added: cloudSessions.length, updated: 0 };
      }
      if (force) {
        // 手动「从云端恢复」：并集合并（同 id 取新），本地会话保留不丢
        const map = new Map(local.map(s => [s.id, s]));
        let added = 0, updated = 0;
        for (const s of cloudSessions) {
          const old = map.get(s.id);
          if (!old) added++;
          else if ((s.ts || 0) > (old.ts || 0)) updated++;
          if (!old || (s.ts || 0) > (old.ts || 0)) map.set(s.id, s);
        }
        const merged = Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30);
        if (!saveLS('ws_sessions', merged)) return { changed: false, added: 0, saveFailed: true };
        Sessions.invalidate();
        if (!State.s.curSession) { State.s.curSession = (merged[0] && merged[0].id) || ''; State.save(); }
        return { changed: (added + updated) > 0, added, updated };
      }
      return NONE;   // 自动同步路径：本地有数据就不动（防覆盖）
    }
    if (domain === 'mem') {
      const local = loadLS(LS.mem, { profile: '', ts: 0 });
      if ((cloud.ts || 0) >= (local.ts || 0)) {
        const ch = JSON.stringify(cloud) !== JSON.stringify(local);
        if (ch && !saveLS(LS.mem, cloud)) return { changed: false, added: 0, saveFailed: true };
        return { changed: ch, added: ch ? 1 : 0 };
      }
      return NONE;
    }
    if (domain === 'rules') {
      const local = loadLS(LS.rules, []);
      const cloudArr = Array.isArray(cloud) ? cloud : [];
      if (!local.length && cloudArr.length) {
        if (!saveLS(LS.rules, cloudArr)) return { changed: false, added: 0, saveFailed: true };
        return { changed: true, added: cloudArr.length };
      }
      if (force && cloudArr.length) {
        const seen = new Set(local.map(r => r && r.text));
        const fresh = cloudArr.filter(r => r && r.text && !seen.has(r.text));
        if (fresh.length) {
          if (!saveLS(LS.rules, local.concat(fresh).slice(0, 40))) return { changed: false, added: 0, saveFailed: true };
          return { changed: true, added: fresh.length };
        }
      }
      return NONE;
    }
    if (domain === 'settings') {
      /* 注意：不要无条件返回 changed=true —— 那会让「恢复完成」虚报一类数据。 */
      let ch = false;
      if (cloud && cloud.model && !State.s.model) { State.s.model = cloud.model; ch = true; }
      if (typeof cloud.digestOn === 'boolean' && State.s.digestOn !== cloud.digestOn) { State.s.digestOn = cloud.digestOn; ch = true; }
      if (typeof cloud.kbOn === 'boolean' && State.s.kbOn !== cloud.kbOn) { State.s.kbOn = cloud.kbOn; ch = true; }
      if (typeof cloud.rememberOn === 'boolean' && State.s.rememberOn !== cloud.rememberOn) { State.s.rememberOn = cloud.rememberOn; ch = true; }
      if (ch) State.save();
      return { changed: ch, added: 0 };
    }
    return NONE;
  }

  /* 手动「从云端恢复」。返回 { classes, added, total, changed, topId, src, loc, sameAsMine, saveFailed }：
     added 按域统计**真实新增**（会话数 / 知识库条数 / 法则条数 …），
     src = 云端这个码里到底有什么、loc = 本机现在有什么 ——
     界面据此把「账户为空」「数据早已在本机」「你填的是本机自己的码」三种情况分开说，
     不再一律甩一句「没有可恢复的新数据」让用户猜。 */
  async function restore(code) {
    const target = (code || State.s.syncCode || '').toUpperCase();
    if (!/^[A-Z2-7]{12}$/.test(target)) {
      const e = new Error('同步码必须是 12 位，且只含 A–Z 与 2–7（数字 0/1/8/9 不合法）');
      e.code = 'BAD_CODE';
      throw e;
    }
    const j = await request('state.get', { domain: 'ALL', code: target });
    const added = { hist: 0, kb: 0, rules: 0, mem: 0, settings: 0 };
    let classes = 0, saveFailed = false;
    for (const d of DOMAINS) {                 // 手动恢复：强制合并
      const r = merge(d, j[d], true);
      if (r.saveFailed) saveFailed = true;
      if (r.changed) classes++;
      added[d] += r.added;
    }
    const total = added.hist + added.kb + added.rules;
    /* 云端这个码里到底有多少东西 —— 用来区分「账户为空」和「数据早已在本机」 */
    let cs = [];
    if (j.hist && Array.isArray(j.hist.sessions)) cs = j.hist.sessions;
    else if (Array.isArray(j.hist)) cs = [{ msgs: j.hist }];
    const src = {
      sess: cs.length,
      msgs: cs.reduce((n, s) => n + ((s.msgs || []).length), 0),
      kb: (j.kb || []).length,
      rules: (Array.isArray(j.rules) ? j.rules : []).length,
    };
    /* 恢复后要让用户「看得见」：取并集里 ts 最新的会话；顺便记下本机现在有多少 */
    const loc = { sess: 0, kb: 0, rules: 0, topTitle: '' };
    let topId = '';
    try {
      const all = Sessions.all();
      loc.sess = all.length;
      loc.kb = loadLS(LS.kb, []).length;
      loc.rules = loadLS(LS.rules, []).length;
      if (all.length) {
        const top = all.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        topId = top.id;
        loc.topTitle = top.title || '';
      }
    } catch (e) { /* 读不到不影响恢复本身 */ }
    return {
      classes, added, total,
      changed: (total > 0 || classes > 0) && !saveFailed,
      saveFailed,
      sameAsMine: target === String(State.s.syncCode || '').toUpperCase(),
      topId, src, loc,
    };
  }

  async function ensureCode() {
    if (State.s.syncCode) return State.s.syncCode;
    try {
      const j = await request('init');
      State.s.syncCode = j.code;
      State.save();
      /* renderCode 定义在 Me 模块内，此处不可裸调用（此前裸调 → ReferenceError 被 catch 吞成"离线模式"） */
      if (typeof Me !== 'undefined' && Me.renderCode) Me.renderCode();
      markDirty();
      /* 新码只在这里出现一次，必须趁现在把「抄下它 / 设口令」摆到用户面前 */
      if (typeof Safety !== 'undefined' && Safety.maybeShow) Safety.maybeShow();
      return j.code;
    } catch (e) {
      setSyncState('离线模式：' + e.message);
      return '';
    }
  }

  async function init() {
    /* 同上：必须走 Me.renderCode，裸调用会抛 ReferenceError 并中断整个云同步初始化 */
    if (typeof Me !== 'undefined' && Me.renderCode) Me.renderCode();
    setSyncState(State.s.syncCode ? (lastState || '待同步') : '未生成');
    if (State.s.syncCode && State.s.syncOn) {
      try {
        const j = await request('state.get', { domain: 'ALL' });
        let changed = false;
        for (const d of DOMAINS) { if (merge(d, j[d]).changed) changed = true; }
        if (changed) { Chat.renderMsgs(); KB.render(); }
        /* 本地非空但云端更新（常见于重装/换设备）→ 不静默丢弃，提示可手动恢复 */
        if (!changed && j.hist && Array.isArray(j.hist.sessions)) {
          const cloudMax = j.hist.sessions.reduce((m, s) => Math.max(m, s.ts || 0), 0);
          const localMax = loadLS('ws_sessions', []).reduce((m, s) => Math.max(m, s.ts || 0), 0);
          if (cloudMax > localMax + 60000) toast('云端有更新的对话，可在「我的 → 从云端恢复」拉取', 3500);
        }
        for (const d of DOMAINS) { hashes[d] = djb2(snapshot(d).s); }
        saveLS('ws_sync_hashes', hashes);
        setSyncState('已同步');
      } catch (e) { setSyncState('云同步失败：' + e.message); }
    } else if (State.s.syncOn) {
      await ensureCode(); // 新设备：先领同步码，聊天/备份都靠它
    }
  }

  return { request, streamChat, markDirty, pushAll, restore, ensureCode, init, setSyncState, lastError };
})();

/* ===== 口令式同步码 =====
   同步码是云端数据的唯一身份，却只存在 localStorage 里 —— 重装即销毁，
   云端那份数据从此成为没人能认领的孤儿。这是「重装丢数据」的根本原因。
   解法：让同步码可以由用户记得住的口令**确定性派生**出来。同一口令在任何设备、
   任何时间都得到同一个码，所以重装后只要还记得口令，就能把数据全部找回。

   派生完全在前端完成，服务端不需要任何改动 —— 已确认 state.put 只校验格式
   （CODE_RE = /^[A-Z2-7]{12}$/）而不校验归属，任意合法码都能直接写入并自动建档。

   算法：PBKDF2-SHA256(口令, 固定盐, 100000 轮) → 取 64 位 → RFC4648 base32 → 前 12 位。
   注意两处约束：
   1) crypto.subtle 是唯一实现，**不做降级**。降级算法会算出不同的码，比直接报错危险得多。
   2) deriveBits 的位数必须是 8 的倍数，故取 64 位（base32 后 12.8 字符，切前 12 位即合规）。
   已实测 file:// 与 https 两种环境下 isSecureContext 均为 true、crypto.subtle 均可用。 */
const Pass = (() => {
  const SALT = 'wenshi-sync-v1';
  const ROUNDS = 100000;
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const MIN_LEN = 6;

  function available() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  async function derive(pw) {
    if (!available()) throw new Error('当前环境不支持口令派生，请改用随机同步码');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ROUNDS, hash: 'SHA-256' }, key, 64);
    let acc = 0, n = 0, out = '';
    for (const byte of new Uint8Array(bits)) {
      acc = (acc << 8) | byte; n += 8;
      while (n >= 5) { out += B32[(acc >>> (n - 5)) & 31]; n -= 5; }
    }
    return out.slice(0, 12);
  }

  function check(pw, pw2) {
    const p = String(pw || '');
    if (p.length < MIN_LEN) return '口令至少 ' + MIN_LEN + ' 位';
    if (p.length > 32) return '口令最多 32 位';
    if (pw2 != null && p !== String(pw2)) return '两次输入的口令不一致';
    return '';
  }

  /* 应用口令：派生码 → 先把该码下已有的云端数据并回本地 → 再把本地全量写回该码。
     重装（本地为空）时是「拉回」；平时改口令时是「两边并集」。两条路径都不会丢数据。 */
  async function apply(pw) {
    const code = await derive(pw);
    const oldCode = State.s.syncCode;
    const oldMode = State.s.pwMode;
    State.s.syncCode = code;

    let pulled = 0;
    try {
      pulled = await Sync.restore(code);          // 码不存在会抛 NO_SUCH_CODE，属正常（首次启用）
    } catch (e) {
      if (e.code !== 'NO_SUCH_CODE' && e.status !== 404) {
        State.s.syncCode = oldCode; State.s.pwMode = oldMode; State.save();   // 失败回滚，不留半截状态
        throw e;
      }
    }

    State.s.pwMode = true;
    State.s.syncOn = true;                        // 口令模式必须开着同步，否则等于没保护
    State.save();
    /* 关键：必须让调用方知道备份到底成没成。
       口令生效了但云端没写上去，用户会以为自己受保护了 —— 那比报错更危险。 */
    const backed = await Sync.pushAll(true);
    return { pulled, backed };
  }

  return { derive, apply, check, available, MIN_LEN };
})();

/* ===== 首次启动「数据安全」引导 =====
   同步码只在「我的」页默默显示，用户从来不会主动去看 —— 也就无从知道自己需要保存它。
   故拿到同步码后弹一次，把两条路摆在明面上：抄下随机码，或设一个自己记得住的口令。 */
const Safety = (() => {
  const KEY = 'ws_seen_safety';

  function dismiss() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* 隐私模式下写不了，忽略 */ }
    const m = $('#modal-safety'); if (m) m.classList.add('hidden');
  }

  function maybeShow() {
    if (localStorage.getItem(KEY) || !State.s.syncCode) return;
    const m = $('#modal-safety');
    if (!m) return;
    const c = $('#sf-code'); if (c) c.textContent = State.s.syncCode;
    const pw = $('#sf-pw-state');
    if (pw) pw.textContent = State.s.pwMode ? '已启用口令保护' : '尚未保护';
    m.classList.remove('hidden');
  }

  /* 通用的「设置口令」提交流程，首次引导与设置页共用 */
  async function submit(pwEl, pw2El, tipEl, onOk) {
    const say = (t) => { if (tipEl) tipEl.textContent = t; else if (t) toast(t, 3500); };
    const bad = Pass.check(pwEl.value, pw2El ? pw2El.value : null);
    if (bad) { say(bad); return false; }
    say('正在派生同步码…（约需 1 秒）');
    try {
      const r = await Pass.apply(pwEl.value);
      pwEl.value = ''; if (pw2El) pw2El.value = '';
      say('');
      if (onOk) onOk(r);
      return true;
    } catch (e) {
      say('设置失败：' + e.message);
      return false;
    }
  }

  function openPassModal(hint) {
    const m = $('#modal-pass');
    if (!m) return;
    $('#mp-pw').value = ''; $('#mp-pw2').value = '';
    $('#mp-tip').textContent = hint || '';
    m.classList.remove('hidden');
    $('#mp-pw').focus();
  }

  function afterOk(r, msg) {
    const n = (r && r.pulled) || 0;
    if (r && r.backed === false) {
      /* 口令本身已生效，但云端没写上去 —— 必须说清楚，否则用户以为已经受保护了。
         顺带带上真实原因：原先一律说"网络"，实测多数是包体超限，会把人带偏。 */
      toast(msg + '；但云端备份未成功（' + (Sync.lastError() || '未知错误')
        + '），请到「我的 → 立即备份」重试', 7500);
    } else {
      toast(n ? (msg + '，并从云端找回 ' + n + ' 类数据') : msg, 4000);
    }
    Me.renderCode(); Me.fillSettings();
  }

  function bind() {
    const copy = $('#sf-copy');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(State.s.syncCode); toast('同步码已复制'); }
      catch (e) { toast('复制失败，请手动抄下：' + State.s.syncCode, 8000); }
    });
    const later = $('#sf-later');
    if (later) later.addEventListener('click', () => {
      dismiss();
      toast('已跳过。以后可在「我的 → 同步口令」里设置，口令能防止重装丢数据', 5000);
    });
    const sfSet = $('#sf-setpw');
    if (sfSet) sfSet.addEventListener('click', () => {
      submit($('#sf-pw'), $('#sf-pw2'), $('#sf-tip'), (r) => {
        dismiss(); afterOk(r, '已用口令保护');
      });
    });

    /* 重装/换机进来的用户：这条比「抄码」更贴切 */
    const sfRes = $('#sf-restore');
    if (sfRes) sfRes.addEventListener('click', () => {
      dismiss();
      $('#modal-code-input').value = '';
      $('#modal-code').classList.remove('hidden');
      $('#modal-code-input').focus();
    });
    const meSet = $('#me-pw-set');
    if (meSet) meSet.addEventListener('click', () => openPassModal(''));
    const mpCancel = $('#mp-cancel');
    if (mpCancel) mpCancel.addEventListener('click', () => $('#modal-pass').classList.add('hidden'));
    const mpOk = $('#mp-ok');
    if (mpOk) mpOk.addEventListener('click', () => {
      submit($('#mp-pw'), $('#mp-pw2'), $('#mp-tip'), (r) => {
        $('#modal-pass').classList.add('hidden'); afterOk(r, '已用口令保护');
      });
    });
    /* 恢复弹窗里的兜底：忘了同步码不要紧，输口令也行 */
    const toPass = $('#mc-to-pass');
    if (toPass) toPass.addEventListener('click', () => {
      $('#modal-code').classList.add('hidden');
      openPassModal('输入你设过的口令。口令相同，就会回到同一份云数据。');
    });
  }

  return { maybeShow, bind, dismiss };
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
  function save(list) {
    saveLS(LS.kb, list.slice(0, 500));
    /* 知识库现已并入云备份（此前只存本地，重装即丢）。Sync 定义在前，此处可安全引用 */
    if (typeof Sync !== 'undefined' && Sync.markDirty) Sync.markDirty('kb');
  }

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
  let stopCtl = null;       // 当前请求的中断句柄（停止生成）
  let editIdx = null;       // 正在编辑重发的消息下标
  const HIST_MAX = 120, CTX_MAX = 12;
  /* S3 滚动摘要：超出上下文窗口的早期对话压成摘要注入 earlier（原先只取用户提问、截 50 字，
     助手侧的关键结论会整段丢失）。SUM_STEP = 被丢弃段新增多少条才压一次；
     SUM_TEXT_MAX = 摘要目标长度，与服务端 earlier 槽位（1200 字）留出余量。 */
  const SUM_STEP = 6, SUM_TEXT_MAX = 900;
  const REASONS = ['太浅了', '大俗话', '太理论', '例子不好', '立场偏了', '太长'];

  /* 无障碍：只播报最新一条回答，避免整块重渲染被反复朗读 */
  function announce(t) { const el = $('#sr-live'); if (el) el.textContent = t; }
  function setSendMode(on) {
    const b = $('#chat-send');
    if (!b) return;
    b.classList.toggle('stop', on);
    b.innerHTML = on ? '■' : '↑';
    b.setAttribute('aria-label', on ? '停止生成' : '发送');
  }
  function startEdit(idx) {
    const m = hist()[idx];
    if (!m || m.role !== 'user') return;
    editIdx = idx;
    const input = $('#chat-input');
    input.value = String(m.content || '');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    const bar = $('#edit-bar');
    if (bar) bar.classList.remove('hidden');
    input.focus();
    toast('改完直接发送，将从这条重新开始');
  }
  function cancelEditBar() { const bar = $('#edit-bar'); if (bar) bar.classList.add('hidden'); }
  function cancelEdit() {
    editIdx = null;
    cancelEditBar();
    const input = $('#chat-input');
    input.value = '';
    input.style.height = 'auto';
    input.focus();
  }

  function hist() { return Sessions.curMsgs(); }
  function saveHist(h) { Sessions.put(h, HIST_MAX); }
  function meta() { return loadLS(LS.meta, { rounds: 0 }); }

  /* ---- 打字机状态：{idx, shown}，renderMsgs 按 shown 截断显示 ---- */
  let typingState = null;
  let typingTimer = null;
  /* ---- 流式状态：正在逐字写入的回答下标（-1 表示无）。仅用于在流式期间隐藏操作条 ---- */
  let streamingIdx = -1;
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
    // 内容其实已经到手，逐字只为可读性：总时长压到 0.6s~2.4s，点一下可立即显示全文
    const dur = Math.min(2400, Math.max(600, len * 10));
    const tick = 32;
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

  /* ---- 流式渲染：首块到达时开一个空气泡，之后只改这一个元素的 innerHTML ----
     与打字机的区别：打字机是「已有全文、假装慢慢打」；这里是真实边收边写。
     全量 renderMsgs() 在流式期间不能每条都调（几十次重排会卡），故只原地更新气泡。 */
  function beginLiveBubble() {
    const h = hist();
    h.push({ role: 'assistant', content: '', ts: now() });
    saveHist(h);
    renderMsgs();
    const idx = hist().length - 1;     // 落盘可能截断，取落盘后的真实下标
    streamingIdx = idx;
    return idx;
  }
  function pushLive(idx, allText) {
    const h = hist();
    if (h[idx]) h[idx].content = allText;   // 只改缓存，不落盘（避免每条增量都写 localStorage）
    const b = bubbleEl(idx);
    if (b) b.innerHTML = mdLite(allText) + '<span class="caret"></span>';
    const wrap = $('#chat-msgs');
    /* 只在用户本来就贴着底部时才跟随，避免打断上翻历史（与打字机同策略） */
    if (wrap && wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 140) wrap.scrollTop = wrap.scrollHeight;
  }
  function endLiveBubble() { streamingIdx = -1; }

  function fbBarHtml(idx, m) {
    if (m.role !== 'assistant') return '';
    if (typingState && typingState.idx === idx) return ''; // 打字中不显示操作条
    if (streamingIdx === idx) return '';                   // 流式写入中同理
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
    $$('.ctx-note', wrap).forEach(m => m.remove());
    const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
    /* 超出上下文窗口的轮次会被折叠成摘要送进 AI，这里如实告知用户 */
    if (h.length > CTX_MAX) {
      const droppedQ = h.slice(0, h.length - CTX_MAX).filter(m => m.role === 'user').length;
      if (droppedQ > 0) {
        wrap.insertAdjacentHTML('afterbegin',
          `<div class="ctx-note">较早的 ${droppedQ} 个问题已折叠为上下文摘要，仍会影响回答</div>`);
      }
    }
    const shown = h.slice(-60);
    const base = h.length - shown.length;
    for (let i = 0; i < shown.length; i++) {
      const m = shown[i];
      const idx = base + i;
      if (m.role === 'user') {
        wrap.insertAdjacentHTML('beforeend', `
          <div class="msg user" data-idx="${idx}"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div>
          <div class="fb-bar user-bar">
            <button class="fb-btn" data-copy="${idx}">${SVG.copy}复制</button>
            <button class="fb-btn" data-edit="${idx}">编辑</button>
          </div></div>`);
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
  function setWaitText(t) { if (waitLabel && waitLabel.el) waitLabel.el.textContent = t; }
  function showTyping() {
    $('#chat-msgs').insertAdjacentHTML('beforeend', `
      <div class="msg bot" id="msg-typing"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span><span id="typing-label"></span></div></div>`);
    $('#chat-msgs').scrollTop = 1e9;
    const t0 = Date.now();
    waitLabel = { el: $('#typing-label'), n: 0, timer: setInterval(() => {
      if (!waitLabel || !waitLabel.el) { clearInterval(waitLabel && waitLabel.timer); return; }
      const sec = Math.round((Date.now() - t0) / 1000);
      waitLabel.el.textContent = sec + 's · ' + (sec >= 12 ? '还在想，长问题要多琢磨一会儿…' : '正在思考…');
    }, 1000) };
    setWaitText('0s · 正在思考…');
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

  /* 长期记忆入库（S2 写入侧，2026-10-08）
     与 digest 并行、互不影响：digest 管「知识库 + 用户画像」，这里管「结构化事实图谱」。
     三条纪律（改动前请先读）：
       1. 纯附加 —— 只往云端记忆库写，**从不碰本地任何数据**；失败静默，绝不影响聊天。
       2. 不堆积 —— 上一轮还没跑完就跳过本轮（抽取实测 10~25s，慢网络下更长）。
       3. 长回答才值得一次抽取 —— 寒暄/确认类短回答跳过，省掉无谓的调用与额度。
     出问题时的开关：「我的 → 长期记忆入库」关掉即可（不需要发版）。 */
  let rememberBusy = false, rememberFail = 0;
  let sumBusy = false;                 // S3 摘要压缩的并发闸门
  async function remember(q, a) {
    if (rememberBusy) return 0;
    rememberBusy = true;
    try {
      const j = await Sync.request('ai.remember', { q, a, mem: Mem.get().profile }, 125000);
      rememberFail = 0;
      return (j && j.ing) ? 1 : 0;
    } catch (e) {
      rememberFail++;
      if (rememberFail >= 3) { rememberFail = 0; toast('记忆入库连续失败，稍后自动重试', 4000); }
      return 0;
    } finally { rememberBusy = false; }
  }

  /* ---- S3 上下文滚动摘要 ----
     超出上下文窗口的早期对话，压成一份滚动摘要随 earlier 注入；替代原先
     「只取用户提问、截 50 字、最多 10 条」的粗暴折叠（助手侧的关键结论会整段丢失）。
     摘要存在**会话对象**的 sum 字段 {upto,text,src,ts}，随 hist 域云同步 ——
     不写云端记忆库、不碰本地其他任何键；ws_nosum=1 可永久退回旧行为（不改代码的逃生开关）。 */
  function noSum() {
    const v = loadLS(LS.nosum, false);
    return v === true || v === 1 || v === '1';
  }
  /* 取当前会话可用的摘要。src = 压缩当时的历史条数：若之后历史被「编辑重发」回退过
     （all.length < src），说明消息已不是摘要所依据的那份 → 作废、从头再压。 */
  function curSummary(all) {
    const s = Sessions.cur();
    const sum = s && s.sum;
    if (!sum || !sum.text) return null;
    if (typeof sum.upto !== 'number' || typeof sum.src !== 'number') return null;
    if (sum.src > all.length || sum.upto > all.length) return null;
    return sum;
  }
  async function compact() {
    if (noSum() || sumBusy) return 0;
    const all = hist();
    const over = all.length - CTX_MAX;
    if (over <= 0) return 0;
    const prev = curSummary(all);
    const covered = prev ? prev.upto : 0;
    const add = all.slice(0, over).slice(covered);      // 只压「新落入被丢弃区」的那段
    if (add.length < SUM_STEP) return 0;
    const sessId = Sessions.curId();                    // ★ 先取 id：await 期间用户可能切会话
    const srcLen = all.length, upto = over;
    sumBusy = true;
    try {
      const j = await Sync.request('ai.compact', {
        prev: prev ? String(prev.text) : '',
        turns: add.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 600),
        })),
      }, 90000);
      const text = j && j.summary ? String(j.summary).trim().slice(0, SUM_TEXT_MAX) : '';
      if (!text) return 0;
      Sessions.setSum(sessId, { upto, text, src: srcLen, ts: now() });
      return 1;
    } catch (e) {
      return 0;   // 静默：摘要拿不到就继续用旧内容，下一轮再试
    } finally { sumBusy = false; }
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
    setSendMode(true);
    /* 编辑重发：先截掉被编辑那条及其之后，再作为新提问发出 */
    if (editIdx != null) { saveHist(hist().slice(0, editIdx)); editIdx = null; cancelEditBar(); }
    if (!o.noPushUser) pushMsg('user', q);
    Sessions.ensure();
    showTyping();
    stopCtl = new AbortController();
    const all = hist();
    const ctx = all.slice(-CTX_MAX).map(m => ({ role: m.role, content: m.content }));
    /* 超出上下文窗口的早期内容：优先用 S3 滚动摘要；没有摘要（老会话/压缩失败/被关掉）
       才回退旧「问题清单」。两条路都只往 earlier 里放文字，不改变发送的消息本身。 */
    const dropped = all.slice(0, Math.max(0, all.length - CTX_MAX));
    let earlier = '';
    if (dropped.length) {
      const sum = noSum() ? null : curSummary(all);
      if (sum && sum.text) {
        earlier = String(sum.text).slice(0, 1200);
      } else {
        const qs = dropped.filter(m => m.role === 'user')
          .map(m => String(m.content || '').replace(/\s+/g, ' ').slice(0, 50));
        if (qs.length) earlier = qs.slice(-10).map(t => '- ' + t).join('\n');
      }
    }
    let full = '', usedModel = '', leftN = null;
    let liveIdx = -1, gotAny = false, streamed = false, finished = false;
    try {
      if (!State.s.syncCode) await Sync.ensureCode();
      if (!State.s.syncCode) throw Object.assign(new Error('网络不可用，稍后再试'), { silent: true });
      const kbHits = KB.search(q).map(e => ({ title: e.title, content: String(e.content).slice(0, 400) }));
      const payload = {
        messages: ctx, mem: String(Mem.get().profile || '').slice(0, 600), kb: kbHits,
        rules: Rules.texts(), earlier,
        ...(State.s.model ? { model: State.s.model } : {}),
      };

      /* ---- 优先走流式（方案 A）；凡是「尚未吐字」的失败都静默降级到原非流式路径 ----
         ws_nostream=1 可永久退回非流式（不改代码的逃生开关） */
      if (!loadLS(LS.noStream, false)) {
        try {
          const r = await Sync.streamChat(payload, {
            signal: stopCtl.signal,
            onDelta: (piece) => {
              if (!gotAny) { gotAny = true; hideTyping(); liveIdx = beginLiveBubble(); }
              full += piece;
              pushLive(liveIdx, full);
            },
          });
          if (!full) full = r.text || '';
          usedModel = r.model || '';
          if (typeof r.left === 'number') leftN = r.left;
          streamed = true; finished = true;
          if (r.partial) toast('回答被中途截断，已保留已生成部分', 3200);
        } catch (e) {
          if (e && e.noStream) {
            saveLS(LS.noStream, true);              // 环境不支持流式读：以后直接走非流式
          } else if (e && e.abortedByUser) {
            if (gotAny) { streamed = true; finished = true; }   // 点「停止生成」→ 保留已生成的部分
            else throw e;
          } else if (gotAny) {
            streamed = true; finished = true;        // 已吐字后断流：保留半截，不重试（重试会重复内容）
            toast('网络中断，已保留已生成的内容', 3200);
          } else if (e && e.code) {
            throw e;                                 // 业务错误（LIMIT/AI_AUTH/BAD_CODE…）原样上报
          }
          /* 其余（连接失败等，尚未吐字）：落到下面走非流式 */
        }
      }

      if (!finished) {
        const j = await Sync.request('ai.chat', payload, 120000, {
          signal: stopCtl.signal,
          retries: 2,
          onRetry: (n) => setWaitText('网络波动，正在重试（' + n + '/2）…'),
        });
        full = j.text || '（空回答）';
        usedModel = j.model || '';
        if (typeof j.left === 'number') leftN = j.left;
      }

      hideTyping();
      if (streamed) {
        if (!full) full = '（空回答）';
        endLiveBubble();
        const h2 = hist();                       // 落盘可能截断下标，故以活体下标为准并对齐
        if (h2[liveIdx]) h2[liveIdx].content = full;
        else h2.push({ role: 'assistant', content: full, ts: now() });
        saveHist(h2);
        renderMsgs();                            // 补上流式期间被隐藏的评价条
      } else {
        const h = hist();
        h.push({ role: 'assistant', content: full, ts: now() });
        saveHist(h);
        startTypewriter(hist().length - 1, full);   // 用落盘（含截断）后的真实下标
      }
      announce('问史回答：' + full.slice(0, 80));
      if (typeof leftN === 'number') { State.s.left = leftN; State.save(); }
      if (usedModel && State.s.model && usedModel !== State.s.model) toast('所选模型不可用，已自动改用 ' + usedModel, 3200);
      if (State.s.digestOn) digest(q, full).then(n => { if (n) toast('已提炼入库'); });
      /* 长期记忆入库：与上面并行、不 await（不拖慢界面），短回答跳过。
         写的是云端记忆库，与本地会话/KB/法则完全隔离 —— 失败也不影响任何已有数据。 */
      if (State.s.rememberOn !== false && full.length >= 40) remember(q, full);
      /* S3：早期对话滚动摘要（同样不 await；失败静默，下一轮再试） */
      compact().catch(() => {});
      // 轮次计数 + 每 20 轮自动复盘
      const mt = meta();
      mt.rounds = (mt.rounds || 0) + 1;
      saveLS(LS.meta, mt);
      if (mt.rounds % 20 === 0) reviewNow(true).catch(() => {});
    } catch (e) {
      hideTyping();
      endLiveBubble();
      if (e.abortedByUser) {
        toast('已停止生成');
      } else if (!e.silent) {
        const msg = e.code === 'LIMIT' ? e.message : '回答失败：' + e.message;
        $('#chat-msgs').insertAdjacentHTML('beforeend', `
          <div class="msg bot"><div class="bubble msg-err">${esc(msg)}<br><span class="err-hint">内容已保留，稍后可重试</span></div></div>`);
        $('#chat-msgs').scrollTop = 1e9;
      }
    } finally {
      streamingIdx = -1;
      sending = false;
      stopCtl = null;
      setSendMode(false);
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
    $('#chat-send').addEventListener('click', () => {
      if (sending) { if (stopCtl) stopCtl.abort(); return; }   // 生成中 → 点击即停止
      if (!input.value.trim()) return;
      send(input.value); input.value = ''; input.style.height = 'auto'; input.focus();
    });
    const eb = $('#edit-bar-cancel');
    if (eb) eb.addEventListener('click', cancelEdit);
    $('#chat-chips').addEventListener('click', (ev) => {
      const c = ev.target.closest('.chip');
      if (c && !c.hasAttribute('data-reason')) send(c.getAttribute('data-q'));
    });

    /* 评价条事件（委托）：点当前已选 = 取消；点另一个 = 切换；差评弹原因面板 */
    $('#chat-msgs').addEventListener('click', async (ev) => {
      /* 打字中：点一下立即显示全文 */
      if (typingState) { stopTypewriter(true); return; }
      const ed = ev.target.closest('[data-edit]');
      if (ed) { startEdit(Number(ed.getAttribute('data-edit'))); return; }
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
    const st = $('#me-pw-state');
    if (st) st.textContent = State.s.pwMode ? '已启用（由口令派生）' : '未设置';
    const btn = $('#me-pw-set');
    if (btn) btn.textContent = State.s.pwMode ? '更换' : '设置';
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
      settings: { model: State.s.model, digestOn: State.s.digestOn, kbOn: State.s.kbOn, rememberOn: State.s.rememberOn !== false },
      /* 一并带上云同步身份，这样「导出文件 → 重装 → 导入文件」能把云端身份也找回来 */
      syncCode: State.s.syncCode || '', syncOn: !!State.s.syncOn,
    };
    const json = JSON.stringify(data, null, 1);
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const name = `问史备份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;

    /* 安卓壳：页面在 file:///android_asset/web/ 下，壳又没设 DownloadListener，
       Blob + a.download 不会落盘（点了没反应）。改走原生桥写进系统「下载」目录 ——
       那个位置不随卸载消失，重装后还在。 */
    const sh = window.wsShell;
    if (sh && typeof sh.saveFile === 'function') {
      let r = '';
      try { r = sh.saveFile(name, json) || ''; } catch (e) { r = ''; }
      toast(r ? ('已导出到「' + r + '」') : '导出失败：请检查系统的存储权限', 5000);
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
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
      saveLS('ws_sessions', [{ id, title: cleanTitle((firstQ && firstQ.content) || '') || '导入的对话', ts: now(), msgs: j.hist }]);
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
      if (typeof j.settings.rememberOn === 'boolean') State.s.rememberOn = j.settings.rememberOn;
      State.save();
    }
    /* 备份里带着云同步身份（同步码）时一并采用 —— 仅当本地还没有码，避免覆盖当前身份。
       这样「导出文件 → 重装 → 导入文件」能连云端关系一起恢复。 */
    if (!State.s.syncCode && typeof j.syncCode === 'string' && /^[A-Z2-7]{12}$/.test(j.syncCode)) {
      State.s.syncCode = j.syncCode;
      if (typeof j.syncOn === 'boolean') State.s.syncOn = j.syncOn;
      State.save();
      renderCode();
      toast('已同时恢复云同步身份（' + j.syncCode + '）', 5000);
    }
    Sessions.invalidate();          // 直接写了 ws_sessions，必须让会话缓存失效，否则读到的还是旧列表
    Sync.markDirty('hist');
    Chat.renderMsgs(); KB.render(); fillSettings();
    toast('导入完成');
  }

  function fillSettings() {
    $('#me-digest-on').checked = !!State.s.digestOn;
    $('#me-kb-on').checked = !!State.s.kbOn;
    /* 取值前判空：万一遇到「新 app.js + 旧 index.html」的错配（缓存/半更新），
       裸取 .checked 会抛错并中断整个初始化 —— 那在用户眼里就等同「App 坏了/数据没了」。 */
    const rEl = $('#me-remember-on');
    if (rEl) rEl.checked = State.s.rememberOn !== false;
    $('#me-sync-on').checked = !!State.s.syncOn;
    $('#me-hist-count').textContent = Chat.hist().length + ' 条';
    const lf = $('#me-left');
    if (lf) lf.textContent = (typeof State.s.left === 'number') ? (State.s.left + ' 次') : '—';
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
    /* 必须把「本机当前是哪个码」摆出来：否则用户很容易把自己这个码填进去，
       那等于「从自己恢复」——永远不会有新数据，却会被含混的提示误导成"同步坏了"。 */
    const hint = $('#modal-code-hint');
    if (hint) {
      const mine = State.s.syncCode || '';
      hint.innerHTML = mine
        ? ('本机当前同步码：<b class="mono">' + mine + '</b>。这里要填的是<b>另一台设备/另一份备份</b>的码，'
          + '填本机自己的码不会有新数据。')
        : '本机还没生成同步码，填你要恢复的那台设备的码即可。';
    }
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
      if (!State.s.syncCode) { toast('还没拿到同步码：连不上云端'); return; }
      toast('备份中…');
      /* 必须等结果：备份到底成没成，用户有权知道（失败原因也不再只说"网络不可用"） */
      const ok = await Sync.pushAll(true);
      toast(ok ? '已备份到云端' : ('备份失败：' + (Sync.lastError() || '未知错误')), 6500);
    });
    $('#me-restore').addEventListener('click', () => openCodeModal());
    $('#modal-code-cancel').addEventListener('click', () => $('#modal-code').classList.add('hidden'));
    $('#modal-code-ok').addEventListener('click', async () => {
      const want = $('#modal-code-input').value.trim().toUpperCase();
      const mine = State.s.syncCode;    // 本机当前身份。恢复过程绝不动它
      /* 把自己这个码填进去 = 「从自己恢复」，永远不可能有新数据。
         这是最容易踩的坑，必须当场拦住并把方向讲清楚，而不是回一句含混的失败提示。 */
      if (want && mine && want === String(mine).toUpperCase()) {
        toast('这就是本机当前的同步码（' + mine + '）。「从云端恢复」要填【另一台设备 / 另一份备份】的码；'
          + '填本机自己的码不会有新数据。', 7000);
        return;
      }
      /* 恢复后统一刷新（含会话列表）——否则数据已在库里、界面上却看不见 */
      const refreshUI = () => {
        renderCode(); fillSettings(); renderRules(); Chat.renderMsgs(); KB.render();
        try { SessPanel.render(); } catch (e) { /* 历史面板从未渲染过时无所谓 */ }
        const w = $('#chat-msgs'); if (w) w.scrollTop = w.scrollHeight;
      };
      try {
        /* restore() 用的是参数里的码，不依赖 State.s.syncCode，所以这里无需先改身份 */
        const res = await Sync.restore(want);
        if (res.saveFailed) {
          toast('本机存储已满，恢复的数据没能写入。请先「我的 → 导出备份」，清理后再重试', 8000);
          return;
        }
        if (!res.changed) {
          /* 「没有新增」有两种完全不同的原因，必须分开说：
             ① 云端这个码是空的（抄错码 / 从未备份过）
             ② 这份数据本机早就有了（之前恢复过） */
          if ((res.src.sess + res.src.kb + res.src.rules) === 0) {
            toast('同步码 ' + want + ' 在云端没有任何数据：该码可能从未备份过。请核对 12 位码有没有抄错。', 7000);
          } else {
            toast('该码的云端数据本机已全部拥有（云端 ' + res.src.sess + ' 个对话 / ' + res.src.kb
              + ' 条知识库；本机 ' + res.loc.sess + ' 个对话 / ' + res.loc.kb + ' 条知识库），没有新增。'
              + (res.topId ? ('已把界面切到最新的对话「' + (res.loc.topTitle || '') + '」。') : ''), 8500);
          }
          /* 关键：即使没有新增，也要刷列表 + 跳到最新对话 ——
             否则「数据早就在本机」的人会一直停在旧对话上，以为还是没恢复。 */
          if (res.topId) { State.s.curSession = res.topId; State.save(); }
          $('#modal-code').classList.add('hidden');
          refreshUI();
          return;
        }
        /* 本机已有身份就保持不变，只把数据并进来。
           此前是直接把身份换成被恢复的码 —— 后果是「先设口令 → 后恢复」会让口令保护
           名存实亡：界面仍显示「已启用口令」，可码已经不是口令派生的了。 */
        if (!mine) State.s.syncCode = want;   // 只剩「本机还没拿到码」这一种情况才接管
        /* 恢复进来的会话必须「看得见」：切到并集里最新的那个会话，
           否则用户仍停在旧对话上，会以为「什么都没恢复」。 */
        if (res.added.hist > 0 && res.topId) State.s.curSession = res.topId;
        State.save();                          // 立即落盘，避免被中途杀掉后回退，恢复白做
        /* 关键一步：把并集回写云端，让本地与云端收敛 ——
           这样旧数据才会真正进到本机（含口令派生的）同步码里。 */
        const okp = await Sync.pushAll(true);
        const bits = [];
        if (res.added.hist) bits.push(res.added.hist + ' 个对话');
        if (res.added.kb) bits.push(res.added.kb + ' 条知识库');
        if (res.added.rules) bits.push(res.added.rules + ' 条法则');
        const what = bits.length ? ('新增 ' + bits.join('、')) : '偏好设置已对齐';
        const tail = res.added.hist > 0 ? '；已切到最新恢复的对话' : '';
        toast(okp
          ? ('恢复完成：' + what + tail)
          : ('恢复完成：' + what + '；但回写云端失败：' + (Sync.lastError() || '未知错误')), 7000);
        $('#modal-code').classList.add('hidden');
        refreshUI();
      } catch (e) {
        const m = (e && e.code === 'NO_SUCH_CODE')
          ? ('同步码 ' + want + ' 不存在（云端没有这个码）。请核对 12 位码有没有抄错')
          : (e && e.code === 'BAD_CODE')
            ? '同步码格式不对：必须是 12 位，且只含 A–Z 与 2–7（数字 0/1/8/9 不合法）'
            : e.message;
        toast('恢复失败：' + m, 7000);
      }
    });
    $('#me-model').addEventListener('change', (ev) => { State.s.model = ev.target.value; State.save(); Sync.markDirty('settings'); });
    $('#me-models-refresh').addEventListener('click', () => refreshModels(false));
    $('#me-digest-on').addEventListener('change', (ev) => { State.s.digestOn = ev.target.checked; State.save(); Sync.markDirty('settings'); });
    $('#me-kb-on').addEventListener('change', (ev) => { State.s.kbOn = ev.target.checked; State.save(); Sync.markDirty('settings'); });
    const rSw = $('#me-remember-on');
    if (rSw) rSw.addEventListener('change', (ev) => { State.s.rememberOn = ev.target.checked; State.save(); Sync.markDirty('settings'); });
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
    /* 安卓壳内：网页是 file:///android_asset/web/ 下的内嵌副本，相对路径 ./android/wenshi.apk
       会解析到不存在的内嵌文件 → 点「下载 APK」必然失败。改走原生 DownloadManager。 */
    const apkDl = $('#me-apk-dl');
    if (apkDl) apkDl.addEventListener('click', (ev) => {
      const sh = window.wsShell;
      if (sh && typeof sh.downloadApk === 'function') {
        ev.preventDefault();
        try { sh.downloadApk(); toast('开始下载安装包…'); }
        catch (e) { toast('下载失败：' + e.message); }
      }
      /* 网页版不拦截：走 <a download> 的正常下载 */
    });
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
  function filtered() {
    const q = ($('#sess-search') ? $('#sess-search').value : '').trim().toLowerCase();
    let list = Sessions.all().slice();
    if (q) {
      list = list.filter(s => {
        const hay = displayTitle(s) + ' ' + (s.msgs || []).map(m => String(m.content || '')).join(' ');
        return hay.toLowerCase().includes(q);
      });
    }
    return list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
  }
  function render() {
    const total = Sessions.all();
    const list = filtered();
    const q = ($('#sess-search') ? $('#sess-search').value : '').trim();
    const cnt = $('#sess-count');
    if (cnt) cnt.textContent = q ? (list.length + '/' + total.length + ' 个') : (total.length + ' 个');
    const wrap = $('#sess-list');
    if (!wrap) return;
    wrap.innerHTML = list.length
      ? list.map(s => `
        <div class="sess-item ${s.id === Sessions.curId() ? 'on' : ''}" data-sess="${esc(s.id)}">
          <div class="sess-main">
            <div class="sess-title">${s.pinned ? '<span class="sess-pin">置顶</span>' : ''}${esc(displayTitle(s))}</div>
            <div class="sess-meta">${(s.msgs || []).length} 条 · ${fmtTs(s.ts || 0)}</div>
          </div>
          <div class="sess-acts">
            <button class="mini-btn" data-sess-pin="${esc(s.id)}">${s.pinned ? '取消置顶' : '置顶'}</button>
            <button class="mini-btn" data-sess-rename="${esc(s.id)}">改名</button>
            <button class="mini-btn" data-sess-export="${esc(s.id)}">导出</button>
            <button class="mini-btn danger" data-sess-del="${esc(s.id)}">删除</button>
          </div>
        </div>`).join('')
      : `<div class="tip">${q ? '没有匹配的对话' : '还没有历史对话'}</div>`;
  }
  /* 打开面板时顺手把旧式标题持久化升级一遍（幂等；显示层已能现算，
     这一步是为了让改好的标题也真正存进本地与云端，导出文件也用得上） */
  function open() {
    try { Sessions.migrateTitles(); } catch (e) { /* 升级失败不该挡住面板 */ }
    render();
    $('#modal-sess').classList.remove('hidden');
  }
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
    const srch = $('#sess-search');
    if (srch) srch.addEventListener('input', render);
    const scl = $('#modal-sess-close');
    if (scl) scl.addEventListener('click', close);
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
      const pin = ev.target.closest('[data-sess-pin]');
      if (pin) {
        ev.stopPropagation();
        const id = pin.getAttribute('data-sess-pin');
        const s = Sessions.all().find(x => x.id === id);
        Sessions.setPinned(id, !(s && s.pinned));
        render();
        return;
      }
      const rn = ev.target.closest('[data-sess-rename]');
      if (rn) {
        ev.stopPropagation();
        const id = rn.getAttribute('data-sess-rename');
        const s = Sessions.all().find(x => x.id === id);
        const t = prompt('给这段对话起个名字：', displayTitle(s));
        if (t == null) return;
        Sessions.rename(id, t);
        render();
        return;
      }
      const ex = ev.target.closest('[data-sess-export]');
      if (ex) {
        ev.stopPropagation();
        const r = Sessions.exportMd(ex.getAttribute('data-sess-export'));
        if (!r) return;
        const blob = new Blob([r.text], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = r.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('已导出 ' + r.name);
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
  return { bind, open, close, render };
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
  /* 把旧式的"截前16字"标题升级成可读标题（幂等；手动改过名的不受影响） */
  try { Sessions.migrateTitles(); } catch (e) { /* 标题升级失败不该影响启动 */ }
  Chat.bind(); KB.bind(); Me.bind(); SessPanel.bind(); Safety.bind();
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

  /* 弹窗点背景关闭 */
  $$('.modal').forEach(m => m.addEventListener('click', (ev) => { if (ev.target === m) m.classList.add('hidden'); }));

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    /* 新 SW 接管后自动刷新一次：被旧缓存钉住的界面靠这一步解开，无需用户手动清缓存 */
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      location.reload();
    });
    /* updateViaCache:'none' —— 更新检查时不走 HTTP 缓存，确保能拿到新的 sw.js */
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      const showBar = () => {
        const bar = $('#web-update-bar');
        if (!bar || !bar.classList.contains('hidden')) return;
        bar.classList.remove('hidden');
        bar.textContent = '网页版有新版本，点此刷新';
        bar.onclick = () => location.reload();
      };
      /* 立即查一次：浏览器默认最长 24h 才检查 sw.js，等不起 */
      reg.update().catch(() => {});
      if (reg.waiting && navigator.serviceWorker.controller) showBar();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showBar();
        });
      });
      setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    }).catch(() => {});
  }
}
document.addEventListener('DOMContentLoaded', boot);
