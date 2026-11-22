// Turns a fill-in brief into interview questions, and the answers back into a prompt.
// A blank is anything in [square brackets]:
//   [yes / no]            a choice (options split on " / ")
//   [paste your script]   a long answer the person must give
//   [file] or [file, …]   a file on their computer
//   [5] or [topics]       a short answer, with the text as its hint
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SVEBrief = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BLANK = /\[([^\]\n]+)\]/g;

  function labelBefore(line, index, prevEnd) {
    const text = line.slice(prevEnd, index).replace(/[:\s·,]+$/, '').trim();
    if (text) return text.replace(/^[,.;·\s]+/, '');
    return '';
  }

  function classify(inner) {
    const t = inner.trim();
    if (/^paste\b/i.test(t)) return { type: 'long', hint: t };
    if (/^file\b/i.test(t)) return { type: 'file', hint: t };
    const parts = t.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) return { type: 'choice', options: parts };
    return { type: 'short', hint: t };
  }

  function parse(brief) {
    const questions = [];
    const lines = String(brief || '').split('\n');
    lines.forEach((line, li) => {
      let m, prevEnd = 0;
      BLANK.lastIndex = 0;
      while ((m = BLANK.exec(line))) {
        const q = classify(m[1]);
        let label = labelBefore(line, m.index, prevEnd);
        if (!label) {
          // A blank alone on its line: use the heading line above it ("Script:").
          const above = li > 0 ? lines[li - 1].trim() : '';
          const rest = line.slice(m.index + m[0].length).trim();
          label = (above && /:$/.test(above) ? above.replace(/:$/, '') : '') || rest.replace(/^[,.;·\s]+/, '').slice(0, 60) || 'Answer';
        }
        questions.push({ id: questions.length, raw: m[0], label, line: li, ...q });
        prevEnd = m.index + m[0].length;
      }
    });
    return questions;
  }

  // The answer a fast run uses: the first option of a choice ("you decide" when offered),
  // and "you choose" for an open blank. Long and file blanks have no default.
  function fastAnswer(q) {
    if (q.type === 'choice') {
      const decide = q.options.find(o => /you decide/i.test(o));
      return decide || q.options[0];
    }
    if (q.type === 'short') return 'you choose';
    return '';
  }

  function missing(questions, answers) {
    return questions.filter(q => (q.type === 'long' || q.type === 'file') && !String(answers[q.id] || '').trim());
  }

  function fill(brief, questions, answers) {
    let i = 0;
    return String(brief || '').replace(BLANK, () => {
      const q = questions[i++];
      const a = q ? String(answers[q.id] ?? '').trim() : '';
      return a || (q ? fastAnswer(q) : '') || 'you choose';
    });
  }

  return { parse, fill, fastAnswer, missing };
});
