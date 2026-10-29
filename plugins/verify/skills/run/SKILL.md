---
name: run
description: Porneste verificarea independenta a unui serviciu (workflow-ul verify:verify) si scrie raportul pentru CI. Foloseste-l cand se cere /verify:run, de obicei din GitHub Actions.
---

Rulezi intr-un pipeline CI sau local, fara sa pui intrebari: nimeni nu raspunde.

1. Argumentele vin dupa comanda, ca JSON (`{"service": ".", "outDir": "...", "checks": "..."}`) sau ca perechi `service=... outDir=...`. `outDir` lipsa -> `<radacina repo>/.claude-ci` (cale absoluta). `service` lipsa -> `.`.
2. Apelezi workflow-ul o singura data: `Workflow({ name: "verify:verify", args: <obiectul> })`. Nu rulezi verificarea de mana in locul lui.
3. Cand se termina, afisezi un singur rand: `VERIFY_VERDICT=<pass|fail|error> esecuri=<n> raport=<calea verify.md>`, apoi nimic altceva.

Daca tool-ul Workflow lipseste, afisezi `VERIFY_VERDICT=error motiv=workflows-dezactivate (enableWorkflows: true in settings)` si te opresti.
