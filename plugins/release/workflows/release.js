export const meta = {
  name: 'release',
  description: 'Release din CI: imagine cu tag-ul commit-ului (push la cerere), image.tag actualizat in repo-ul GitOps (commit/push la cerere), verificare read-only ArgoCD; raport JSON + Markdown',
  whenToUse: 'In CI dupa merge pe ramura principala, pe un runner care vede registry-ul si (pentru ArgoCD) clusterul: args { image, tag, gitopsRepo, valuesFile, push, commit, pushGitops, kubeContext, argoApp, outDir }',
  phases: [
    { title: 'Garda' },
    { title: 'Imagine', detail: 'devops construieste si (la cerere) pushuieste' },
    { title: 'GitOps', detail: 'gitops scrie image.tag (commit/push la cerere)' },
    { title: 'ArgoCD', detail: 'gitops verifica read-only sync si health' },
    { title: 'Raport' },
  ],
}
// args (toate explicite; in CI nu se ghiceste din CLAUDE.md):
//   image: 'localhost:5000/personal-service'   tag: sha7 (implicit `git rev-parse --short=7 HEAD`, calculat de agent)
//   dockerfile: 'Dockerfile' (relativ la context)   context: '.'
//   gitopsRepo: calea checkout-ului repo-ului GitOps   valuesFile: relativ la gitopsRepo (ex. charts/x/values.yaml)
//   push / commit / pushGitops: false implicit; fiecare cere pe cel dinainte (pushGitops <- commit <- push)
//   kubeContext, argoApp: pentru verificarea ArgoCD (doar dupa pushGitops)
//   outDir: cale absoluta pentru release.json + release.md

