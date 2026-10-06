// AI Discovery answer engine. Every answer is computed on demand from the PUBLISHED records in
// the `D` object (organisations, projects, themes, relationships) passed in; nothing is written
// by hand, so answers can never contradict what the directory and the network graph show. A
// question the data cannot answer gets an explicit "cannot answer" reply, not a canned one.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : root).RD_AI = api;
})(this, function () {
  "use strict";
  var STOP = ["the", "and", "for", "with", "that", "this", "what", "which", "where", "how", "are", "is", "of", "in", "to", "a", "an", "on", "by",
    "show", "me", "list", "all", "from", "does", "do", "have", "has", "there", "any", "their", "its", "about", "tell", "give", "find", "who",
    "into", "between", "active", "research", "organisations", "organisation"];
  var FILLER = ["located", "based", "exist", "exists", "existing", "published", "currently", "many", "much", "number", "count", "total", "please", "can", "you",
    "name", "names", "working", "operating", "work", "involved", "involving", "linked", "related", "connected", "connect", "connection", "relationship",
    "relationships", "records", "record", "entities", "entity", "directory", "data", "now", "are", "was", "were", "been", "being", "path", "link", "relat"];
  var TYPE_PATTERNS = [
    ["crc", /\bcrcs?\b/], ["ncris_facility", /ncris|facilit/], ["university", /universit/], ["research_institute", /institute/],
    ["technology_precinct", /precinct/], ["industry_partner", /industry partner|industrial partner|\bindustry\b/],
    ["government_agency", /government|agenc/], ["incubator_accelerator", /incubator|accelerator/],
  ];

  function norm(text) { return String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function words(text) { return norm(text).split(" ").filter(Boolean); }
  function plural(label) { return /y$/i.test(label) ? label.slice(0, -1) + "ies" : label + "s"; }
  function typeLabel(D, type) { return (D.TYPE_META[type] || {}).label || type; }
  function relLabel(D, type) { return (D.RELATIONSHIP_META[type] || {}).label || type; }
  function list(names, max) {
    var shown = names.slice(0, max || 8);
    return shown.join(", ") + (names.length > shown.length ? " and " + (names.length - shown.length) + " more" : "");
  }

  function index(D) {
    var byId = {};
    D.allNodes.forEach(function (n) { byId[n.id] = n; });
    var adj = {};
    D.allNodes.forEach(function (n) { adj[n.id] = []; });
    D.relationships.forEach(function (r) {
      if (!adj[r.sourceId] || !adj[r.targetId]) return;
      adj[r.sourceId].push({ to: r.targetId, rel: r });
      adj[r.targetId].push({ to: r.sourceId, rel: r });
    });
    return { byId: byId, adj: adj };
  }
  function minConfidence(D, rels) {
    var best = null;
    rels.forEach(function (r) { var rank = (D.CONFIDENCE_META[r.confidence] || {}).rank; if (rank != null && (best === null || rank < best.rank)) best = { rank: rank, key: r.confidence }; });
    return best ? best.key : null;
  }

  function matchEntities(D, q, qWords) {
    var found = [];
    D.allNodes.forEach(function (n) {
      if (n.type === "research_theme") return;
      var name = norm(n.name);
      var byName = name.length > 2 && (" " + q + " ").indexOf(" " + name + " ") !== -1;
      var byId = n.id.length >= 3 && n.id.indexOf("-") === -1 && qWords.indexOf(n.id) !== -1;
      if (byName || byId) found.push({ node: n, len: name.length });
    });
    found = found.filter(function (a) { return !found.some(function (b) { return b !== a && b.len > a.len && norm(b.node.name).indexOf(norm(a.node.name)) !== -1; }); });
    return found.sort(function (a, b) { return q.indexOf(norm(a.node.name)) - q.indexOf(norm(b.node.name)); }).map(function (f) { return f.node; });
  }
  function matchThemes(D, q, qWords) {
    var scored = [];
    D.themeNodes.forEach(function (t) {
      var name = norm(t.name), score = 0;
      if ((" " + q + " ").indexOf(" " + name + " ") !== -1) score += 10;
      words(t.name).forEach(function (w) { if (w.length >= 4 && STOP.indexOf(w) === -1 && qWords.indexOf(w) !== -1) score++; });
      if (score) scored.push({ theme: t, score: score });
    });
    var top = scored.reduce(function (m, s) { return Math.max(m, s.score); }, 0);
    return scored.filter(function (s) { return s.score === top; }).map(function (s) { return s.theme; });
  }
  function matchStates(D, original, q) {
    return D.STATES.filter(function (st) {
      return new RegExp("\\b" + st.code + "\\b").test(original) || (" " + q + " ").indexOf(" " + norm(st.name) + " ") !== -1;
    });
  }
  function matchTypes(q) {
    return TYPE_PATTERNS.filter(function (p) { return p[1].test(q); }).map(function (p) { return p[0]; });
  }

  function shortestPath(ix, fromId, toId) {
    var prev = {}; prev[fromId] = null;
    var queue = [fromId];
    while (queue.length) {
      var cur = queue.shift();
      if (cur === toId) break;
      (ix.adj[cur] || []).forEach(function (e) { if (!(e.to in prev)) { prev[e.to] = { from: cur, rel: e.rel }; queue.push(e.to); } });
    }
    if (!(toId in prev)) return null;
    var steps = [], at = toId;
    while (prev[at]) { steps.unshift({ from: prev[at].from, to: at, rel: prev[at].rel }); at = prev[at].from; }
    return steps;
  }

  function coverageGaps(D, ix) {
    var crcs = D.actors.filter(function (a) { return a.type === "crc"; });
    var facilities = D.actors.filter(function (a) { return a.type === "ncris_facility"; });
    var gaps = [];
    var emptyStates = D.STATES.filter(function (st) { return !crcs.concat(facilities).some(function (a) { return a.state === st.code; }); });
    if (emptyStates.length) gaps.push("No published CRC or NCRIS facility is located in " + list(emptyStates.map(function (s) { return s.name; })) + ".");
    crcs.forEach(function (c) {
      if (!(ix.adj[c.id] || []).some(function (e) { var o = ix.byId[e.to]; return o && o.type === "ncris_facility"; })) gaps.push(c.name + " has no published link to an NCRIS facility.");
    });
    D.themeNodes.forEach(function (t) {
      var linked = D.actors.filter(function (a) { return (a.themes || []).indexOf(t.id) !== -1; });
      if (linked.length === 1) gaps.push(t.name + " is linked to only one published organisation (" + linked[0].name + ").");
      if (linked.length === 0) gaps.push(t.name + " is not linked to any published organisation.");
    });
    return gaps;
  }

  // Words in the question that nothing above could interpret. Several of them mean the question is
  // about something else (budgets, forecasts...) and a list of "matching" records would be misleading.
  function unexplained(D, qWords, entities, themes, states, types) {
    var known = {};
    entities.forEach(function (n) { words(n.name).concat([n.id]).forEach(function (w) { known[w] = true; }); });
    themes.forEach(function (t) { words(t.name).forEach(function (w) { known[w] = true; }); });
    states.forEach(function (st) { words(st.name).concat([st.code.toLowerCase()]).forEach(function (w) { known[w] = true; }); });
    return qWords.filter(function (w) {
      if (w.length <= 2 || known[w] || STOP.indexOf(w) !== -1 || FILLER.indexOf(w) !== -1) return false;
      return !TYPE_PATTERNS.some(function (p) { return types.indexOf(p[0]) !== -1 && p[1].test(w); });
    });
  }
  function refuse() {
    return { matched: false, answer: "I can't answer that from the currently published records. I can answer questions about a specific organisation, a research theme, a state or territory, counts, coverage gaps, or how two organisations are connected.", entities: [], evidence: [], viz: null };
  }
  function reply(partial) { return Object.assign({ matched: true, entities: [], evidence: [], viz: null, vizLabel: "", confidence: null }, partial); }

  function answer(D, query) {
    var original = String(query || "");
    var q = norm(original), qWords = words(original);
    if (!D.allNodes.length) return { matched: false, answer: "There are no published records yet, so there is nothing to answer from.", entities: [], evidence: [], viz: null };
    var ix = index(D);
    var entities = matchEntities(D, q, qWords), themes = matchThemes(D, q, qWords), states = matchStates(D, original, q), types = matchTypes(q);
    var actorsOnly = function (n) { return n.type !== "project_initiative" && n.type !== "research_theme"; };

    var leftover = unexplained(D, qWords, entities, themes, states, types);
    var tooVague = leftover.length >= 2;
    // two organisations + a connection word: how are they connected?
    if (!tooVague && entities.length >= 2 && /connect|path|between|link|relat|route|how are/.test(q)) {
      var a = entities[0], b = entities[1];
      var path = shortestPath(ix, a.id, b.id);
      if (!path) return reply({ answer: "No published path connects " + a.name + " and " + b.name + ".", entities: [a.id, b.id] });
      var chain = a.name;
      path.forEach(function (s) { chain += " — " + relLabel(D, s.rel.type) + " → " + ix.byId[s.to].name; });
      return reply({ answer: "The shortest published connection between " + a.name + " and " + b.name + " has " + path.length + " step" + (path.length === 1 ? "" : "s") + ": " + chain + ".",
        entities: [a.id].concat(path.map(function (s) { return s.to; })), evidence: path.map(function (s) { return ix.byId[s.from].name + " → " + ix.byId[s.to].name + ": " + (s.rel.evidence || "No evidence note."); }),
        viz: { view: "network", centerNodeId: a.id, hop: 2 }, vizLabel: "Open the Ecosystem Network centred on " + a.name, confidence: minConfidence(D, path.map(function (s) { return s.rel; })) });
    }
    if (/\bgaps?\b|under ?connected|coverage|missing|\bwithout\b/.test(q)) {
      var gaps = coverageGaps(D, ix);
      return reply({ answer: gaps.length ? "Gaps in the published records:\n• " + gaps.join("\n• ") : "No coverage gaps were found in the published records.", viz: { view: "insights" }, vizLabel: "Open Insights" });
    }
    if (/how many|number of|\bcount\b|\btotal\b/.test(q)) {
      var pool = D.actors.filter(function (n) { return (!types.length || types.indexOf(n.type) !== -1) && (!states.length || states.some(function (s) { return s.code === n.state; })) && (!themes.length || (n.themes || []).indexOf(themes[0].id) !== -1); });
      if (types.length || states.length || themes.length) {
        var scope = (types.length ? types.map(function (t) { return plural(typeLabel(D, t)); }).join(" / ") : "organisations") + (states.length ? " in " + states[0].name : "") + (themes.length ? " linked to " + themes[0].name : "");
        return reply({ answer: "There " + (pool.length === 1 ? "is 1" : "are " + pool.length) + " published " + scope + (pool.length ? ": " + list(pool.map(function (n) { return n.name; })) + "." : "."), entities: pool.slice(0, 12).map(function (n) { return n.id; }) });
      }
      var byType = {};
      D.actors.forEach(function (n) { byType[n.type] = (byType[n.type] || 0) + 1; });
      return reply({ answer: "The published directory has " + D.actors.length + " organisations (" + Object.keys(byType).map(function (t) { return byType[t] + " " + (byType[t] === 1 ? typeLabel(D, t) : plural(typeLabel(D, t))); }).join(", ") + "), " + D.projectNodes.length + " project(s), " + D.themeNodes.length + " research theme(s) and " + D.relationships.length + " relationship(s)." });
    }
    if (!tooVague && entities.length) {
      var e = entities[0], links = ix.adj[e.id] || [];
      var meta = typeLabel(D, e.type) + (e.state ? ", " + e.state : "");
      if (!links.length) return reply({ answer: e.name + " (" + meta + ") has no published relationships.", entities: [e.id], viz: { view: "network", centerNodeId: e.id, hop: 2 }, vizLabel: "Open the Ecosystem Network centred on " + e.name });
      var grouped = {};
      links.forEach(function (l) { (grouped[l.rel.type] = grouped[l.rel.type] || []).push(ix.byId[l.to].name); });
      return reply({ answer: e.name + " (" + meta + ") has " + links.length + " published relationship" + (links.length === 1 ? "" : "s") + ". " + Object.keys(grouped).map(function (t) { return relLabel(D, t) + ": " + list(grouped[t]); }).join(". ") + ".",
        entities: [e.id].concat(links.map(function (l) { return l.to; })).filter(function (id, i, arr) { return arr.indexOf(id) === i; }).slice(0, 12),
        evidence: links.slice(0, 4).map(function (l) { return e.name + " ↔ " + ix.byId[l.to].name + ": " + (l.rel.evidence || "No evidence note."); }),
        viz: { view: "network", centerNodeId: e.id, hop: 2 }, vizLabel: "Open the Ecosystem Network centred on " + e.name, confidence: minConfidence(D, links.map(function (l) { return l.rel; })) });
    }
    if (!tooVague && themes.length) {
      var t = themes[0];
      var linked = D.allNodes.filter(function (n) {
        return n.type !== "research_theme" && (n.themes || []).indexOf(t.id) !== -1 && (!types.length || types.indexOf(n.type) !== -1) && (!states.length || states.some(function (s) { return s.code === n.state; }));
      });
      var rels = D.relationships.filter(function (r) { return (r.sourceId === t.id || r.targetId === t.id) && linked.some(function (n) { return n.id === r.sourceId || n.id === r.targetId; }); });
      return reply({ answer: linked.length ? linked.length + " published record" + (linked.length === 1 ? " is" : "s are") + " linked to " + t.name + ": " + list(linked.map(function (n) { return n.name + (n.state ? " (" + n.state + ")" : ""); })) + "." : "No published records match: nothing is linked to " + t.name + " for that filter.",
        entities: [t.id].concat(linked.map(function (n) { return n.id; })).slice(0, 12), evidence: rels.slice(0, 3).map(function (r) { return ix.byId[r.sourceId].name + " → " + ix.byId[r.targetId].name + ": " + (r.evidence || "No evidence note."); }),
        viz: { view: "directory", themeId: t.id }, vizLabel: "Open the Directory filtered to " + t.name, confidence: minConfidence(D, rels) });
    }
    if (!tooVague && (states.length || types.length)) {
      var found = D.actors.filter(function (n) { return (!types.length || types.indexOf(n.type) !== -1) && (!states.length || states.some(function (s) { return s.code === n.state; })); });
      var where = states.length ? " in " + states.map(function (s) { return s.name; }).join(" / ") : "";
      var what = types.length ? types.map(function (x) { return plural(typeLabel(D, x)); }).join(" / ") : "organisations";
      return reply({ answer: found.length ? found.length + " published " + what + where + ": " + list(found.map(function (n) { return n.name; })) + "." : "No published " + what + where + ".",
        entities: found.slice(0, 12).map(function (n) { return n.id; }), viz: states.length ? { view: "geo", stateCode: states[0].code } : { view: "directory" }, vizLabel: states.length ? "Open Geography for " + states[0].name : "Open the Directory" });
    }
    return refuse();
  }

  // Example questions built from what is published right now.
  function suggestions(D) {
    var ix = index(D), out = [];
    D.themeNodes.slice(0, 2).forEach(function (t) { out.push("Which organisations are linked to " + t.name + "?"); });
    var degrees = D.actors.map(function (a) { return { a: a, n: (ix.adj[a.id] || []).length }; }).filter(function (d) { return d.n > 0; }).sort(function (x, y) { return y.n - x.n; });
    if (degrees.length) out.push("What is " + degrees[0].a.name + " connected to?");
    if (D.actors.length) out.push("How many organisations are published?");
    if (D.actors.length) out.push("Where are the coverage gaps?");
    if (degrees.length > 1) {
      var first = degrees[0].a, other = (ix.adj[first.id] || []).map(function (e) { return ix.byId[e.to]; }).filter(function (n) { return n && n.type !== "research_theme" && n.type !== "project_initiative"; })[0];
      if (other) out.push("How are " + first.name + " and " + other.name + " connected?");
    }
    return out.slice(0, 6);
  }
  return { answer: answer, suggestions: suggestions, coverageGaps: function (D) { return coverageGaps(D, index(D)); } };
});
