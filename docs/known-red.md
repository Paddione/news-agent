# Bekannte rote Checks

Gate vor jedem Merge ist `.github/workflows/ci.yml` auf Node 24: `npm run check`, `npm run lint`, `npm run fmt:check`
und `npm test`. Lokal gilt dasselbe, die Suite braucht Node 24 (`.node-version`). `apps/dna-cli` scheitert unter Node 22.

Aktuell ist nichts rot. Wird ein Check rot, ohne dass er sofort behoben werden kann, kommt er hierher, damit der Rest
weiter durch das Gate kommt. Ein roter Test bekommt `{ todo: "docs/known-red.md" }`: Er läuft weiter und erscheint in der
Ausgabe, lässt den Job aber nicht scheitern. Ein Eintrag fliegt samt Markierung raus, sobald der Check wieder grün ist.

| Check | Seit | Stand | Warum akzeptiert |
|---|---|---|---|
