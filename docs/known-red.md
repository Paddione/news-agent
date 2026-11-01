# Bekannte rote Checks

Gate vor jedem Merge ist `.github/workflows/ci.yml` auf Node 24: `npm run check`, `npm run lint` und `npm test`.
`npm run fmt:check` läuft nur lokal. Was hier steht, ist schon auf `main` rot und kein neuer Fehler. Alles andere Rote
ist neu. Ein roter Test bekommt `{ todo: "docs/known-red.md" }`: Er läuft weiter und erscheint in der Ausgabe, lässt den
Job aber nicht scheitern. Ein Eintrag fliegt samt Markierung raus, sobald der Check wieder grün ist.

Lokal braucht die Suite Node 24 (`.node-version`). `apps/dna-cli` scheitert unter Node 22.

| Check | Seit | Stand | Warum akzeptiert |
|---|---|---|---|
| `npm run fmt:check`: 9 Dateien weichen von oxfmt ab | vor 2026-10-27 | `apps/dna-client-browser/package.json`, `apps/dna-server-api/scripts/eval-local-model.mjs`, `apps/dna-server-api/scripts/label-v3.ts`, `apps/dna-server-api/src/config.ts`, `apps/dna-server-api/src/news/repo-components.generated.json`, `apps/dna-server-api/src/news/repo-components.ts`, `apps/dna-server-api/src/news/taste.ts`, `apps/dna-server-api/tests/repo-components.test.ts`, `apps/shared/packages/jev/src/local.ts` | Reines Format; neue oder geänderte Dateien müssen `oxfmt --check` trotzdem bestehen |

Prüfen, ob die Liste noch stimmt:

```bash
npx oxfmt --check -c shared-app-configuration/.oxfmtrc.json apps/dna-* apps/shared
```
