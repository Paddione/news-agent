# Bekannte rote Checks

Gate vor jedem Merge ist `.github/workflows/ci.yml` auf Node 24: `npm run check`, `npm run lint` und `npm test`.
`npm run fmt:check` läuft nur lokal. Was hier steht, ist schon auf `main` rot und kein neuer Fehler. Alles andere Rote
ist neu. Rote Tests tragen `{ todo: "docs/known-red.md" }`: Sie laufen weiter und erscheinen in der Ausgabe, lassen den
Job aber nicht scheitern. Ein Eintrag fliegt samt Markierung raus, sobald der Check wieder grün ist.

Lokal braucht die Suite Node 24 (`.node-version`). Unter Node 22 scheitern zusätzlich `apps/dna-cli` und
`apps/dna-client-browser/tests/ui-faux.mjs`.

| Check | Seit | Stand | Warum akzeptiert |
|---|---|---|---|
| `apps/dna-server-api/tests/stream.test.ts`: „SSE frames reduce to the same transcript as /v1/agent/transcript, and feed.card arrives for each card“ (Assertion in Zeile 74) | spätestens #22 (2026-10-26), dort als vorbestehend vermerkt | rot auf `e9a2568` (2026-10-27), 1 von 2 Tests der Datei, auch auf Node 24 | Ursache nicht untersucht. Nicht überspringen: `a subagent transcript streams when asked for` braucht den Sweep dieses Tests, und sind beide übersprungen, hängt die Datei |
| `apps/shared/packages/dna-sdk/tests/capabilities.test.ts`: „every client route belongs to a capability“ | `2ce38d5` (2026-10-28) | `workflow.newsDigest has no capability` | Offen, ob die Route in `CAPABILITIES` oder nach `INFRA_ROUTES` gehört |
| `npm run fmt:check`: 9 Dateien weichen von oxfmt ab | vor 2026-10-27 | `apps/dna-client-browser/package.json`, `apps/dna-server-api/scripts/eval-local-model.mjs`, `apps/dna-server-api/scripts/label-v3.ts`, `apps/dna-server-api/src/config.ts`, `apps/dna-server-api/src/news/repo-components.generated.json`, `apps/dna-server-api/src/news/repo-components.ts`, `apps/dna-server-api/src/news/taste.ts`, `apps/dna-server-api/tests/repo-components.test.ts`, `apps/shared/packages/jev/src/local.ts` | Reines Format; neue oder geänderte Dateien müssen `oxfmt --check` trotzdem bestehen |

Prüfen, ob die Liste noch stimmt:

```bash
(cd apps/dna-server-api && node --import tsx --test tests/stream.test.ts)
npx oxfmt --check -c shared-app-configuration/.oxfmtrc.json apps/dna-* apps/shared
```
