# Progress: OD-3/OD-4 news-agent

Prozent: 100 % (Deploy-Kette + SSE + DB + Deferred-Dups; gemergt + gepusht)

## Erledigt
- Deploy-Kette: `probeStep` reines Leaf (`→probe`), Tunnel beim Caller,
  `deviceStatusOf`-Umbenennung beendet Symbol-Kollision.
- SSE: einziger Trigger-Owner (`schedule→pump`), `running/queued`-Guard.
- DB-Kernel: Conn-/Format-Trennung bei identischen Exporten.
- Commit `eb27995`, Push main 697a7ef..eb27995 (Eigner-Entscheid 2026-11-06).
- Verifikation: `tsc` ×2 exit 0 (selbst), 26 Tests fail 0 (selbst).
- Frischer Graph-Index (news 2026-11-06T20:39:48Z), selbst abgefragt:
  `probeStep→probe` Leaf belegt; keine Kante probe*/statusOf→deploy;
  einziger Mutual-Pair `sse.arm↔sse.pump` = Timer-Drossel per Design
  (gleiche Klasse wie Cockpit-Reconnect, überwacht).
- Hinweis Fremd-Session: parallele Session setzte vorab 100 % inkl.
  10-Cycle-0-Rows; Kantenlage nachverifiziert und bestätigt, throttle
  als intentional dokumentiert (statt 100 %).

## Nächste Schritte
- Keine — R1 geschlossen: `tickMinutes↔slotMinutes` Single-Source-Alias
  (Commit `f1ddcab`, Push main 82b9c98..f1ddcab), `until`-Helper vereint;
  tsc ×3 + 6 Suiten grün, Verträge byte-identisch.
  `sse.arm↔pump` bleibt dokumentierte Timer-Drossel (by design).