const BUILD = {
  type: 'object',
  properties: {
    tag: { type: 'string' },
    imageRef: { type: 'string' },
    built: { type: 'boolean' },
    pushed: { type: 'boolean' },
    inRegistry: { type: 'boolean' },
    evidence: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['tag', 'imageRef', 'built', 'pushed', 'inRegistry', 'evidence', 'problems'],
}

const GITOPS = {
  type: 'object',
  properties: {
    edited: { type: 'boolean' },
    oldTag: { type: 'string' },
    newTag: { type: 'string' },
    diff: { type: 'string' },
    committed: { type: 'boolean' },
    commit: { type: 'string' },
    pushed: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['edited', 'oldTag', 'newTag', 'diff', 'committed', 'commit', 'pushed', 'problems'],
}

const ARGO = {
  type: 'object',
  properties: {
    context: { type: 'string' },
    sync: { type: 'string' },
    health: { type: 'string' },
    runningTag: { type: 'string' },
    matches: { type: 'boolean' },
    evidence: { type: 'string' },
  },
  required: ['context', 'sync', 'health', 'runningTag', 'matches', 'evidence'],
}

const WRITTEN = {
  type: 'object',
  properties: { json: { type: 'string' }, markdown: { type: 'string' } },
  required: ['json', 'markdown'],
}

const CHECKED = {
  type: 'object',
  properties: { jsonOk: { type: 'boolean' }, mdOk: { type: 'boolean' }, problem: { type: 'string' } },
  required: ['jsonOk', 'mdOk', 'problem'],
}

phase('Garda')
let opts = args
if (typeof opts === 'string') {
  try { opts = JSON.parse(opts) } catch (e) { opts = {} }
}
opts = opts || {}
const missing = ['image', 'gitopsRepo', 'valuesFile', 'outDir'].filter(k => !opts[k])
if (missing.length) return { verdict: 'error', issues: [`lipsesc args: ${missing.join(', ')}`] }
if (!/^(\/|[A-Za-z]:[\\/])/.test(opts.outDir)) return { verdict: 'error', issues: ['args.outDir trebuie sa fie o cale absoluta'] }
if (/(^|[^a-z])prod(uction)?([^a-z]|$)/i.test(opts.kubeContext || '')) {
  return { verdict: 'error', issues: [`contextul kubectl "${opts.kubeContext}" pare de productie - refuzat`] }
}
const push = opts.push === true
const commit = push && opts.commit === true
const pushGitops = commit && opts.pushGitops === true
const CI = `Rulezi intr-un pipeline CI: nu pune intrebari, nimeni nu raspunde. Argumentele de mai jos sunt cererea explicita ` +
  `a pipeline-ului; nu face mai mult decat cer. Fara --force, fara --no-verify, niciodata tag-ul latest.`
log(`Imagine: ${opts.image} | ${[push && 'push', commit && 'commit', pushGitops && 'pushGitops'].filter(Boolean).join(' + ') || 'doar build local'}`)

phase('Imagine')
const build = await agent(
  `${CI}\nConstruieste imaginea ${opts.image}:<tag>, unde tag = ${opts.tag ? `"${opts.tag}"` : '`git rev-parse --short=7 HEAD`'}, ` +
  `din Dockerfile-ul ${opts.dockerfile || 'Dockerfile'} cu contextul ${opts.context || '.'}. Arborele git trebuie sa fie curat ` +
  `(altfel built = false si explica in problems).\n` +
  (push
    ? `Pushuieste imaginea si confirma ca tag-ul exista in registry (ex. docker manifest inspect sau API-ul v2 al registry-ului). ` +
      `Daca push-ul esueaza, nu-l ocoli: pushed = false, inRegistry = false, cauza in problems.\n`
    : `NU pushui. pushed = false, inRegistry = false.\n`) +
  `In evidence: digest-ul sau linia de output care dovedeste rezultatul.`,
  { agentType: 'release:devops', phase: 'Imagine', label: push ? 'build + push' : 'build', schema: BUILD })
if (!build) return { verdict: 'error', issues: ['devops nu a raspuns'] }

let gitops = null
if (build.built) {
  phase('GitOps')
  const writeTag = push && build.inRegistry
  gitops = await agent(
    `${CI}\nRepo-ul GitOps e checkout-ul din ${opts.gitopsRepo}. Fisierul ${opts.valuesFile}, cheia image.tag. Tag nou: "${build.tag}".\n` +
    (writeTag
      ? `Imaginea e confirmata in registry. Schimba DOAR valoarea image.tag (intre ghilimele) si arata diff-ul.\n` +
        (commit
          ? `Fa commit cu mesajul "${opts.image.split('/').pop()}: deploy ${build.tag}".\n` +
            (pushGitops ? `Fa push pe ramura curenta a repo-ului GitOps.\n` : `NU face push. pushed = false.\n`)
          : `NU face commit. committed = false, pushed = false.\n`)
      : `Imaginea NU e confirmata in registry: NU edita. Doar diff-ul propus. edited = false, committed = false, pushed = false.\n`) +
    `Nu rula nicio comanda care modifica clusterul.`,
    { agentType: 'release:gitops', phase: 'GitOps', label: 'image.tag', schema: GITOPS })
}

let argo = null
if (gitops && gitops.pushed && opts.argoApp && opts.kubeContext) {
  phase('ArgoCD')
  argo = await agent(
    `${CI}\nVerifica read-only aplicatia ArgoCD "${opts.argoApp}" dupa push-ul tag-ului "${build.tag}". Contextul kubectl permis: ` +
    `"${opts.kubeContext}" - verifica-l intai (kubectl config current-context) si opreste-te daca e altul. Raporteaza sync, health ` +
    `si tag-ul care ruleaza efectiv; matches = runningTag == "${build.tag}". Asteapta cel mult ~3 minute verificand periodic. ` +
    `Nu declansa sync si nu modifica nimic.`,
    { agentType: 'release:gitops', phase: 'ArgoCD', label: 'argocd', schema: ARGO })
}

const deployed = !!(argo && argo.matches && argo.health === 'Healthy')
const report = {
  verdict: !build.built ? 'failed' : deployed ? 'deployed'
    : gitops && gitops.pushed ? (opts.argoApp ? 'pushed-not-synced' : 'pushed')
    : gitops && gitops.committed ? 'committed' : gitops && gitops.edited ? 'tag-written'
    : push && !build.inRegistry ? 'push-failed' : 'built',
  image: build.imageRef,
  tag: build.tag,
  requested: { push, commit, pushGitops },
  build,
  gitops,
  argo,
}

phase('Raport')
// Fisierele le scrie un agent, deci pot lipsi; CI citeste verdictul din JSON, asa ca le recitim si rescriem o data.
const reportFiles = { json: `${opts.outDir}/release.json`, markdown: `${opts.outDir}/release.md` }
const writePrompt =
  `Scrie doua fisiere in folderul ${opts.outDir} (creeaza-l daca lipseste). Nu modifica alte fisiere.\n` +
  `1. release.json: EXACT obiectul JSON de mai jos, neschimbat, formatat cu 2 spatii.\n` +
  `2. release.md: rezumat in romana: "## Release Claude: <verdict>", imaginea si tag-ul, ce s-a cerut si ce s-a facut ` +
  `(build, push, image.tag vechi -> nou, commit, push GitOps, starea ArgoCD), problemele. Fara alt text.\n` +
  `Intoarce caile absolute ale fisierelor.\n\nJSON:\n${JSON.stringify(report, null, 2)}`

let written = null
let reportOk = false
for (let attempt = 1; attempt <= 2 && !reportOk; attempt++) {
  const writeOpts = { phase: 'Raport', label: `raport:${attempt}`, schema: WRITTEN }
  written = await agent(writePrompt, attempt === 1 ? { ...writeOpts, effort: 'low' } : writeOpts)
  const check = await agent(
    `Citeste ${reportFiles.json} si ${reportFiles.markdown}. Nu modifica nimic.\n` +
    `jsonOk = fisierul JSON exista, e JSON valid si are "verdict": "${report.verdict}". mdOk = fisierul Markdown exista si nu e gol. ` +
    `problem = ce lipseste sau difera, sau "" daca ambele sunt in regula.`,
    { phase: 'Raport', label: `verificare-raport:${attempt}`, schema: CHECKED, effort: 'low' })
  reportOk = Boolean(check && check.jsonOk && check.mdOk)
  if (!reportOk) log(`Raport incomplet (incercarea ${attempt}): ${(check && check.problem) || 'verificarea nu a raspuns'}`)
}

return { ...report, files: written || null, reportOk }
