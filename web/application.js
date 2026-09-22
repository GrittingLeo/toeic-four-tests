import {
  emptyState,
  newSession,
  score,
  finishSession,
  recordQuestions,
  reviewIds,
  remainingSeconds,
  formatTime,
} from "./engine.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const main = $("#main"),
  player = $("#player");
let state = emptyState(),
  revision = 0,
  banks = [],
  vocabulary = [],
  audioIndex = {},
  loaded = false,
  dirty = false,
  saving = false,
  saveTimer,
  saveError = false,
  review = null;
let setupTest = 1,
  readerMode = "text",
  readerZoom = 1,
  readerPositions = {},
  renderedGroup = null,
  wordIndex = 0,
  wordRevealed = false,
  wordQuery = "",
  wordUnmastered = false,
  mistakePart = "",
  mistakeTag = "",
  mistakeUnresolved = true;
const STORAGE_KEY = "toeic-four-tests-v1";
function validState(value) {
  if (
    !value ||
    value.schema !== 1 ||
    !Array.isArray(value.history) ||
    value.history.length > 1000 ||
    !value.mistakes ||
    typeof value.mistakes !== "object" ||
    !value.words ||
    typeof value.words !== "object"
  )
    return false;
  if(!Object.entries(value.words).every(([id,flag])=>vocabulary.some(w=>w.id===id)&&typeof flag==='boolean'))return false;
  if(!Object.entries(value.mistakes).every(([id,m])=>{const q=banks.flatMap(b=>b.questions).find(q=>q.id===id);return q&&m&&m.id===id&&m.number===q.number&&m.part===q.part&&m.test===Number(id[1])&&m.tag===q.tag&&Number.isSafeInteger(m.wrongCount)&&m.wrongCount>=0&&Number.isSafeInteger(m.streak)&&m.streak>=0&&typeof m.resolved==='boolean';}))return false;
  return [value.active, ...value.history].filter(Boolean).every((s) => {
    const b = bankFor(s.test);
    const valid = (
      b && Number.isInteger(s.test) &&
      typeof s.id === "string" &&
      /^[\w-]+$/.test(s.id) &&
      Array.isArray(s.ids) &&
      s.ids.length > 0 &&
      new Set(s.ids).size === s.ids.length &&
      s.ids.every((id) => b.questions.some((q) => q.id === id)) &&
      Number.isInteger(s.index) &&
      s.index >= 0 &&
      s.index < s.ids.length &&
      s.answers &&
      Object.entries(s.answers).every(
        ([id, a]) =>
          s.ids.includes(id) &&
          b.questions
            .find((q) => q.id === id)
            ?.options.some((o) => o.key === a),
      ) &&
      ["practice", "exam"].includes(s.mode) &&
      ["full", "reading", "listening"].includes(s.section) &&
      ["active", "complete"].includes(s.status) &&
      Array.isArray(s.marked) &&
      Array.isArray(s.revealed) &&
      Array.isArray(s.recorded) &&
      (s.deadline===null||Number.isFinite(s.deadline)) &&
      (s.status!=='complete'||(s.result&&Array.isArray(s.result.byPart)&&Number.isFinite(s.finishedAt)))
    );
    if(valid&&s.status==='complete')s.result=score(s,b);
    return valid;
  });
}
const partNames = [
  "",
  "图片描述",
  "应答问题",
  "简短对话",
  "谈话与发言",
  "句子填空",
  "段落填空",
  "阅读理解",
];
const bankFor = (t) => banks.find((b) => b.test === Number(t));
const toast = (message) => {
  const el = $("#notification");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 5000);
};
function save() {
  dirty = true;
  clearTimeout(saveTimer);
  $("#save-status").textContent = "正在保存…";
  saveTimer = setTimeout(flush, 350);
}
async function flush() {
  if (saving || !dirty || !loaded || saveError) return;
  saving = true;
  dirty = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("#save-status").textContent = "已保存到此浏览器";
  } catch (e) {
    dirty = true;
    $("#save-status").textContent = "未保存 · 点击重试";
    toast(e.message + " 当前答案仍留在页面中。");
  } finally {
    saving = false;
    if (dirty && !saveError)
      (clearTimeout(saveTimer), (saveTimer = setTimeout(flush, 5000)));
  }
}
function confirmAction(title, message, action, label = "确认") {
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  $("#confirm-ok").textContent = label;
  $("#confirm-cancel").textContent = "取消";
  $("#confirm-dialog").showModal();
  $("#confirm-ok").onclick = () => {
    $("#confirm-dialog").close();
    action();
  };
  $("#confirm-cancel").onclick = () => $("#confirm-dialog").close();
}
function setRoute(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function home() {
  const wrong = Object.values(state.mistakes).filter((m) => !m.resolved).length;
  main.innerHTML = `<div class="heading"><div><p class="eyebrow">LISTENING & READING</p><h1>今天，从哪一套开始？</h1><p>四套原书模拟题，练习与复盘都在这里。</p></div><button class="button secondary" data-action="export">备份学习记录</button></div>${state.active ? `<div class="resume"><div><strong>继续第 ${state.active.test} 套 · ${state.active.mode === "exam" ? "模拟考试" : "自由练习"}</strong><p>已答 ${Object.keys(state.active.answers).length} / ${state.active.ids.length} 题</p></div><button class="button" data-action="resume">继续上次练习</button></div>` : ""}<div class="stats"><div class="stat"><span class="stat-label">已完成练习</span><strong>${state.history.length}</strong><small>次</small></div><div class="stat"><span class="stat-label">待复习错题</span><strong>${wrong}</strong><small>题</small></div><div class="stat"><span class="stat-label">已掌握词汇</span><strong>${Object.values(state.words).filter(Boolean).length}</strong><small>个</small></div></div><div class="book-grid">${banks.map((b) => `<article class="book-card"><div class="book-head"><span class="book-number">ACTUAL TEST 0${b.test}</span><span class="tag ready">200 题已就绪</span></div><h2>第 ${b.test} 套</h2><p>听力 100 题 · 阅读 100 题</p><div class="book-meta"><span>原书图片与录音</span><span>逐题中文解析</span></div><div class="book-actions"><button class="button" data-action="setup" data-test="${b.test}" data-section="full">整套练习</button><button class="button secondary" data-action="setup" data-test="${b.test}" data-section="listening">听力专项</button><button class="button secondary" data-action="setup" data-test="${b.test}" data-section="reading">阅读专项</button></div></article>`).join("")}</div><p class="source-note">题目来自《新托业全真题库》，为出版模拟试题，非 ETS 官方历年真题。仅供个人学习。</p><div class="backup-row"><label class="button secondary" for="restore-file">恢复学习记录</label><input id="restore-file" type="file" accept="application/json" hidden></div>`;
}
function setup(test, section) {
  setupTest = Number(test);
  $("#setup-title").textContent =
    `第 ${test} 套 · ${section === "full" ? "整套练习" : section === "listening" ? "听力专项" : "阅读专项"}`;
  $("#setup-section").value = section;
  $("#setup-mode").value = "practice";
  $("#setup-dialog").showModal();
}
function start(test, section, mode, ids = null) {
  const action = () => {
    state.active = newSession(bankFor(test), section, mode, ids);
    review = null;
    renderedGroup = null;
    player.pause();
    delete player.dataset.stopAt;
    player.removeAttribute("src");
    save();
    setRoute("#practice");
  };
  if (state.active)
    confirmAction(
      "开始新的练习？",
      "当前未交卷练习将被替换。已保存的历史成绩和错题不会删除。",
      action,
      "开始新练习",
    );
  else action();
}
const currentSession = () => review || state.active;
function currentQuestion() {
  const s = currentSession();
  return s
    ? bankFor(s.test).questions.find((q) => q.id === s.ids[s.index])
    : null;
}
function sourceImage(im) {
  const [x, y, x2, y2] = im.box;
  return `<button class="source-image-button" data-action="image" data-src="${im.src}" data-page="${im.page}" aria-label="放大原书第 ${im.page - 13} 页"><span class="source-crop" style="aspect-ratio:${(x2 - x) / (y2 - y)}"><img src="${im.src}" alt="原书第 ${im.page - 13} 页" loading="lazy" style="width:${(im.width / (x2 - x)) * 100}%;left:${(-x / (x2 - x)) * 100}%;top:${(-y / (y2 - y)) * 100}%"></span></button>`;
}
function readableText(text) {
  const lines=text.split(/\n+/).filter(l=>l.trim()&&!/^\d+$/.test(l.trim())),paragraphs=[];
  for(const line of lines){const previous=paragraphs.at(-1);if(previous&&previous.length>55&&!/[.!?：:]$/.test(previous.trim()))paragraphs[paragraphs.length-1]+=' '+line.trim();else paragraphs.push(line.trim());}
  return paragraphs.map(line=>`<p>${esc(line)}</p>`).join('');
}
function captureReading() {
  const el = $(".reading-scroll");
  if (el && renderedGroup)
    readerPositions[renderedGroup] = { top: el.scrollTop, left: el.scrollLeft };
}
function practice() {
  const s = currentSession();
  if (!s) {
    setRoute("#home");
    return;
  }
  const bank = bankFor(s.test),
    q = { ...currentQuestion() },
    g = { ...bank.groups.find((g) => g.id === q.groupId) },
    done = s.status === "complete",
    shown = done || s.revealed.includes(g.id),
    isExam = s.mode === "exam" && !done;
  q.extra = [q.extra, g.transcript].filter(Boolean).join("\n\n");
  if(q.part===6)for(let n=g.start;n<=g.end;n++)g.text=g.text.replace(new RegExp(`\\b${n}\\b(?![.,]\\s*\\d)`,'g'),`【____ ${n} ____】`);
  captureReading();
  renderedGroup = g.id;
  const groupIds = bank.questions
    .filter((x) => x.groupId === g.id && s.ids.includes(x.id))
    .map((x) => x.id);
  const allAnswered = groupIds.every((id) => s.answers[id]);
  const isText = g.text && /[A-Za-z]/.test(g.text) && g.text.length > 80;
  const material = g.images.length
    ? `<div class="reader-toolbar"><div class="segmented"><button data-action="reader-text" aria-pressed="${readerMode === "text"}" ${!isText ? "disabled" : ""}>文字阅读</button><button data-action="reader-image" aria-pressed="${readerMode === "image" || !isText}">原书排版</button></div><button class="button secondary small" data-action="reader-full">全屏阅读</button><button class="button secondary small" data-action="zoom-out" aria-label="缩小材料">A−</button><button class="button secondary small" data-action="zoom-in" aria-label="放大材料">A＋</button></div><div class="reading-scroll">${readerMode === "text" && isText ? `<div class="passage-text" style="font-size:${1.075 * readerZoom}rem"><p class="reader-note">文字版便于阅读；表格、图示及聊天版式请切换「原书排版」核对。</p>${readableText(g.text)}</div>` : `<div style="width:${100 * readerZoom}%;min-width:100%">${g.images.map(sourceImage).join("")}</div>`}</div>`
    : `<div class="audio-instruction"><div class="sound-symbol" aria-hidden="true">♫</div><h2>听录音，选出合适的回答</h2><p>Part 2 的题干和选项仅在录音中出现。${shown ? "下方可查看原书解析与听力文本。" : "提交后可查看原书解析。"}</p></div>`;
  const qids = s.ids.filter((id) => {
    const n = Number(id.split("q")[1]);
    return (
      !isExam ||
      s.section !== "full" ||
      (s.phase === "listening" ? n <= 100 : n > 100)
    );
  });
  main.innerHTML = `<div class="practice-title"><div><p class="eyebrow">ACTUAL TEST 0${s.test} · PART ${q.part} ${partNames[q.part]}</p><h1>${done ? "试卷复盘" : isExam ? "模拟考试" : "自由练习"}</h1></div><div class="actions"><span id="timer" class="timer"></span>${done ? '<a class="button secondary" href="#history">返回记录</a>' : '<button class="button secondary" data-action="save-exit">保存并返回</button><button class="button" data-action="submit">交卷</button>'}</div></div><div class="practice-layout"><section class="reading-panel"><div class="panel-heading"><h2>${q.part <= 4 ? "听力材料" : q.part === 5 ? "原题核对" : "阅读材料"}</h2><span>${g.start === g.end ? `第 ${g.start} 题` : `第 ${g.start}–${g.end} 题`}</span></div>${material}</section><section class="question-panel"><div class="question-top"><p class="question-count">QUESTION ${q.number} <span>/ ${s.ids.length} 题</span></p><button class="mark-button ${s.marked.includes(q.id) ? "marked" : ""}" data-action="mark" aria-pressed="${s.marked.includes(q.id)}" ${done ? "disabled" : ""}>${s.marked.includes(q.id) ? "★ 已标记" : "☆ 复查"}</button></div><h2 class="question-stem">${esc(q.part === 6 ? `请为原文第 ${q.number} 空选择答案。` : q.stem)}</h2><div class="options" role="group" aria-label="第 ${q.number} 题选项">${q.options.map((o) => `<button class="option ${s.answers[q.id] === o.key ? "selected" : ""} ${shown && o.key === q.answer ? "correct" : ""} ${shown && s.answers[q.id] === o.key && o.key !== q.answer ? "incorrect" : ""}" data-answer="${o.key}" aria-pressed="${s.answers[q.id] === o.key}" ${shown ? "disabled" : ""}><span class="option-key">${o.key}</span><span>${esc(o.text)}${shown && o.key === q.answer ? " <strong>✓ 正确答案</strong>" : ""}</span></button>`).join("")}</div>${!isExam && !shown ? `<button class="button reveal-button" data-action="reveal" ${!allAnswered ? "disabled" : ""}>${groupIds.length > 1 ? "提交本组，查看解析" : "提交答案，查看解析"}</button>${!allAnswered && groupIds.length > 1 ? '<p class="muted">完成本组全部题目后揭晓，避免提前看到答案。</p>' : ""}` : ""}${shown ? `<section class="explanation"><div class="answer-summary">正确答案 ${q.answer} · ${!s.answers[q.id] ? "未作答" : s.answers[q.id] === q.answer ? "回答正确" : "需要复习"}</div><p class="explanation-tag">${esc(q.tag)} <span>${"★".repeat(q.difficulty)}</span></p><h3>原书中文解析</h3><p>${esc(q.text).replace(/\n/g, "<br>")}</p>${q.extra ? `<details><summary>原书词汇、听力文本与补充内容</summary><div class="extra-text">${esc(q.extra)}</div></details>` : ""}<button class="button secondary small" data-action="explanation-source" data-page="${q.explanationPage}">查看解析原页</button></section>` : ""}<div class="question-actions"><button class="button secondary" data-action="prev" ${s.index === 0 ? "disabled" : ""}>上一题</button><button class="button" data-action="next" ${s.index === s.ids.length - 1 ? "disabled" : ""}>下一题</button></div><div class="group-tabs">${groupIds
    .map((id) => {
      const x = bank.questions.find((x) => x.id === id);
      return `<button class="button small ${id === q.id ? "" : "secondary"}" data-jump="${id}">${x.number}${s.answers[id] ? " ✓" : ""}</button>`;
    })
    .join(
      "",
    )}</div><p class="muted">快捷键 1–4 选答案 · ← → 切题 · M 标记</p></section></div><details class="answer-sheet" ${s.ids.length <= 6 ? "open" : ""}><summary>答题卡 · 已答 ${Object.keys(s.answers).length} / ${s.ids.length} · 标记 ${s.marked.length}</summary><div class="answer-grid">${qids
    .map((id) => {
      const x = bank.questions.find((q) => q.id === id);
      return `<button class="answer-cell ${id === q.id ? "current" : ""} ${s.answers[id] ? "answered" : ""} ${s.marked.includes(id) ? "flagged" : ""} ${done && s.answers[id] !== x.answer ? "wrong" : ""}" data-jump="${id}" aria-label="第 ${x.number} 题${s.answers[id] ? "已答" : "未答"}">${x.number}</button>`;
    })
    .join("")}</div></details>`;
  const saved = readerPositions[g.id];
  if (saved && $(".reading-scroll")) {
    $(".reading-scroll").scrollTop = saved.top;
    $(".reading-scroll").scrollLeft = saved.left;
  }
  configureAudio(s, q, g, done);
  updateTimer();
}
function configureAudio(s, q, g, done) {
  $("#audio-dock").hidden = q.part > 4;
  if (q.part > 4) {
    player.pause();
    return;
  }
  const src = `media/test${s.test}.mp3`;
  if (player.getAttribute("src") !== src) {
    player.src = src;
    player.onloadedmetadata = () => {
      if (s.audioTime)
        player.currentTime = Math.min(
          s.audioTime,
          player.duration || s.audioTime,
        );
    };
  }
  const exam = s.mode === "exam" && !done;
  player.controls = !exam;
  player.playbackRate = 1;
  $("#audio-label").textContent =
    `第 ${s.test} 套原录音 · ${g.start === g.end ? "第 " + g.start + " 题" : "第 " + g.start + "–" + g.end + " 题"}`;
  $("#play-group").hidden = exam;
  $("#start-audio").hidden = !exam;
  $("#start-audio").textContent = player.paused
    ? "开始 / 继续听力"
    : "录音播放中";
  $("#start-audio").disabled = !player.paused;
  $("#to-reading").hidden = !(exam && s.section === "full");
  const cue = audioIndex[s.test]?.groups?.[g.start];
  $("#play-group").disabled = !cue;
  $("#audio-note").textContent = exam
    ? "录音连续播放；听力结束后进入阅读。"
    : "可暂停、拖动进度，或重听当前题组。";
}
function updateTimer() {
  const el = $("#timer"),
    s = currentSession();
  if (!el || !s) return;
  const seconds = remainingSeconds(s);
  el.textContent =
    s.status === "complete"
      ? "已完成"
      : seconds !== null
        ? "阅读剩余 " + formatTime(seconds)
        : s.mode === "exam"
          ? "听力按原录音时长"
          : "不限时";
  el.classList.toggle("urgent", seconds !== null && seconds < 300);
  if (seconds === 0 && s.status === "active") {
    submit(true);
  }
}
function switchToReading() {
  const s = state.active;
  if (!s || s.phase === "reading") return;
  if (s.section === "full") {
    s.phase = "reading";
    s.index = s.ids.findIndex((id) => Number(id.split("q")[1]) > 100);
    s.deadline = Date.now() + 75 * 60000;
    player.pause();
    save();
    practice();
    toast("听力结束，阅读计时 75 分钟已开始。");
  } else submit(true);
}
function submit(auto = false) {
  const s = state.active;
  if (!s) return;
  const run = () => {
    player.pause();
    const completed = finishSession(state, bankFor(s.test));
    save();
    review = completed;
    setRoute("#result/" + completed.id);
  };
  if (auto) run();
  else
    confirmAction(
      "确认交卷？",
      `还有 ${s.ids.length - Object.keys(s.answers).length} 题未作答。交卷后将显示答案和解析。`,
      run,
      "确认交卷",
    );
}
function result(id) {
  const s = state.history.find((x) => x.id === id);
  if (!s) {
    home();
    return;
  }
  const r = s.result;
  main.innerHTML = `<div class="heading"><div><p class="eyebrow">ACTUAL TEST 0${s.test} · REVIEW</p><h1>这次练习，完成了。</h1><p>先看薄弱题型，再回到具体的题。</p></div><a class="button secondary" href="#home">返回试卷</a></div><div class="result-hero"><div><span>正确率</span><strong>${r.accuracy}<small>%</small></strong></div><div><h2>${r.correct} / ${r.total} 题正确</h2><p>已答 ${r.answered} 题 · 未答 ${r.unanswered} 题</p><p class="muted">这里记录练习表现，不换算官方 TOEIC 分数。</p></div></div><div class="part-results">${r.byPart.map((p) => `<div class="panel"><h3>Part ${p.part} · ${partNames[p.part]}</h3><strong>${p.correct} / ${p.total}</strong><div class="progress"><span style="width:${(p.correct / p.total) * 100}%"></span></div></div>`).join("")}</div><div class="actions"><button class="button" data-action="review-session" data-id="${s.id}">逐题看解析</button><button class="button secondary" data-action="review-wrong" data-id="${s.id}">复习本次错题</button></div>`;
}
function mistakes() {
  const all = Object.values(state.mistakes),
    tags = [
      ...new Set(
        all
          .filter((m) => !mistakePart || m.part === Number(mistakePart))
          .map((m) => m.tag),
      ),
    ].sort();
  const list = all
    .filter(
      (m) =>
        (!mistakeUnresolved || !m.resolved) &&
        (!mistakePart || m.part === Number(mistakePart)) &&
        (!mistakeTag || m.tag === mistakeTag),
    )
    .sort((a, b) => b.wrongCount - a.wrongCount || b.lastAt - a.lastAt);
  main.innerHTML = `<div class="heading"><div><p class="eyebrow">MISTAKE REVIEW</p><h1>把反复出错的，练明白。</h1><p>按原书考点归类；连续两次答对后标记为已巩固。</p></div></div><div class="filters"><label>题型 <select id="mistake-part"><option value="">全部 Part</option>${[1, 2, 3, 4, 5, 6, 7].map((p) => `<option value="${p}" ${mistakePart === String(p) ? "selected" : ""}>Part ${p} ${partNames[p]}</option>`).join("")}</select></label><label>考点 <select id="mistake-tag"><option value="">全部考点</option>${tags.map((t) => `<option ${mistakeTag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label><label class="check-label"><input type="checkbox" id="mistake-unresolved" ${mistakeUnresolved ? "checked" : ""}>只看未巩固</label></div>${list.length ? `<p class="muted">${list.length} 道错题 · 阅读和听力将连同完整题组一起复习</p><div class="mistake-list">${list.map((m) => `<article class="mistake-row"><div><span class="eyebrow">TEST ${m.test} · Q${m.number} · PART ${m.part}</span><h2>${esc(m.tag)}</h2><p>累计答错 ${m.wrongCount} 次 · ${m.resolved ? "已巩固" : `连续答对 ${m.streak} 次`}</p></div><button class="button secondary" data-action="retry-question" data-id="${m.id}">重练本组</button></article>`).join("")}</div>` : '<div class="empty"><h2>当前没有符合条件的错题</h2><p>完成练习后，答错的题会自动进入这里；未作答不直接认定为错题。</p><a href="#home" class="button secondary">去做一套练习</a></div>'}`;
}
function history() {
  main.innerHTML = `<div class="heading"><div><p class="eyebrow">LEARNING HISTORY</p><h1>练习记录</h1><p>每一次完成，都可以回来复盘。</p></div><button class="button secondary" data-action="export">备份学习记录</button></div>${state.history.length ? `<div class="history-list">${state.history.map((s) => `<a class="history-row" href="#result/${s.id}"><div><h2>第 ${s.test} 套 · ${s.section === "full" ? "整套" : s.section === "listening" ? "听力" : "阅读"}${s.mode === "exam" ? "模拟考试" : "练习"}</h2><p>${new Date(s.finishedAt).toLocaleString("zh-CN")} · ${s.result.total} 题</p></div><strong>${s.result.correct}<small> / ${s.result.total}</small></strong><span>查看复盘 →</span></a>`).join("")}</div>` : '<div class="empty"><h2>还没有已交卷的练习</h2><p>未完成的练习可从首页继续。</p><a href="#home" class="button secondary">返回试卷</a></div>'}`;
}
function filteredWords() {
  return vocabulary.filter(
    (w) =>
      (!wordUnmastered || !state.words[w.id]) &&
      (!wordQuery ||
        (w.term + " " + w.meaning)
          .toLowerCase()
          .includes(wordQuery.toLowerCase())),
  );
}
function words() {
  const list = filteredWords();
  wordIndex = Math.min(wordIndex, Math.max(0, list.length - 1));
  const w = list[wordIndex];
  main.innerHTML = `<div class="heading"><div><p class="eyebrow">WORDS IN CONTEXT</p><h1>在题目里，把单词记住。</h1><p>原书词汇与短语 · ${vocabulary.length} 个条目</p></div></div><div class="filters"><input id="word-query" type="search" placeholder="搜索单词或中文释义" aria-label="搜索词汇" value="${esc(wordQuery)}"><label class="check-label"><input type="checkbox" id="word-unmastered" ${wordUnmastered ? "checked" : ""}>只看未掌握</label><button class="button secondary" data-action="random-word">随机一词</button></div>${
    w
      ? `<section class="word-card"><div class="word-top"><span>${wordIndex + 1} / ${list.length}</span><span>${w.frequency ? "试题文本中出现 " + w.frequency + " 次" : "原书词汇表收录"}</span></div><h2 lang="en">${esc(w.term)}</h2><button class="meaning-cover ${wordRevealed ? "revealed" : ""}" data-action="reveal-word" aria-label="${wordRevealed ? "收起释义" : "揭晓释义"}">${wordRevealed ? esc(w.meaning) : "点击或按空格，揭晓释义"}</button><div class="actions"><button class="button ${state.words[w.id] ? "secondary" : ""}" data-action="master-word">${state.words[w.id] ? "✓ 已掌握 · 撤销" : "标记已掌握"}</button><button class="button secondary" data-action="next-word">下一个词 →</button></div>${
          w.references.length
            ? `<div class="word-references"><h3>回到题目</h3>${w.references
                .slice(0, 6)
                .map(
                  (id) =>
                    `<button class="button secondary small" data-action="retry-question" data-id="${id}">${id.replace("t", "Test ").replace("-q", " · Q")}</button>`,
                )
                .join("")}</div>`
            : ""
        }<p class="muted">频次只统计这四套试题的可提取英文文本，不代表 ETS 官方词频。</p></section>`
      : '<div class="empty"><h2>没有符合条件的词汇</h2><p>可以清空搜索或关闭「只看未掌握」。</p></div>'
  }`;
}
async function route() {
  if (!loaded) return;
  captureReading();
  const hash = location.hash.slice(1) || "home";
  document.body.classList.toggle("in-practice", hash === "practice");
  if (hash !== "practice") {
    $("#audio-dock").hidden = true;
    player.pause();
  }
  document
    .querySelectorAll("[data-nav]")
    .forEach((a) => a.classList.toggle("active", a.dataset.nav === hash));
  $("#mistake-count").textContent = Object.values(state.mistakes).filter(
    (m) => !m.resolved,
  ).length;
  $("#breadcrumb").textContent =
    "学习空间 / " +
    ({
      home: "四套练习",
      practice: "作答",
      mistakes: "错题复习",
      vocabulary: "词汇学习",
      history: "练习记录",
    }[hash] || "成绩与复盘");
  if (hash === "practice") practice();
  else if (hash === "mistakes") mistakes();
  else if (hash === "vocabulary") words();
  else if (hash === "history") history();
  else if (hash.startsWith("result/")) result(hash.slice(7));
  else home();
}
function jump(id) {
  const s = currentSession();
  if (!s || !s.ids.includes(id)) return;
  const n = Number(id.split("q")[1]);
  if (
    s.mode === "exam" &&
    s.status === "active" &&
    s.section === "full" &&
    ((s.phase === "listening" && n > 100) ||
      (s.phase === "reading" && n <= 100))
  ) {
    toast("模拟考试请按听力、阅读顺序作答。");
    return;
  }
  s.index = s.ids.indexOf(id);
  if (!review) save();
  practice();
}
function answer(key) {
  const s = currentSession(),
    q = currentQuestion();
  if (
    !s ||
    s.status === "complete" ||
    s.revealed.includes(q.groupId) ||
    !q.options.some((o) => o.key === key)
  )
    return;
  s.answers[q.id] = key;
  save();
  practice();
}
function exportState() {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "toeic-four-tests",
            exportedAt: new Date().toISOString(),
            state,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "toeic-learning-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function retryQuestions(test, ids) {
  const bank = bankFor(test);
  start(
    test,
    ids.some((id) => Number(id.split("q")[1]) <= 100) ? "full" : "reading",
    "practice",
    reviewIds(bank, ids),
  );
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button,a");
  if (!b) return;
  if (b.dataset.answer) {
    answer(b.dataset.answer);
    return;
  }
  if (b.dataset.jump) {
    jump(b.dataset.jump);
    return;
  }
  const a = b.dataset.action,
    s = currentSession(),
    q = currentQuestion();
  if (a === "setup") setup(b.dataset.test, b.dataset.section);
  if (a === "resume") {
    review = null;
    setRoute("#practice");
  }
  if (a === "save-exit") {
    save();
    await flush();
    setRoute("#home");
  }
  if (a === "submit") submit();
  if (a === "prev" || a === "next") {
    const index = s.index + (a === "next" ? 1 : -1);
    if (index >= 0 && index < s.ids.length) jump(s.ids[index]);
  }
  if (a === "mark" && s && s.status === "active") {
    s.marked = s.marked.includes(q.id)
      ? s.marked.filter((id) => id !== q.id)
      : [...s.marked, q.id];
    save();
    practice();
  }
  if (a === "reveal") {
    const g = q.groupId,
      bank = bankFor(s.test),
      ids = bank.questions
        .filter((x) => x.groupId === g && s.ids.includes(x.id))
        .map((x) => x.id);
    if (ids.every((id) => s.answers[id])) {
      s.revealed.push(g);
      recordQuestions(state, s, bank, ids);
      save();
      practice();
    }
  }
  if (a === "reader-image" || a === "reader-text") {
    readerMode = a === "reader-image" ? "image" : "text";
    readerPositions = {};
    practice();
  }
  if (a === "zoom-in" || a === "zoom-out") {
    readerZoom = Math.max(
      0.85,
      Math.min(2.5, readerZoom + (a === "zoom-in" ? 0.15 : -0.15)),
    );
    practice();
  }
  if (a === "reader-full") {
    $(".reading-panel").classList.toggle("reader-fullscreen");
    b.textContent = $(".reading-panel").classList.contains("reader-fullscreen")
      ? "退出全屏"
      : "全屏阅读";
  }
  if (a === "image" || a === "explanation-source") {
    const page = Number(b.dataset.page);
    $("#expanded-image").src =
      a === "image"
        ? b.dataset.src
        : `images/p${String(page).padStart(3, "0")}.webp`;
    $("#expanded-image").alt = `原书第 ${page - 13} 页`;
    $("#image-caption").textContent =
      `原书第 ${page - 13} 页 · 可横向滚动查看原图`;
    $("#image-dialog").showModal();
  }
  if (a === "review-session") {
    review = structuredClone(state.history.find((x) => x.id === b.dataset.id));
    review.index = 0;
    setRoute("#practice");
  }
  if (a === "review-wrong") {
    const h = state.history.find((x) => x.id === b.dataset.id),
      bank = bankFor(h.test),
      ids = h.ids.filter(
        (id) =>
          h.answers[id] !== bank.questions.find((q) => q.id === id).answer,
      );
    if (!ids.length) toast("本次全部答对，没有需要重练的题。");
    else retryQuestions(h.test, ids);
  }
  if (a === "retry-question")
    retryQuestions(Number(b.dataset.id[1]), [b.dataset.id]);
  if (a === "export") exportState();
  if (a === "reveal-word") {
    wordRevealed = !wordRevealed;
    words();
  }
  if (a === "master-word") {
    const w = filteredWords()[wordIndex];
    if (w) {
      state.words[w.id] = !state.words[w.id];
      save();
      words();
    }
  }
  if (a === "next-word" || a === "random-word") {
    const len = filteredWords().length;
    wordIndex =
      a === "random-word"
        ? Math.floor(Math.random() * len)
        : (wordIndex + 1) % Math.max(1, len);
    wordRevealed = false;
    words();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "mistake-part") {
    mistakePart = el.value;
    mistakeTag = "";
    mistakes();
  }
  if (el.id === "mistake-tag") {
    mistakeTag = el.value;
    mistakes();
  }
  if (el.id === "mistake-unresolved") {
    mistakeUnresolved = el.checked;
    mistakes();
  }
  if (el.id === "word-unmastered") {
    wordUnmastered = el.checked;
    wordIndex = 0;
    wordRevealed = false;
    words();
  }
  if (el.id === "restore-file" && el.files[0]) {
    const file = el.files[0];
    if (file.size > 4000000) {
      toast("备份文件过大。");
      return;
    }
    file
      .text()
      .then((text) => {
        const data = JSON.parse(text);
        if (
          data.format !== "toeic-four-tests" ||
          !validState(data.state)
        )
          throw Error("备份格式不正确");
        confirmAction(
          "恢复学习记录？",
          "将用备份替换当前学习记录。建议先导出当前记录。",
          () => {
            state = data.state;
            save();
            route();
          },
          "恢复备份",
        );
      })
      .catch((e) => toast(e.message));
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "word-query") {
    wordQuery = e.target.value;
    wordIndex = 0;
    wordRevealed = false;
    clearTimeout(words.timer);
    const position = e.target.selectionStart;
    words.timer = setTimeout(() => {
      words();
      $("#word-query").focus();
      $("#word-query").setSelectionRange(position, position);
    }, 300);
  }
});
document.addEventListener("keydown", (e) => {
  if(e.key==='Escape')$('.reader-fullscreen')?.classList.remove('reader-fullscreen');
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $("dialog[open]"))
    return;
  if (location.hash === "#practice") {
    const s = currentSession();
    if (/^[1-4]$/.test(e.key)) {
      e.preventDefault();
      answer("ABCD"[Number(e.key) - 1]);
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const index = s.index + (e.key === "ArrowRight" ? 1 : -1);
      if (index >= 0 && index < s.ids.length) jump(s.ids[index]);
    }
    if (e.key.toLowerCase() === "m") $('[data-action="mark"]')?.click();
  }
  if (location.hash === "#vocabulary" && e.code === "Space") {
    e.preventDefault();
    wordRevealed = !wordRevealed;
    words();
  }
});
$("#begin-session").onclick = () => {
  $("#setup-dialog").close();
  start(setupTest, $("#setup-section").value, $("#setup-mode").value);
};
$("#save-status").onclick = () => {
  if (saveError) toast("记录存在冲突，请先备份当前记录，再刷新加载最新记录。");
  else flush();
};
$("#start-audio").onclick = () =>
  player
    .play()
    .then(() => {
      practice();
    })
    .catch(() => toast("录音未能播放，请重试。"));
$("#play-group").onclick = () => {
  const s = currentSession(),
    q = currentQuestion(),
    g = bankFor(s.test).groups.find((g) => g.id === q.groupId),
    cue = audioIndex[s.test]?.groups?.[g.start];
  if (!cue) return;
  player.currentTime = cue.start;
  player.dataset.stopAt = cue.end;
  player.play().catch(() => toast("录音暂时无法播放。"));
};
$("#to-reading").onclick = () =>
  confirmAction(
    "提前结束听力？",
    "进入阅读后将开始 75 分钟计时，模拟考试中不能返回听力作答。",
    switchToReading,
    "进入阅读",
  );
let lastAudioSave = 0;
player.ontimeupdate = () => {
  const s = currentSession();
  if (!s) return;
  if (s.mode === "practice" || s.status === "complete") {
    if (
      player.dataset.stopAt &&
      player.currentTime >= Number(player.dataset.stopAt)
    ) {
      player.pause();
      delete player.dataset.stopAt;
    }
  }
  if (!review) {
    s.audioTime = player.currentTime;
    if (Date.now() - lastAudioSave > 5000) {
      lastAudioSave = Date.now();
      save();
    }
  }
};
player.onended = () => {
  if (!review && state.active?.mode === "exam") switchToReading();
};
player.onerror = () => toast("录音加载失败，请检查网络后重试。");
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => {
  if (dirty || saving) {
    e.preventDefault();
    e.returnValue = "";
  }
});
setInterval(updateTimer, 1000);
async function init() {
  try {
    main.innerHTML = '<div class="empty"><h1>正在打开学习空间…</h1></div>';
    const results = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => fetch(`data/test${i + 1}.json`)),
      fetch("data/vocabulary.json"),
      fetch("data/audio.json"),
    ]);
    if (results.some((r) => !r.ok)) throw Error("资料或学习记录暂时无法加载。");
    const data = await Promise.all(results.map((r) => r.json()));
    banks = data.slice(0, 4);
    vocabulary = data[4];
    audioIndex = data[5];
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      state = saved ? JSON.parse(saved) : emptyState();
      if (!validState(state)) throw Error();
    } catch {
      state = emptyState();
      toast("无法读取此浏览器的记录；可以通过备份恢复。");
    }
    loaded = true;
    $("#save-status").textContent = "仅保存在此浏览器";
    route();
    registerTools();
  } catch (e) {
    main.innerHTML = `<div class="empty"><h1>暂时无法打开学习空间</h1><p>${esc(e.message)}</p><button class="button" id="retry-load">重新加载</button></div>`;
    $("#retry-load").onclick = init;
  }
}
function registerTools() {
  const context = navigator.modelContext || document.modelContext;
  if (!context?.registerTool) return;
  try {
    context.registerTool({
      name: "get_learning_progress",
      description:
        "Read completed practice counts and unresolved mistake totals; does not reveal exam answers.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        if (!input || Object.keys(input).length)
          throw Error("No arguments expected");
        return {
          completed: state.history.length,
          mistakes: Object.values(state.mistakes).filter((m) => !m.resolved)
            .length,
          mastered: Object.values(state.words).filter(Boolean).length,
        };
      },
    });
  } catch (e) {
    console.warn("Learning tool unavailable", e.message);
  }
}
init();
