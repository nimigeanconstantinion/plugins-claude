---
name: run
description: Porneste revizia unui pull request (workflow-ul pr-review:pr-review) cu argumentele date si scrie raportul pentru CI. Foloseste-l cand se cere /pr-review:run, de obicei din GitHub Actions.
---

Rulezi intr-un pipeline CI sau local, fara sa pui intrebari: nimeni nu raspunde.

1. Argumentele vin dupa comanda, ca JSON (`{"base": "...", "outDir": "...", "failOn": "critic"}`) sau ca perechi `base=... outDir=... failOn=...`. Le transformi intr-un obiect. `outDir` trebuie sa fie o cale absoluta; daca lipseste, folosesti `<radacina repo>/.claude-ci`. `base` lipsa -> merge-base-ul cu `origin/main` (`git merge-base origin/main HEAD`), iar daca nici asta nu merge, `HEAD`.
2. Apelezi workflow-ul o singura data: `Workflow({ name: "pr-review:pr-review", args: <obiectul> })`. Nu faci revizia de mana in locul lui si nu-l relansezi daca a terminat.
3. Cand se termina, afisezi un singur rand: `PR_REVIEW_VERDICT=<pass|fail|error> critic=<n> mare=<n> mediu=<n> mic=<n> raport=<calea pr-review.md>`, apoi nimic altceva.

Daca tool-ul Workflow lipseste din sesiune, afisezi `PR_REVIEW_VERDICT=error motiv=workflows-dezactivate (enableWorkflows: true in settings)` si te opresti.
