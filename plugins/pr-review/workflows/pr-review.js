export const meta = {
  name: 'pr-review',
  description: 'Revizie a unui pull request: corectitudine, securitate si baza de date in paralel, constatarile grave verificate adversarial, raport JSON + Markdown pentru CI',
  whenToUse: 'In CI pe pull request (sau local pe schimbarile necomise): args { base, outDir, failOn }',
  phases: [
    { title: 'Garda' },
    { title: 'Revizie', detail: 'code-reviewer, security-reviewer, db-reviewer in paralel' },
    { title: 'Verificare', detail: 'un sceptic per constatare critic/mare' },
    { title: 'Raport', detail: 'pr-review.json + pr-review.md in outDir' },
  ],
}
// args: { base: 'origin/main' | sha, outDir: '<cale absoluta>', failOn: 'critic' | 'mare' | 'niciuna', reviewers: ['code','security','db'] }
//   base: commit-ul fata de care se compara; in CI merge-base-ul PR-ului. Diff-ul e `git diff <base>` (include si
//   modificarile necomise) plus fisierele netrackuite, deci acelasi apel merge si local.
// Rezultat: { verdict: 'pass' | 'fail', counts, findings, files } si fisierele scrise in outDir.

const SEVERITIES = ['critic', 'mare', 'mediu', 'mic']

const FINDINGS = {
  type: 'object',
  properties: {
    reviewed: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'line', 'title', 'scenario', 'fix'],
      },
    },
    notChecked: { type: 'array', items: { type: 'string' } },
  },
  required: ['reviewed', 'findings', 'notChecked'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    severity: { type: 'string', enum: SEVERITIES },
    reason: { type: 'string' },
  },
  required: ['real', 'severity', 'reason'],
}

const WRITTEN = {
  type: 'object',
  properties: { json: { type: 'string' }, markdown: { type: 'string' } },
  required: ['json', 'markdown'],
}

phase('Garda')
let opts = args
if (typeof opts === 'string') {
  try { opts = JSON.parse(opts) } catch (e) { opts = { base: opts.trim() } }
}
opts = opts || {}
if (!opts.base) return { verdict: 'error', issues: ['args.base lipseste (commit-ul de baza, ex. merge-base-ul PR-ului)'] }
if (!opts.outDir || !/^(\/|[A-Za-z]:[\\/])/.test(opts.outDir)) return { verdict: 'error', issues: ['args.outDir trebuie sa fie o cale absoluta'] }
const failOn = SEVERITIES.includes(opts.failOn) || opts.failOn === 'niciuna' ? opts.failOn : 'critic'
const wanted = Array.isArray(opts.reviewers) && opts.reviewers.length ? opts.reviewers : ['code', 'security', 'db']
log(`Baza: ${opts.base} | pica la: ${failOn} | revizori: ${wanted.join(', ')}`)

const SCOPE =
  `Rulezi intr-un pipeline CI: nu pune intrebari, nimeni nu raspunde.\n` +
  `Schimbarile de revizuit: \`git diff ${opts.base}\` (si \`git diff --name-only ${opts.base}\`) plus fisierele netrackuite ` +
  `din \`git status --porcelain\`. Ruleaza git din radacina repo-ului (\`git rev-parse --show-toplevel\`). ` +
  `Cai de fisier relative la radacina repo-ului. In "reviewed" pune doar caile fisierelor revizuite, fara adnotari.`

const REVIEWERS = [
  { key: 'code', agentType: 'pr-review:code-reviewer', prompt: `Revizie de corectitudine pe schimbari.\n${SCOPE}` },
  { key: 'security', agentType: 'pr-review:security-reviewer', prompt: `Revizie de securitate pe schimbari.\n${SCOPE}` },
  {
    key: 'db', agentType: 'pr-review:db-reviewer',
    prompt: `Revizie de baza de date pe schimbari (migratii, entitati, repository-uri, servicii tranzactionale, config JPA). ` +
      `Daca schimbarile nu ating baza de date, intoarce findings goale si spune in notChecked ca nu era nimic de revizuit. ` +
      `Nu rula EXPLAIN: in CI nu e nicio baza pornita.\n${SCOPE}`,
  },
].filter(r => wanted.includes(r.key))

