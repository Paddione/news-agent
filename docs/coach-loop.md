# News-Agent als Taste-/Skill-Coach: Vertrag (v1)

Stand: 2026-10-27. Ziel: Der persistente News-Agent liefert wiederkehrend
Taste-/Skill-/Programmier-Beiträge mit Feedback-Loop, mit lesendem/schreibendem
Zugriff nur auf vereinbarte Pfade. Baut auf dem vorhandenen Taste-System auf
(`apps/dna-server-api/src/news/taste.ts`, Routen `taste.get`/`taste.questions`/
`taste.answer`).

## v1-Umfang (bewusst eng)

1. **Digest-Job** (`apps/dna-server-cron`): wöchentlicher Tick fasst offene/
   beantwortete Taste-Fragen und Top-Karten zu einem Coach-Digest zusammen.
2. **Outbox**: Der Agent schreibt NUR in diesem Repo: `coach/outbox/` (Digest,
   Skill-Vorschläge als Markdown) und `docs/` (Entscheidungsnotizen).
   Keine direkten Schreibzugriffe auf andere Checkouts (insb. keine Skills,
   keine Dotfiles): Jede Übernahme eines Vorschlags läuft über expliziten
   Nutzer-Akzept plus den normalen Flow des Ziel-Repos.
3. **Feedback-Loop**: Jede Digest referenziert Taste-Frage-IDs; Antworten und
   Ablehnungen laufen über die bestehende `taste.answer`-API
   (labels: hype/facts/signal). Abgelehnte Vorschläge werden nicht erneut
   vorgelegt (Dedup über Outbox-Index).
4. **Programmierung**: v1 nimmt keine autonomen Code-Änderungen außerhalb
   dieses Repos vor. Innerhalb: normaler PR-Flow dieses Repos.

## Lesezugriff

Taste-Store (Keywords, Feedback, Fragen), Feed-Karten, eigene Outbox.
Keine Secrets, keine fremden Checkouts.

## Folgearbeit (v2, separater Entscheid)

- Direkte Skill-Deltas (z. B. `.agents/skills`-Vorschläge als PRs im Ziel-Repo).
- Takt und Eskalation (täglich vs. wöchentlich) nach den ersten Digests.

## Aufgaben

- [x] N1: `coach/outbox/` + Index-Format anlegen (Dedup-Regel testen) —
  `src/news/coach.ts` (`renderDigest`, `digestFilename`, `isNewDigest`) +
  `tests/coach.test.ts` (5/5 grün, `tsc -p .` sauber).
- [x] N2: Digest-Tick in `dna-server-cron` (hinter Schedule-Guard, trocken lauffähig) —
  `digestTick`/`digestSlotId` in `src/digest.ts`, Aufruf in `main.ts` (best effort,
  ändert Tick-Exit-Code nie), `tests/digest.test.ts` (3/3 grün mit Stub-Server).
- [x] N3: Digest→`taste.answer`-Referenzen verdrahten — `POST /v1/workflows/news-digest`
  (`workflow.newsDigest`, cron-Token-Scope, Wochen-Due), `assembleDigest` schreibt
  in `DNA_COACH_OUTBOX_DIR` bzw. `<dataDir>/coach/outbox`; `tests/coach-route.test.ts`
  (completed → not_due → manual, 2/2 grün gegen Boot-Server).
- [ ] N4: Ersten Digest erzeugen, Nutzer-Feedback einholen, v2 entscheiden.
