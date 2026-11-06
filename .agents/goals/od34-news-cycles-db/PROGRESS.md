# Progress: OD-3/OD-4 news-agent

Prozent: 90 % (Kette gebrochen, Guard drin; 2 Deferred-Items offen)

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
- Deferred (STOP-Entscheid, eigene Pakete): `tickMinutes↔slotMinutes`-
  Vereinigung, `until`-Helper-Dup → dann 100 %.