const results = await pipeline(
  REVIEWERS,
  r => agent(r.prompt, { agentType: r.agentType, phase: 'Revizie', label: r.key, schema: FINDINGS }),
  (review, r) => {
    if (!review) return { key: r.key, failed: true, findings: [], reviewed: [], notChecked: [`revizorul ${r.key} nu a raspuns`] }
    return parallel(review.findings.map(f => () => {
      if (f.severity !== 'critic' && f.severity !== 'mare') return Promise.resolve({ ...f, reviewer: r.key, verified: false })
      return agent(
        `Incearca sa RESPINGI aceasta constatare a revizorului "${r.key}" pe un pull request. Citeste codul real.\n` +
        `${f.file}:${f.line} [${f.severity}] ${f.title}\nScenariu: ${f.scenario}\n` +
        `real = true doar daca scenariul se intampla efectiv in codul de acum (nu ipotetic, nu deja tratat in alta parte). ` +
        `severity = severitatea corecta dupa verificare. Daca nu esti sigur, real = false. Nu modifica fisiere.`,
        { phase: 'Verificare', label: `verifica ${r.key}: ${f.file}:${f.line}`, schema: VERDICT, effort: 'high' })
        // Un verificator care nu raspunde nu sterge constatarea: ramane, marcata neverificata.
        .then(v => v ? { ...f, reviewer: r.key, verified: true, real: v.real, severity: v.real ? v.severity : f.severity, verifyReason: v.reason }
          : { ...f, reviewer: r.key, verified: false })
    })).then(list => ({ key: r.key, reviewed: review.reviewed, notChecked: review.notChecked, findings: list }))
  })

// Aceeasi problema raportata de mai multi revizori (acelasi fisier, linii apropiate) devine o singura constatare,
// cu severitatea cea mai mare si toti revizorii; titlurile diferite raman in alsoReported.
const NEAR_LINES = 3
function mergeDuplicates(list) {
  const merged = []
  for (const f of list) {
    const same = merged.find(m => m.file === f.file && Math.abs(m.line - f.line) <= NEAR_LINES)
    if (!same) { merged.push({ ...f, reviewers: [f.reviewer], alsoReported: [] }); continue }
    if (!same.reviewers.includes(f.reviewer)) same.reviewers.push(f.reviewer)
    if (f.title !== same.title) same.alsoReported.push(`${f.reviewer}: ${f.title}`)
    if (SEVERITIES.indexOf(f.severity) < SEVERITIES.indexOf(same.severity)) {
      Object.assign(same, { severity: f.severity, scenario: f.scenario, fix: f.fix })
    }
    same.verified = same.verified || f.verified
  }
  return merged
}
const cleanPath = p => String(p).replace(/\s*\(.*\)\s*$/, '').trim()

const all = results.filter(Boolean)
const dropped = all.flatMap(r => r.findings.filter(f => f.verified && !f.real))
const raw = all.flatMap(r => r.findings.filter(f => !f.verified || f.real))
  .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
const findings = mergeDuplicates(raw)
if (raw.length !== findings.length) log(`${raw.length - findings.length} constatari duplicate (raportate de mai multi revizori) comasate`)
const counts = Object.fromEntries(SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length]))
const failed = failOn !== 'niciuna' && findings.some(f => SEVERITIES.indexOf(f.severity) <= SEVERITIES.indexOf(failOn))
const reviewerErrors = all.filter(r => r.failed).map(r => r.key)
if (dropped.length) log(`${dropped.length} constatari critic/mare respinse la verificare`)

const report = {
  verdict: reviewerErrors.length ? 'error' : failed ? 'fail' : 'pass',
  base: opts.base,
  failOn,
  counts,
  findings: findings.map(({ reviewers, severity, file, line, title, scenario, fix, verified, alsoReported }) => ({ reviewers, severity, file, line, title, scenario, fix, verified, alsoReported })),
  droppedAtVerification: dropped.map(({ reviewer, file, line, title, verifyReason }) => ({ reviewer, file, line, title, reason: verifyReason })),
  reviewed: [...new Set(all.flatMap(r => r.reviewed.map(cleanPath)))].filter(Boolean).sort(),
  notChecked: all.flatMap(r => r.notChecked.map(n => `${r.key}: ${n}`)),
  reviewerErrors,
}

phase('Raport')
const written = await agent(
  `Scrie doua fisiere in folderul ${opts.outDir} (creeaza-l daca lipseste). Nu modifica alte fisiere.\n` +
  `1. pr-review.json: EXACT obiectul JSON de mai jos, neschimbat, formatat cu 2 spatii.\n` +
  `2. pr-review.md: comentariu de PR in romana, scurt: primul rand "## Revizie Claude: PASS" sau "FAIL" sau "EROARE" dupa verdict, ` +
  `apoi un tabel cu numarul de constatari pe severitate, apoi constatarile (cele mai grave primele) cu fisier:linie, ` +
  `problema, scenariu, remediere, revizorii si (daca exista) alsoReported, apoi o sectiune scurta "Respinse la verificare" si ` +
  `"Neverificat" daca nu sunt goale. ` +
  `Fara alt text in plus fata de ce e in JSON.\n` +
  `Intoarce caile absolute ale celor doua fisiere.\n\nJSON:\n${JSON.stringify(report, null, 2)}`,
  { phase: 'Raport', label: 'raport', schema: WRITTEN, effort: 'low' })

return { ...report, files: written || null }
