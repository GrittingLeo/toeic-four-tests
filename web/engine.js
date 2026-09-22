export const emptyState = () => ({
  schema: 1,
  active: null,
  history: [],
  mistakes: {},
  words: {},
});
export const questionIds = (bank, section) =>
  bank.questions
    .filter(
      (q) =>
        section === "full" ||
        (section === "listening" ? q.number <= 100 : q.number > 100),
    )
    .map((q) => q.id);
export function newSession(
  bank,
  section = "full",
  mode = "practice",
  ids = null,
) {
  const list = ids || questionIds(bank, section);
  return {
    id: crypto.randomUUID(),
    test: bank.test,
    section,
    mode,
    ids: list,
    index: 0,
    answers: {},
    marked: [],
    revealed: [],
    startedAt: Date.now(),
    phase: section === "reading" ? "reading" : "listening",
    deadline:
      mode === "exam" && section === "reading" ? Date.now() + 75 * 60000 : null,
    audioTime: 0,
    elapsedByQuestion: {},
    recorded: [],
    status: "active",
  };
}
export function score(session, bank) {
  const qs = bank.questions.filter((q) => session.ids.includes(q.id));
  const byPart = Array.from({ length: 7 }, (_, i) => {
    const items = qs.filter((q) => q.part === i + 1);
    return {
      part: i + 1,
      total: items.length,
      correct: items.filter((q) => session.answers[q.id] === q.answer).length,
    };
  }).filter((p) => p.total);
  const answered = qs.filter((q) => Boolean(session.answers[q.id])).length,
    correct = byPart.reduce((n, p) => n + p.correct, 0);
  return {
    total: qs.length,
    answered,
    correct,
    unanswered: qs.length - answered,
    accuracy: qs.length ? Math.round((correct / qs.length) * 100) : 0,
    byPart,
  };
}
export function recordQuestions(state, session, bank, ids) {
  for (const id of ids) {
    if (session.recorded.includes(id)) continue;
    const q = bank.questions.find((q) => q.id === id);
    if (!q || !session.answers[id]) continue;
    const wrong = session.answers[id] !== q.answer,
      old = state.mistakes[id];
    if (wrong || old) {
      const item = old || {
        id,
        test: bank.test,
        number: q.number,
        part: q.part,
        tag: q.tag,
        wrongCount: 0,
        attempts: 0,
        streak: 0,
      };
      item.attempts++;
      item.lastAnswer = session.answers[id];
      item.lastAt = Date.now();
      item.wrongCount += wrong ? 1 : 0;
      item.streak = wrong ? 0 : item.streak + 1;
      item.resolved = item.streak >= 2;
      state.mistakes[id] = item;
    }
    session.recorded.push(id);
  }
}
export function finishSession(state, bank) {
  const s = state.active;
  if (!s || s.status !== "active") return null;
  recordQuestions(state, s, bank, s.ids);
  s.status = "complete";
  s.finishedAt = Date.now();
  s.result = score(s, bank);
  state.history.unshift(structuredClone(s));
  state.active = null;
  return s;
}
export function reviewIds(bank, wrongIds) {
  const groups = new Set(
    bank.questions.filter((q) => wrongIds.includes(q.id)).map((q) => q.groupId),
  );
  return bank.questions.filter((q) => groups.has(q.groupId)).map((q) => q.id);
}
export function remainingSeconds(s, now = Date.now()) {
  return s.deadline ? Math.max(0, Math.ceil((s.deadline - now) / 1000)) : null;
}
export const formatTime = (seconds) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
