---
name: run
description: Porneste release-ul din CI (workflow-ul release:release) cu argumentele date si scrie raportul. Foloseste-l cand se cere /release:run, de obicei din GitHub Actions dupa merge.
---

Rulezi intr-un pipeline CI, fara sa pui intrebari: nimeni nu raspunde.

1. Argumentele vin dupa comanda ca JSON: `{"image", "tag", "dockerfile", "context", "gitopsRepo", "valuesFile", "push", "commit", "pushGitops", "kubeContext", "argoApp", "outDir"}`. Nu completezi tu `push`, `commit` sau `pushGitops`: lipsa lor inseamna `false`. `outDir` lipsa -> `<radacina repo>/.claude-ci` (cale absoluta).
2. Apelezi workflow-ul o singura data: `Workflow({ name: "release:release", args: <obiectul> })`. Nu faci pasii de mana in locul lui.
3. Cand se termina, afisezi un singur rand: `RELEASE_VERDICT=<verdict> image=<imageRef> raport=<calea release.md>`, apoi nimic altceva.

Daca tool-ul Workflow lipseste, afisezi `RELEASE_VERDICT=error motiv=workflows-dezactivate (enableWorkflows: true in settings)` si te opresti.
