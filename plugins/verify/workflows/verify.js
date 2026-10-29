export const meta = {
  name: 'verify',
  description: 'Verificare independenta a unui serviciu in CI: build + teste + verificarile proiectului, PASS/FAIL cu dovezi si cauze clasificate (infra/toolkit/cod), raport JSON + Markdown',
  whenToUse: 'In CI dupa build sau pe pull request: args { service, outDir, checks }',
  phases: [{ title: 'Garda' }, { title: 'Verificare' }, { title: 'Raport' }],
}
// args: { service: '.', outDir: '<cale absoluta>', checks: 'verificari suplimentare, text liber (optional)' }

const TEST = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, status: { type: 'string', enum: ['PASS', 'FAIL', 'SKIP'] }, evidence: { type: 'string' } },
        required: ['name', 'status', 'evidence'],
      },
    },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cause: { type: 'string', enum: ['infra', 'toolkit', 'cod'] }, detail: { type: 'string' }, file: { type: 'string' } },
        required: ['cause', 'detail', 'file'],
      },
    },
    notChecked: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'checks', 'failures', 'notChecked'],
}

const WRITTEN = {
  type: 'object',
  properties: { json: { type: 'string' }, markdown: { type: 'string' } },
  required: ['json', 'markdown'],
}

phase('Garda')
let opts = args
if (typeof opts === 'string') {
  try { opts = JSON.parse(opts) } catch (e) { opts = { service: opts.trim() } }
}
opts = opts || {}
const service = opts.service || '.'
if (!opts.outDir || !/^(\/|[A-Za-z]:[\\/])/.test(opts.outDir)) return { verdict: 'error', issues: ['args.outDir trebuie sa fie o cale absoluta'] }
log(`Serviciu: ${service}${opts.checks ? ' | verificari suplimentare' : ''}`)

phase('Verificare')
const test = await agent(
  `Verifica independent serviciul din "${service}". Rulezi intr-un pipeline CI: nu pune intrebari, nimeni nu raspunde.\n` +
  `Afli comenzile din CLAUDE.md, README si fisierul de build (Maven: ./mvnw -B verify; Gradle: ./gradlew check; npm: npm ci && npm test). ` +
  `Ruleaza build-ul complet cu testele. Docker e disponibil in runner pentru Testcontainers; daca nu e, testele care il cer sunt infra.\n` +
  (opts.checks ? `Verificari suplimentare cerute: ${opts.checks}\n` : '') +
  `Pentru fiecare esec: cauza (infra = mediu/runner/retea/Docker; toolkit = scripturi/config de build; cod = aplicatia), ` +
  `fisierul (sau "" daca nu se aplica) si detaliul cu linia relevanta din output. pass = true doar daca totul trece.`,
  { agentType: 'verify:local-tester', phase: 'Verificare', label: 'verificare', schema: TEST })
if (!test) return { verdict: 'error', issues: ['local-tester nu a raspuns'] }

const report = {
  verdict: test.pass ? 'pass' : 'fail',
  service,
  checks: test.checks,
  failures: test.failures,
  notChecked: test.notChecked,
}

phase('Raport')
const written = await agent(
  `Scrie doua fisiere in folderul ${opts.outDir} (creeaza-l daca lipseste). Nu modifica alte fisiere.\n` +
  `1. verify.json: EXACT obiectul JSON de mai jos, neschimbat, formatat cu 2 spatii.\n` +
  `2. verify.md: rezumat in romana: "## Verificare Claude: PASS" sau "FAIL", tabelul verificarilor (nume, stare, dovada pe scurt), ` +
  `esecurile cu cauza si fisierul, apoi "Neverificat" daca nu e gol. Fara alt text.\n` +
  `Intoarce caile absolute ale fisierelor.\n\nJSON:\n${JSON.stringify(report, null, 2)}`,
  { phase: 'Raport', label: 'raport', schema: WRITTEN, effort: 'low' })

return { ...report, files: written || null }
