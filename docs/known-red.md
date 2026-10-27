# Bekannte rote Checks

Das Repo hat keine CI. Gate vor jedem Merge ist die lokale Suite: `npm test`, `npm run check`, `npm run lint` und
`npm run fmt:check`. Was hier steht, ist schon auf `main` rot und kein neuer Fehler. Alles andere Rote ist neu.
Ein Eintrag fliegt raus, sobald der Check wieder grün ist.

| Check | Seit | Stand | Warum akzeptiert |
|---|---|---|---|
| `apps/dna-server-api/tests/stream.test.ts`: „SSE frames reduce to the same transcript as /v1/agent/transcript, and feed.card arrives for each card“ (Assertion in Zeile 74) | spätestens #22 (2026-10-26), dort als vorbestehend vermerkt | rot auf `e9a2568` (2026-10-27), 1 von 2 Tests der Datei | Ursache nicht untersucht; die übrigen Workspaces und Tests sind grün |
| `npm run fmt:check`: 9 Dateien weichen von oxfmt ab | vor 2026-10-27 | `apps/dna-client-browser/package.json`, `apps/dna-server-api/scripts/eval-local-model.mjs`, `apps/dna-server-api/scripts/label-v3.ts`, `apps/dna-server-api/src/config.ts`, `apps/dna-server-api/src/news/repo-components.generated.json`, `apps/dna-server-api/src/news/repo-components.ts`, `apps/dna-server-api/src/news/taste.ts`, `apps/dna-server-api/tests/repo-components.test.ts`, `apps/shared/packages/jev/src/local.ts` | Reines Format; neue oder geänderte Dateien müssen `oxfmt --check` trotzdem bestehen |

Prüfen, ob die Liste noch stimmt:

```bash
(cd apps/dna-server-api && node --import tsx --test tests/stream.test.ts)
npx oxfmt --check -c shared-app-configuration/.oxfmtrc.json apps/dna-* apps/shared
```
