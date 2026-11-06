// Korrektheitstests für Abrechnungsklar. Läuft im Browser auf der Seite (nutzt S, calc, statement, demo).
// Vergleicht calc() mit einer unabhängig geschriebenen Referenzrechnung und prüft Invarianten und Briefinhalt.
(() => {
  const out = []; let fail = 0, pass = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; out.push("FAIL: " + msg); } };
  const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ist ${a}, soll ${b}`);
  const ms = iso => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const dayCount = (a, b) => (ms(b) - ms(a)) / 86400000 + 1;
  const floor2 = x => Math.floor(x * 100 + 1e-7) / 100;
  const id = (() => { let i = 0; return () => "x" + (++i); })();

  // ---------- Referenzrechnung (bewusst anders aufgebaut als calc) ----------
  function reference(st) {
    const P = dayCount(st.period.from, st.period.to);
    const area = Object.fromEntries(st.units.map(u => [u.id, +u.area || 0]));
    const A = st.units.reduce((s, u) => s + (+u.area || 0), 0);
    const occ = st.ten.map(t => {
      const a = Math.max(ms(t.from || st.period.from), ms(st.period.from));
      const b = Math.min(ms(t.to || st.period.to), ms(st.period.to));
      return {id: t.id, unit: t.unit, d: b < a ? 0 : (b - a) / 86400000 + 1, p: +t.persons || 0};
    }).filter(o => o.d > 0);
    const usedByUnit = {}; occ.forEach(o => usedByUnit[o.unit] = (usedByUnit[o.unit] || 0) + o.d);
    const vac = st.units.reduce((s, u) => s + Math.max(0, P - (usedByUnit[u.id] || 0)), 0);
    const PD = occ.reduce((s, o) => s + o.p * o.d, 0) + vac;
    const res = {};
    occ.forEach(o => res[o.id] = {});
    st.costs.forEach(c => {
      const amt = +c.amount || 0;
      const sumV = occ.reduce((s, o) => s + (+(c.vals || {})[o.id] || 0), 0);
      const tot = +c.total || sumV;
      occ.forEach(o => {
        let exact;
        if (c.key === "flaeche") exact = amt * (area[o.unit] / A) * (o.d / P);
        else if (c.key === "einheiten") exact = amt / st.units.length * (o.d / P);
        else if (c.key === "personen") exact = amt * (o.p * o.d) / PD;
        else if (c.key === "verbrauch") exact = tot ? amt * (+(c.vals || {})[o.id] || 0) / tot : 0;
        else exact = +(c.vals || {})[o.id] || 0;
        res[o.id][c.id] = exact;
      });
    });
    return {P, res, PD};
  }

  function check(name, st, extra) {
    S = JSON.parse(JSON.stringify(st));
    const R = calc();
    if (R.err) { ok(false, `${name}: calc meldet Fehler ${R.err}`); return; }
    const ref = reference(S);
    ok(R.P === ref.P, `${name}: Tage im Zeitraum ${R.P} vs ${ref.P}`);
    R.act.forEach(t => {
      S.costs.forEach((c, i) => {
        const row = t.rows[i], exact = ref.res[t.id][c.id];
        if (c.key === "direkt") near(row.val, exact, 0.005, `${name}/${t.name}/${c.type} direkt`);
        else {
          ok(row.val <= exact + 1e-9, `${name}/${t.name}/${c.type}: Mieter zahlt mehr als exakter Anteil (${row.val} > ${exact})`);
          ok(exact - row.val < 0.01 + 1e-9, `${name}/${t.name}/${c.type}: Abweichung ≥ 1 Cent (${row.val} vs ${exact})`);
        }
        ok(Math.abs(row.val * 100 - Math.round(row.val * 100)) < 1e-6, `${name}: Zeile nicht centgenau (${row.val})`);
      });
      const rowSum = t.rows.reduce((s, r) => s + Math.round(r.val * 100), 0);
      ok(Math.round(t.sum * 100) === rowSum, `${name}/${t.name}: Summe ${t.sum} ≠ Summe der gedruckten Zeilen ${rowSum / 100}`);
    });
    R.costRows.forEach((cr, i) => {
      const tenantsCents = R.act.reduce((s, t) => s + Math.round(t.rows[i].val * 100), 0);
      ok(Math.round(cr.amount * 100) === tenantsCents + Math.round(cr.landlord * 100), `${name}/${cr.label}: Mieter + Vermieter ≠ Gesamtkosten`);
      const inputConflict = R.warnings.some(w => w.includes("überschneiden") || (w.includes(cr.label) && w.includes("kleiner als die Summe")));
      if (S.costs[i].key !== "direkt" && !inputConflict) ok(tenantsCents <= Math.round(cr.amount * 100), `${name}/${cr.label}: Mieter zahlen zusammen mehr als die Gesamtkosten`);
    });
    if (extra) extra(R, ref);
  }

  const base = () => ({obj: {street: "Teststr. 1", city: "12345 Teststadt"}, ll: {name: "V. Mieter", street: "A 1", city: "12345 Teststadt", iban: "DE00", contact: ""},
    period: {from: "2025-01-01", to: "2025-12-31"}, dueDays: 30, date: "2026-11-06", adjust: true, units: [], ten: [], costs: []});
  const U = (st, name, area) => { const u = {id: id(), name, area}; st.units.push(u); return u; };
  const T = (st, u, name, from, to, persons, prepaid) => { const t = {id: id(), unit: u.id, name, from, to, persons, prepaid}; st.ten.push(t); return t; };
  const C = (st, type, amount, key, extra = {}) => { const c = {id: id(), type, amount, key, p35: "", vals: {}, unit: "", total: "", ...extra}; st.costs.push(c); return c; };

  // 1) Beispielhaus aus der App: bekannte, von Hand nachgerechnete Werte
  check("Beispielhaus", demo(), R => {
    const schmidt = R.act.find(t => t.name === "Familie Schmidt");
    near(schmidt.rows.find(r => r.label === "Grundsteuer").val, 343.38, 0.001, "Schmidt Grundsteuer");
    near(schmidt.rows.find(r => r.label === "Wasser und Abwasser").val, 1353.73, 0.001, "Schmidt Wasser");
    const weber = R.act.find(t => t.name === "Frau Petra Weber");
    near(weber.rows.find(r => r.label === "Grundsteuer").val, 142.05, 0.001, "Weber Grundsteuer zeitanteilig (142,0559 abgerundet)");
    ok(R.act.find(t => t.name === "Herrn Jan Novak").d === 184, "Novak 184 Tage");
    ok(weber.d === 151, "Weber 151 Tage");
    near(schmidt.rows.find(r => r.label === "Müllbeseitigung").val, 465.90, 0.001, "Schmidt Müll mit Leerstand-Personentagen (Ratgeber-Muster)");
    near(schmidt.rows.find(r => r.label === "Allgemeinstrom / Beleuchtung").val, 77.50, 0.001, "Schmidt Allgemeinstrom");
    ok(R.personDays === 3071, "3.071 Personentage inkl. 30 Leerstandstage");
  });

  // 2) Schaltjahr 2024, Mietzeit 15.02.–29.02.
  { const st = base(); st.period = {from: "2024-01-01", to: "2024-12-31"};
    const a = U(st, "A", 50), b = U(st, "B", 50); T(st, a, "Kurz", "2024-02-15", "2024-02-29", 1, 10); T(st, b, "Voll", "2023-05-01", "", 2, 500);
    C(st, "Grundsteuer", 366, "flaeche"); C(st, "Müllbeseitigung", 732, "personen"); C(st, "Allgemeinstrom / Beleuchtung", 100, "einheiten");
    check("Schaltjahr", st, R => { ok(R.P === 366, "366 Tage"); ok(R.act[0].d === 15, "15 Tage im Februar 2024"); near(R.act[0].rows[0].val, 7.5, 0.001, "366 € × 50/100 × 15/366"); }); }

  // 3) Abweichender Zeitraum 01.07.2025–30.06.2026, Mietzeit über die Grenzen hinaus
  { const st = base(); st.period = {from: "2025-07-01", to: "2026-06-30"};
    const a = U(st, "A", 80); T(st, a, "Lang", "2020-01-01", "2030-12-31", 3, 1000);
    C(st, "Grundsteuer", 1000, "flaeche");
    check("Wirtschaftsjahr", st, R => { ok(R.act[0].d === 365, "365 Tage"); near(R.act[0].rows[0].val, 1000, 0.001, "alleiniger Mieter zahlt alles"); }); }

  // 4) Mieter außerhalb des Zeitraums, Überschneidung
  { const st = base(); const a = U(st, "A", 60);
    T(st, a, "Alt", "2023-01-01", "2024-12-31", 1, 0); T(st, a, "Eins", "2025-01-01", "2025-08-31", 1, 0); T(st, a, "Zwei", "2025-08-01", "", 1, 0);
    C(st, "Grundsteuer", 500, "flaeche");
    check("Überschneidung", st, R => {
      ok(!R.act.some(t => t.name === "Alt"), "Mieter außerhalb wird übersprungen");
      ok(R.warnings.some(w => w.includes("außerhalb")), "Warnung außerhalb");
      ok(R.warnings.some(w => w.includes("überschneiden")), "Warnung Überschneidung"); }); }

  // 5) Personenschlüssel mit Leerstand: Leerstand trägt der Vermieter
  { const st = base(); const a = U(st, "A", 50), b = U(st, "B", 50); T(st, a, "Paar", "2025-01-01", "", 2, 0);
    C(st, "Müllbeseitigung", 300, "personen");
    check("Personen+Leerstand", st, R => { near(R.act[0].rows[0].val, 200, 0.001, "2 von 3 Personen-Anteilen"); near(R.costRows[0].landlord, 100, 0.001, "Vermieter trägt Leerstand"); }); }

  // 6) Rundung: drei gleiche Anteile von 100 € und 100,01 €
  { const st = base(); ["A", "B", "C"].forEach((n, i) => { const u = U(st, n, 70); T(st, u, "M" + i, "2025-01-01", "", 1, 0); });
    C(st, "Grundsteuer", 100, "flaeche"); C(st, "Versicherung", 100.01, "einheiten"); C(st, "Müll", 0.02, "personen");
    check("Rundung", st, R => { ok(R.act.every(t => t.rows[0].val === 33.33), "je 33,33 €"); near(R.costRows[0].landlord, 0.01, 1e-9, "1 Cent beim Vermieter"); }); }

  // 7) Verbrauch: Hauptzähler größer und kleiner als die Summe
  { const st = base(); const a = U(st, "A", 50), b = U(st, "B", 50);
    const t1 = T(st, a, "X", "2025-01-01", "", 1, 0), t2 = T(st, b, "Y", "2025-01-01", "", 1, 0);
    C(st, "Wasser", 1000, "verbrauch", {vals: {[t1.id]: 60, [t2.id]: 30}, total: 100, unit: "m³"});
    C(st, "Wasser2", 1000, "verbrauch", {vals: {[t1.id]: 60, [t2.id]: 30}, total: 80});
    C(st, "Wasser3", 1000, "verbrauch", {vals: {[t1.id]: 60}});
    check("Verbrauch", st, R => {
      near(R.act[0].rows[0].val, 600, 0.001, "60 von 100 m³"); near(R.costRows[0].landlord, 100, 0.001, "Differenz bleibt beim Vermieter");
      ok(R.warnings.some(w => w.includes("kleiner als die Summe")), "Warnung Hauptzähler zu klein");
      ok(R.warnings.some(w => w.includes("Verbrauchswert für Y fehlt")), "Warnung fehlender Verbrauchswert"); }); }

  // 8) Direkt zugeordnet + Überschreitung + § 35a
  { const st = base(); const a = U(st, "A", 50), b = U(st, "B", 50);
    const t1 = T(st, a, "X", "2025-01-01", "", 1, 1000), t2 = T(st, b, "Herrn Max Test", "2025-01-01", "2025-06-30", 1, 0);
    C(st, "Heizkosten", 1000, "direkt", {vals: {[t1.id]: 700, [t2.id]: 400}});
    C(st, "Gartenpflege", 365, "flaeche", {p35: 80});
    check("Direkt+35a", st, R => {
      ok(R.warnings.some(w => w.includes("übersteigen")), "Warnung Einzelbeträge > Gesamtkosten");
      near(R.act[0].rows[1].p35, floor2(182.5) * 0.8, 0.006, "§ 35a 80 % des Gartenanteils");
      const brief = statement(R.act[1], R);
      ok(brief.includes("Guten Tag Herr Max Test"), "Anrede Herr statt Herrn");
      ok(!brief.includes("§ 560 Abs. 4"), "Keine Vorauszahlungsanpassung für ausgezogenen Mieter");
      const brief0 = statement(R.act[0], R);
      ok(brief0.includes("§ 560 Abs. 4"), "Vorauszahlungsanpassung für laufenden Mieter");
      ok(brief0.includes("§ 35a EStG"), "§ 35a-Ausweis vorhanden"); }); }

  // 9) Briefinhalt: die vier formellen Mindestangaben + Escaping
  { const st = base(); const a = U(st, "A", 50), b = U(st, "B", 50);
    T(st, a, "<img src=x onerror=alert(1)>", "2025-01-01", "", 1, 100); T(st, b, "Frau B", "2025-01-01", "", 2, 9999);
    C(st, "Grundsteuer", 500, "flaeche"); C(st, "Müll", 300, "personen");
    check("Briefinhalt", st, R => {
      const brief = statement(R.act[0], R);
      ok(!brief.includes("<img"), "HTML im Namen wird escaped");
      ok(brief.includes("500,00") && brief.includes("300,00"), "Gesamtkosten je Kostenart");
      ok(brief.includes("Wohnfläche") && brief.includes("Personen"), "Verteilerschlüssel genannt");
      ok(brief.includes("Erläuterung der Verteilerschlüssel"), "Schlüssel erläutert");
      ok(brief.includes("abzüglich Ihrer geleisteten Vorauszahlungen"), "Abzug der Vorauszahlungen");
      ok(brief.includes("Nachzahlung"), "Ergebnis Nachzahlung");
      ok(statement(R.act[1], R).includes("Guthaben"), "Ergebnis Guthaben");
      ok(brief.includes("01.01.2025 – 31.12.2025"), "Abrechnungszeitraum");
      ok(brief.includes("Belege"), "Hinweis Belegeinsicht"); }); }

  // 10) Zufallstests: 300 Häuser, Invarianten gegen Referenz
  for (let n = 0; n < 300; n++) {
    const st = base(); const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const nu = rnd(1, 8); const units = Array.from({length: nu}, (_, i) => U(st, "W" + i, rnd(20, 140) + rnd(0, 99) / 100));
    units.forEach(u => { let start = 0; while (start < 365 && Math.random() < 0.8) { const len = rnd(20, 365); const from = new Date(Date.UTC(2025, 0, 1 + start)).toISOString().slice(0, 10); const endDay = Math.min(364, start + len - 1); const to = endDay >= 364 && Math.random() < 0.5 ? "" : new Date(Date.UTC(2025, 0, 1 + endDay)).toISOString().slice(0, 10); T(st, u, "M" + n + "_" + start, from, to, rnd(0, 5), rnd(0, 3000)); start = endDay + 1 + rnd(0, 40); } });
    const keys = ["flaeche", "personen", "einheiten", "verbrauch", "direkt"];
    for (let k = 0; k < rnd(1, 9); k++) { const key = keys[rnd(0, 4)]; const vals = {}; st.ten.forEach(t => vals[t.id] = key === "direkt" ? rnd(0, 90000) / 100 : rnd(0, 500)); C(st, "K" + k, rnd(1, 900000) / 100, key, {vals, p35: rnd(0, 100)}); }
    if (!st.ten.length) continue;
    check("Zufall#" + n, st);
  }

  return {pass, fail, failures: out.slice(0, 40)};
})();
