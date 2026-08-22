(function () {
  "use strict";
  var D = window.RD_DATA;

  var GROUP_VAR = {
    research_performer: "--group-performer",
    infrastructure: "--group-infrastructure",
    industry_gov: "--group-industry",
    concept: "--group-concept",
  };
  var ORG_TYPES = ["crc", "university", "research_institute", "industry_partner", "government_agency", "incubator_accelerator"];
  var INFRA_TYPES = ["ncris_facility", "technology_precinct"];
  var OWNERSHIP = {
    crc: { cat: "mixed", label: "Mixed (CRC co-investment)" },
    university: { cat: "public", label: "Public (university sector)" },
    research_institute: { cat: "public", label: "Public / not-for-profit research institute" },
    ncris_facility: { cat: "public", label: "Public (national research infrastructure)" },
    technology_precinct: { cat: "mixed", label: "Mixed (precinct partnership)" },
    industry_partner: { cat: "private", label: "Private sector" },
    government_agency: { cat: "public", label: "Public (government agency)" },
    incubator_accelerator: { cat: "not-for-profit", label: "Not-for-profit / mixed" },
  };
  var VIEWS = ["overview", "directory", "network", "ai", "geo", "insights", "trust"];
  var SVG_NS = "http://www.w3.org/2000/svg";

  var state = {
    view: "overview",
    search: "",
    dirFilters: { types: new Set(), states: new Set(), sectors: new Set(), themes: new Set(), collab: new Set(), confidence: new Set(), decarbOnly: false, ownership: new Set() },
    netFilters: { relTypes: new Set(Object.keys(D.RELATIONSHIP_META)), theme: null },
    hop: 2,
    centerNodeId: "decarbonisation",
    selectedNodeId: null,
    selectedState: null,
    explainMode: false,
    explainFirst: null,
    pathHighlight: null,
    shortlist: new Set(),
    transform: { x: 0, y: 0, k: 1 },
    walkthrough: { active: false, index: 0 },
  };

  // ------------------------------------------------------------------ utils
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cap(str) {
    if (!str) return "";
    return String(str).replace(/[-_]/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function nodeById(id) { return D.allNodes.filter(function (n) { return n.id === id; })[0] || null; }
  function nodeName(id) { var n = nodeById(id); return n ? n.name : id; }
  function themeLabel(themeId) {
    var t = D.themeNodes.filter(function (x) { return x.id === themeId; })[0];
    return t ? t.name : cap(themeId);
  }
  function stateName(code) {
    var s = D.STATES.filter(function (x) { return x.code === code; })[0];
    return s ? s.name : code;
  }
  function ownershipInfo(type) { return OWNERSHIP[type] || null; }
  function ownershipCatLabel(cat) {
    var map = { public: "Public", private: "Private", "not-for-profit": "Not-for-profit", mixed: "Mixed" };
    return map[cat] || cap(cat);
  }
  function themeIdsOfNode(node) {
    if (node.type === "research_theme") return [node.id];
    return node.themes || [];
  }
  function isDecarbRelevant(node) {
    if (node.type === "research_theme") return node.id === "decarbonisation";
    return (node.themes || []).indexOf("decarbonisation") !== -1;
  }
  function allSectors() {
    var s = new Set();
    D.actors.forEach(function (a) { (a.sectors || []).forEach(function (x) { s.add(x); }); });
    return Array.from(s).sort();
  }
  function toggleSetMember(set, val) { if (set.has(val)) set.delete(val); else set.add(val); }
  function confidenceBadgeHTML(conf) {
    var meta = D.CONFIDENCE_META[conf] || { label: conf };
    return '<span class="confidence ' + esc(conf) + '"><span class="dot"></span>' + esc(meta.label) + "</span>";
  }
  function fieldRow(label, valueHTML) {
    if (valueHTML == null || valueHTML === "") return "";
    return '<div class="f"><dt>' + esc(label) + "</dt><dd>" + valueHTML + "</dd></div>";
  }
  function linkSpan(id) {
    var n = nodeById(id);
    return '<a href="#" class="entity-link" data-id="' + esc(id) + '">' + esc(n ? n.name : id) + "</a>";
  }
  function chipHTML(value, label, active, dotColor) {
    return '<button class="chip" data-value="' + esc(value) + '" aria-pressed="' + (active ? "true" : "false") + '">' +
      (dotColor ? '<span class="dot" style="background:' + dotColor + '"></span>' : "") + esc(label) + "</button>";
  }
  function filterGroupHTML(title, items) {
    return '<div class="filter-group"><h4>' + esc(title) + '</h4><div class="chip-row">' +
      items.map(function (it) { return chipHTML(it.value, it.label, it.active); }).join("") + "</div></div>";
  }

  // ------------------------------------------------------------- search/filter
  function nodeMatchesSearch(node, q) {
    if (!q) return true;
    var hay = [node.name, node.summary, (node.sectors || []).join(" "), (node.themes || []).join(" "),
      node.state, node.hostOrPartners, node.capability].filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }
  function nodePassesFilters(node) {
    var f = state.dirFilters;
    if (f.types.size && !f.types.has(node.type)) return false;
    if (f.states.size && (!node.state || !f.states.has(node.state))) return false;
    if (f.sectors.size && !(node.sectors || []).some(function (s) { return f.sectors.has(s); })) return false;
    if (f.themes.size) {
      var tids = themeIdsOfNode(node);
      if (!tids.some(function (t) { return f.themes.has(t); })) return false;
    }
    if (f.collab.size && (!node.collaborationSignal || !f.collab.has(node.collaborationSignal))) return false;
    if (f.confidence.size && !f.confidence.has(node.dataConfidence)) return false;
    if (f.decarbOnly && !isDecarbRelevant(node)) return false;
    if (f.ownership.size) {
      var oi = ownershipInfo(node.type);
      if (!oi || !f.ownership.has(oi.cat)) return false;
    }
    return true;
  }
  function resetDirFilters() {
    state.dirFilters = { types: new Set(), states: new Set(), sectors: new Set(), themes: new Set(), collab: new Set(), confidence: new Set(), decarbOnly: false, ownership: new Set() };
  }
  var GROUP_TITLE_TO_KEY = {
    "Actor type": "types", "State / territory": "states", Sector: "sectors",
    "Research theme": "themes", "Collaboration intensity": "collab", "Data confidence": "confidence", "Ownership type": "ownership",
  };

  // ------------------------------------------------------------------ views
  function switchView(view) {
    state.view = view;
    if (view !== "network" && view !== "directory") closeDrawer();
    if (view !== "network" && state.explainMode) { state.explainMode = false; state.explainFirst = null; resetNetHint(); updateExplainBanner(); }
    VIEWS.forEach(function (v) {
      var sec = document.getElementById("view-" + v);
      if (sec) sec.hidden = v !== view;
    });
    $$("#tabbar .tab-btn").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.view === view ? "true" : "false"); });
    if (view === "overview") renderOverview();
    else if (view === "directory") { renderDirFilterPanel(); renderDirectory(); }
    else if (view === "network") { renderNetFilterPanel(); renderGraph(); renderNetActions(); }
    else if (view === "ai") renderAI();
    else if (view === "geo") renderGeo();
    else if (view === "insights") renderInsights();
    else if (view === "trust") renderTrust();
  }

  // ---------------------------------------------------------------- overview
  function renderOverview() {
    $("#quickGrid").innerHTML =
      '<button class="quick-card" data-view="directory" aria-label="Search Directory: Find CRCs, NCRIS facilities, universities and more."><div class="qc-title">Search Directory</div><div class="qc-desc">Find CRCs, NCRIS facilities, universities and more.</div></button>' +
      '<button class="quick-card" data-view="network" aria-label="Explore Network: See how organisations and themes connect."><div class="qc-title">Explore Network</div><div class="qc-desc">See how organisations and themes connect.</div></button>' +
      '<button class="quick-card" data-view="ai" aria-label="Ask AI: Plain-English answers over the pilot dataset."><div class="qc-title">Ask AI</div><div class="qc-desc">Plain-English answers over the pilot dataset.</div></button>' +
      '<button class="quick-card" data-view="geo" aria-label="Browse Geography: See coverage and themes by state."><div class="qc-title">Browse Geography</div><div class="qc-desc">See coverage and themes by state.</div></button>';
    $$("#quickGrid .quick-card").forEach(function (c) { c.addEventListener("click", function () { switchView(c.dataset.view); }); });

    var crcCount = D.actors.filter(function (a) { return a.type === "crc"; }).length;
    var ncrisCount = D.actors.filter(function (a) { return a.type === "ncris_facility"; }).length;
    var uniCount = D.actors.filter(function (a) { return a.type === "university" || a.type === "research_institute"; }).length;
    var industryCount = D.actors.filter(function (a) { return a.type === "industry_partner"; }).length;
    var themeCount = D.themeNodes.length;
    var relCount = D.relationships.length;
    var metrics = [
      ["CRCs", crcCount], ["NCRIS facilities", ncrisCount], ["Universities & institutes", uniCount],
      ["Industry partners", industryCount], ["Research themes tracked", themeCount], ["Relationships mapped", relCount],
    ];
    $("#metricGrid").innerHTML = metrics.map(function (m) {
      return '<div class="metric-card"><div class="m-value">' + m[1] + '</div><div class="m-label">' + esc(m[0]) + "</div></div>";
    }).join("");
  }

  // --------------------------------------------------------------- directory
  function renderDirFilterPanel() {
    var f = state.dirFilters;
    var typeItems = Object.keys(D.TYPE_META).map(function (t) { return { value: t, label: D.TYPE_META[t].label, active: f.types.has(t) }; });
    var stateItems = D.STATES.map(function (s) { return { value: s.code, label: s.code, active: f.states.has(s.code) }; });
    var sectorItems = allSectors().map(function (s) { return { value: s, label: cap(s), active: f.sectors.has(s) }; });
    var themeItems = D.themeNodes.map(function (t) { return { value: t.id, label: t.name, active: f.themes.has(t.id) }; });
    var collabItems = ["high", "medium", "low"].map(function (c) { return { value: c, label: cap(c), active: f.collab.has(c) }; });
    var confItems = Object.keys(D.CONFIDENCE_META).map(function (c) { return { value: c, label: D.CONFIDENCE_META[c].label, active: f.confidence.has(c) }; });
    var ownershipItems = ["public", "private", "not-for-profit", "mixed"].map(function (c) { return { value: c, label: ownershipCatLabel(c), active: f.ownership.has(c) }; });

    $("#dirFilterPanel").innerHTML =
      filterGroupHTML("Actor type", typeItems) +
      filterGroupHTML("State / territory", stateItems) +
      filterGroupHTML("Sector", sectorItems) +
      filterGroupHTML("Research theme", themeItems) +
      filterGroupHTML("Collaboration intensity", collabItems) +
      filterGroupHTML("Data confidence", confItems) +
      '<div class="filter-group"><h4>Decarbonisation relevance</h4><div class="chip-row">' +
      chipHTML("decarb-only", "Decarbonisation-relevant only", f.decarbOnly) + "</div></div>" +
      filterGroupHTML("Ownership type", ownershipItems) +
      '<button class="btn-mini" id="dirResetBtn">Reset filters</button>';

    $$("#dirFilterPanel .chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var val = btn.dataset.value;
        if (val === "decarb-only") { f.decarbOnly = !f.decarbOnly; }
        else {
          var groupTitle = btn.closest(".filter-group").querySelector("h4").textContent;
          var key = GROUP_TITLE_TO_KEY[groupTitle];
          if (key) toggleSetMember(f[key], val);
        }
        renderDirFilterPanel();
        renderDirectory();
      });
    });
    var resetBtn = $("#dirResetBtn");
    if (resetBtn) resetBtn.addEventListener("click", function () { resetDirFilters(); renderDirFilterPanel(); renderDirectory(); });
  }

  function resultCardHTML(node) {
    var meta = D.TYPE_META[node.type];
    var groupVar = GROUP_VAR[meta.group];
    var ink = meta.group === "concept" ? "var(--group-concept-ink)" : "#fff";
    var tags = (node.sectors || []).map(function (s) { return '<span class="tag-pill">' + esc(cap(s)) + "</span>"; }).join("") +
      themeIdsOfNode(node).map(function (t) { return '<span class="tag-pill">' + esc(themeLabel(t)) + "</span>"; }).join("");
    return '<div class="result-card" data-id="' + esc(node.id) + '">' +
      '<div class="rc-top"><button class="rc-name-btn" title="Open details">' + esc(node.name) + '</button>' +
      '<span class="rc-type-badge" style="background:var(' + groupVar + ');color:' + ink + ';">' + esc(meta.label) + "</span></div>" +
      '<div class="rc-meta-row">' +
      (node.state ? "<span>" + esc(stateName(node.state)) + "</span>" : "") +
      (node.collaborationSignal ? "<span>Collaboration: " + esc(cap(node.collaborationSignal)) + "</span>" : "") +
      confidenceBadgeHTML(node.dataConfidence) +
      '<button class="why-btn" title="Why am I seeing this?" aria-label="Why am I seeing ' + esc(node.name) + '?">?</button></div>' +
      (tags ? '<div class="rc-tags">' + tags + "</div>" : "") +
      (node.evidenceSnippet ? '<div class="rc-evidence">' + esc(node.evidenceSnippet) + "</div>" : "") +
      '<div class="rc-bottom"><span style="font-size:11px;color:var(--ink-muted);">Updated ' + esc(node.lastUpdated || "") + "</span>" +
      '<div class="rc-actions"><button class="btn-mini view-in-network-btn">View in network</button>' +
      '<button class="btn-mini sl-toggle ' + (state.shortlist.has(node.id) ? "on" : "") + '">' +
      (state.shortlist.has(node.id) ? "★ Shortlisted" : "☆ Shortlist") + "</button></div></div></div>";
  }

  function renderDirectory() {
    var q = state.search.trim().toLowerCase();
    var results = D.allNodes.filter(function (n) { return nodeMatchesSearch(n, q) && nodePassesFilters(n); });
    $("#dirResultCount").textContent = results.length + " result" + (results.length === 1 ? "" : "s");
    $("#dirResultList").innerHTML = results.map(resultCardHTML).join("") ||
      '<div class="drawer-note">No results match the current filters. <button class="btn-mini" id="dirResetFiltersBtn">Reset filters</button></div>';
    var resetBtn = $("#dirResetFiltersBtn");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      state.search = "";
      $("#searchInput").value = "";
      resetDirFilters();
      renderDirFilterPanel();
      renderDirectory();
    });
    $$("#dirResultList .result-card").forEach(function (card) {
      var id = card.dataset.id;
      var node = nodeById(id);
      card.addEventListener("click", function (e) { if (e.target.closest("button")) return; openEntity(id); });
      var nameBtn = card.querySelector(".rc-name-btn");
      if (nameBtn) nameBtn.addEventListener("click", function (e) { e.stopPropagation(); openEntity(id); });
      var netBtn = card.querySelector(".view-in-network-btn");
      if (netBtn) netBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        state.centerNodeId = id;
        state.selectedNodeId = null;
        state.pathHighlight = null;
        switchView("network");
      });
      var slBtn = card.querySelector(".sl-toggle");
      if (slBtn) slBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleShortlist(id); renderDirectory(); });
      var whyBtn = card.querySelector(".why-btn");
      if (whyBtn) whyBtn.addEventListener("click", function (e) { e.stopPropagation(); showWhy(e, buildWhyHTML(node)); });
    });
  }

  function buildWhyHTML(node) {
    var reasons = [];
    if (state.search) reasons.push('Matches your search for "' + esc(state.search) + '".');
    var f = state.dirFilters;
    if (f.types.size && f.types.has(node.type)) reasons.push('Matches the active "' + esc(D.TYPE_META[node.type].label) + '" type filter.');
    if (f.states.size && node.state && f.states.has(node.state)) reasons.push("Located in the selected state (" + esc(stateName(node.state)) + ").");
    if (f.themes.size) {
      var matchedTheme = themeIdsOfNode(node).filter(function (x) { return f.themes.has(x); })[0];
      if (matchedTheme) reasons.push('Tagged with the selected research theme "' + esc(themeLabel(matchedTheme)) + '".');
    }
    if (f.decarbOnly && isDecarbRelevant(node)) reasons.push("Flagged as decarbonisation-relevant.");
    reasons.push("Data confidence: " + esc((D.CONFIDENCE_META[node.dataConfidence] || {}).label || node.dataConfidence) + ".");
    if (node.sourceNotes && node.sourceNotes.length) reasons.push("Sources: " + node.sourceNotes.map(esc).join("; ") + ".");
    if (node.evidenceSnippet) reasons.push('Evidence: "' + esc(node.evidenceSnippet) + '"');
    return "<h6>Why am I seeing this?</h6><ul style=\"margin:0;padding-left:16px;\">" + reasons.map(function (r) { return "<li>" + r + "</li>"; }).join("") + "</ul>";
  }
  function relationshipWhyHTML(r) {
    var label = (D.RELATIONSHIP_META[r.type] || {}).label || r.type;
    return "<h6>" + esc(label) + "</h6><p>" + esc(nodeName(r.sourceId)) + " → " + esc(nodeName(r.targetId)) + "</p>" +
      "<p>Intensity: " + esc(r.intensity) + " · " + confidenceBadgeHTML(r.confidence) + "</p>" +
      "<p>" + esc(r.evidence || "") + "</p>";
  }

  // -------------------------------------------------------------- why popover
  function ensureWhyPopover() {
    var el = document.getElementById("whyPopoverEl");
    if (!el) {
      el = document.createElement("div");
      el.id = "whyPopoverEl";
      el.className = "why-popover";
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }
  function hideWhy() {
    var pop = document.getElementById("whyPopoverEl");
    if (pop) pop.hidden = true;
    document.removeEventListener("click", outsideWhyClick);
    document.removeEventListener("keydown", escWhyClick);
  }
  function outsideWhyClick(e) {
    var pop = document.getElementById("whyPopoverEl");
    if (pop && !pop.contains(e.target)) hideWhy();
  }
  function escWhyClick(e) { if (e.key === "Escape") hideWhy(); }
  function showWhy(evt, html) {
    var pop = ensureWhyPopover();
    pop.innerHTML = '<button class="wp-close" aria-label="Close">✕</button>' + html;
    pop.hidden = false;
    var rect = evt.currentTarget.getBoundingClientRect();
    var left = rect.left, top = rect.bottom + 8;
    var maxLeft = window.innerWidth - 296;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    if (top > window.innerHeight - 160) top = rect.top - 8 - 140;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.querySelector(".wp-close").addEventListener("click", hideWhy);
    setTimeout(function () {
      document.addEventListener("click", outsideWhyClick);
      document.addEventListener("keydown", escWhyClick);
    }, 0);
  }

  // ------------------------------------------------------------ graph engine
  function buildAdjacency(relTypesFilter) {
    var adj = new Map();
    D.allNodes.forEach(function (n) { adj.set(n.id, []); });
    D.relationships.forEach(function (r) {
      if (relTypesFilter && !relTypesFilter.has(r.type)) return;
      if (!adj.has(r.sourceId) || !adj.has(r.targetId)) return;
      adj.get(r.sourceId).push({ to: r.targetId, rel: r });
      adj.get(r.targetId).push({ to: r.sourceId, rel: r });
    });
    return adj;
  }
  function bfsLayer(startId, maxHop, relTypesFilter) {
    var adj = buildAdjacency(relTypesFilter);
    var dist = new Map([[startId, 0]]);
    var queue = [startId];
    while (queue.length) {
      var cur = queue.shift();
      var d = dist.get(cur);
      if (d >= maxHop) continue;
      (adj.get(cur) || []).forEach(function (edge) {
        if (!dist.has(edge.to)) { dist.set(edge.to, d + 1); queue.push(edge.to); }
      });
    }
    return dist;
  }
  function nodeMatchesTheme(id, themeId) {
    if (id === themeId) return true;
    var n = nodeById(id);
    return n ? themeIdsOfNode(n).indexOf(themeId) !== -1 : false;
  }
  function computeLayout() {
    var dist = bfsLayer(state.centerNodeId, state.hop, state.netFilters.relTypes);
    var nodeIds = Array.from(dist.keys());
    if (state.netFilters.theme) {
      nodeIds = nodeIds.filter(function (id) { return id === state.centerNodeId || nodeMatchesTheme(id, state.netFilters.theme); });
    }
    var center = { x: 560, y: 380 };
    var positions = new Map();
    positions.set(state.centerNodeId, center);
    var byHop = {};
    nodeIds.forEach(function (id) {
      if (id === state.centerNodeId) return;
      var h = dist.get(id);
      byHop[h] = byHop[h] || [];
      byHop[h].push(id);
    });
    Object.keys(byHop).forEach(function (hStr) {
      var h = Number(hStr);
      var ids = byHop[hStr];
      var radius = 190 * h;
      var n = ids.length;
      var offset = h % 2 === 0 ? 0 : Math.PI / n;
      ids.forEach(function (id, i) {
        var angle = (2 * Math.PI * i) / n + offset - Math.PI / 2;
        positions.set(id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
      });
    });
    return { nodeIds: nodeIds, positions: positions, dist: dist };
  }
  function elSvg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) { if (attrs[k] != null) node.setAttribute(k, attrs[k]); }
    if (text != null) node.textContent = text;
    return node;
  }
  function textWidth(str, size) { return String(str).length * size * 0.56; }

  function renderGraph() {
    var layout = computeLayout();
    var nodeSet = new Set(layout.nodeIds);
    var edgesLayer = $("#edgesLayer"), nodesLayer = $("#nodesLayer");
    edgesLayer.innerHTML = "";
    nodesLayer.innerHTML = "";
    var relSet = state.netFilters.relTypes;
    var ph = state.pathHighlight;

    D.relationships.forEach(function (r) {
      if (relSet && !relSet.has(r.type)) return;
      if (!nodeSet.has(r.sourceId) || !nodeSet.has(r.targetId)) return;
      var p1 = layout.positions.get(r.sourceId), p2 = layout.positions.get(r.targetId);
      if (!p1 || !p2) return;
      var classes = ["edge-group"];
      if (ph) { classes.push(ph.edgeIds.has(r.id) ? "path-hi" : "dimmed"); }
      else if (state.selectedNodeId && (r.sourceId === state.selectedNodeId || r.targetId === state.selectedNodeId)) { classes.push("focused"); }
      var g = elSvg("g", { class: classes.join(" "), "data-edge-id": r.id });
      var line = elSvg("line", { class: "edge-line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      if (r.confidence === "needs-review" || r.confidence === "stale" || r.type === "potential_connection") {
        line.setAttribute("stroke-dasharray", "5 4");
      }
      g.appendChild(line);
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      var label = (D.RELATIONSHIP_META[r.type] || {}).label || r.type;
      var tw = textWidth(label, 9.5);
      g.appendChild(elSvg("rect", { class: "edge-label-bg", x: mx - tw / 2 - 3, y: my - 7, width: tw + 6, height: 13, rx: 3 }));
      g.appendChild(elSvg("text", { class: "edge-label-text", x: mx, y: my + 3, "text-anchor": "middle" }, label));
      g.addEventListener("click", function (e) { e.stopPropagation(); showWhy(e, relationshipWhyHTML(r)); });
      edgesLayer.appendChild(g);
    });

    layout.nodeIds.forEach(function (id) {
      var node = nodeById(id);
      if (!node) return;
      var pos = layout.positions.get(id);
      var meta = D.TYPE_META[node.type];
      var groupVar = GROUP_VAR[meta.group];
      var isConcept = meta.group === "concept";
      var classes = ["node-group"];
      if (state.selectedNodeId === id) classes.push("selected");
      if (ph) classes.push(ph.nodeIds.has(id) ? "path-hi" : "dimmed");
      var g = elSvg("g", { class: classes.join(" "), transform: "translate(" + pos.x + "," + pos.y + ")", "data-node-id": id });
      g.appendChild(elSvg("circle", { class: "halo", r: 26, fill: "var(" + groupVar + ")" }));
      if (isConcept) {
        g.appendChild(elSvg("rect", { class: "core", x: -15, y: -15, width: 30, height: 30, rx: 4, transform: "rotate(45)", fill: "var(" + groupVar + ")", stroke: "var(--surface)", "stroke-width": 2 }));
      } else {
        g.appendChild(elSvg("circle", { class: "core", r: 16, fill: "var(" + groupVar + ")" }));
      }
      var iconSize = 16;
      var iconInk = isConcept ? "var(--group-concept-ink)" : "#fff";
      g.appendChild(elSvg("use", { href: "#" + meta.icon, x: -iconSize / 2, y: -iconSize / 2, width: iconSize, height: iconSize, color: iconInk }));
      var tw = textWidth(node.name, 11);
      g.appendChild(elSvg("rect", { class: "label-bg", x: -tw / 2 - 4, y: 24, width: tw + 8, height: 15, rx: 4 }));
      var t = elSvg("text", { class: "label-text", x: 0, y: 35, "text-anchor": "middle" }, node.name);
      t.style.fontSize = "11px";
      g.appendChild(t);
      g.addEventListener("click", function (e) { e.stopPropagation(); handleNodeClick(id); });
      nodesLayer.appendChild(g);
    });
  }

  function handleNodeClick(id) {
    if (state.explainMode) {
      if (!state.explainFirst) {
        state.explainFirst = id;
        setNetHint('Now click a second node to explain its connection to "' + nodeName(id) + '".');
        updateExplainBanner();
        return;
      }
      var a = state.explainFirst, b = id;
      state.explainMode = false;
      state.explainFirst = null;
      resetNetHint();
      updateExplainBanner();
      runExplainConnection(a, b);
      return;
    }
    state.selectedNodeId = state.selectedNodeId === id ? null : id;
    renderGraph();
    renderNetActions();
    if (state.selectedNodeId) openEntity(state.selectedNodeId);
  }

  function shortestPath(aId, bId) {
    if (aId === bId) return { nodes: [aId], edges: [] };
    var adj = buildAdjacency(null);
    var parent = new Map([[aId, null]]);
    var parentEdge = new Map();
    var queue = [aId];
    while (queue.length) {
      var cur = queue.shift();
      if (cur === bId) break;
      (adj.get(cur) || []).forEach(function (edge) {
        if (!parent.has(edge.to)) { parent.set(edge.to, cur); parentEdge.set(edge.to, edge.rel); queue.push(edge.to); }
      });
    }
    if (!parent.has(bId)) return null;
    var nodes = [bId], edges = [];
    var cur2 = bId;
    while (cur2 !== aId) {
      edges.unshift(parentEdge.get(cur2));
      cur2 = parent.get(cur2);
      nodes.unshift(cur2);
    }
    return { nodes: nodes, edges: edges };
  }
  function runExplainConnection(aId, bId) {
    switchView("network");
    var result = shortestPath(aId, bId);
    if (!result) {
      openInfoDrawer("No connection found", 'No path could be found between "' + nodeName(aId) + '" and "' + nodeName(bId) + '" in the current dataset.');
      return;
    }
    state.pathHighlight = { nodeIds: new Set(result.nodes), edgeIds: new Set(result.edges.map(function (e) { return e.id; })) };
    renderGraph();
    renderConnectionDrawer(aId, bId, result);
  }
  function renderConnectionDrawer(aId, bId, result) {
    var stepsHTML = result.edges.map(function (r, i) {
      var fromId = result.nodes[i], toId = result.nodes[i + 1];
      var relLabel = (D.RELATIONSHIP_META[r.type] || {}).label || r.type;
      return '<div class="rel-card"><div>' + esc(nodeName(fromId)) + " → <strong>" + esc(relLabel) + "</strong> → " + esc(nodeName(toId)) + "</div>" +
        '<div class="rc-meta-row"><span>Intensity: ' + esc(r.intensity) + "</span>" + confidenceBadgeHTML(r.confidence) + "</div>" +
        '<div class="rc-evidence">' + esc(r.evidence || "") + "</div></div>";
    }).join("");
    $("#drawerIcon").style.background = "var(--brand-tint)";
    $("#drawerIcon").style.color = "var(--brand-strong)";
    $("#drawerIcon").innerHTML = "⇄";
    $("#drawerTitle").textContent = "Connection: " + nodeName(aId) + " ↔ " + nodeName(bId);
    $("#drawerSub").textContent = result.edges.length + " hop" + (result.edges.length === 1 ? "" : "s");
    $("#drawerBody").innerHTML = "<p>" + esc(nodeName(aId)) + " connects to " + esc(nodeName(bId)) + " via " + result.edges.length +
      " relationship" + (result.edges.length === 1 ? "" : "s") + " in the current dataset.</p>" +
      '<div class="field-grid">' + stepsHTML + "</div>" +
      '<button class="btn-mini" id="clearPathBtn">Clear highlight</button>';
    openDrawer();
    $("#clearPathBtn").addEventListener("click", function () { state.pathHighlight = null; renderGraph(); closeDrawer(); });
  }
  function strongestCollaborationPath(startId, maxHop) {
    var rankOf = { strong: 3, medium: 2, weak: 1 };
    var path = [startId], edges = [];
    var visited = new Set([startId]);
    var current = startId;
    for (var h = 0; h < maxHop; h++) {
      var candidates = D.relationships.filter(function (r) { return r.type === "collaborates_with" && (r.sourceId === current || r.targetId === current); });
      var best = null;
      candidates.forEach(function (r) {
        var other = r.sourceId === current ? r.targetId : r.sourceId;
        if (visited.has(other)) return;
        var rank = rankOf[r.intensity] || 0;
        if (!best || rank > best.rank) best = { rel: r, other: other, rank: rank };
      });
      if (!best) break;
      path.push(best.other);
      edges.push(best.rel);
      visited.add(best.other);
      current = best.other;
    }
    return { path: path, edges: edges };
  }
  function renderStrongestPathDrawer(startId, result) {
    if (!result.edges.length) {
      openInfoDrawer("No collaboration path found", 'No "collaborates_with" edges were found from ' + nodeName(startId) + " within " + state.hop + " hop(s).");
      return;
    }
    state.pathHighlight = { nodeIds: new Set(result.path), edgeIds: new Set(result.edges.map(function (e) { return e.id; })) };
    renderGraph();
    var stepsHTML = result.edges.map(function (r, i) {
      var fromId = result.path[i], toId = result.path[i + 1];
      return '<div class="rel-card"><div>' + esc(nodeName(fromId)) + " → <strong>Collaborates with</strong> → " + esc(nodeName(toId)) + "</div>" +
        '<div class="rc-meta-row"><span>Intensity: ' + esc(r.intensity) + "</span>" + confidenceBadgeHTML(r.confidence) + "</div>" +
        '<div class="rc-evidence">' + esc(r.evidence || "") + "</div></div>";
    }).join("");
    $("#drawerIcon").style.background = "var(--brand-tint)";
    $("#drawerIcon").style.color = "var(--brand-strong)";
    $("#drawerIcon").innerHTML = "↗";
    $("#drawerTitle").textContent = "Strongest collaboration path from " + nodeName(startId);
    $("#drawerSub").textContent = result.edges.length + " hop" + (result.edges.length === 1 ? "" : "s");
    $("#drawerBody").innerHTML = '<div class="field-grid">' + stepsHTML + '</div><button class="btn-mini" id="clearPathBtn">Clear highlight</button>';
    openDrawer();
    $("#clearPathBtn").addEventListener("click", function () { state.pathHighlight = null; renderGraph(); closeDrawer(); });
  }

  function setNetHint(text) { var el = document.querySelector("#canvasWrap .net-hint"); if (el) el.textContent = text; }
  function resetNetHint() { setNetHint("Drag to pan · scroll to zoom · click empty space to clear selection"); }
  function updateExplainBanner() {
    var btn = $("#explainBtn");
    var banner = $("#explainBanner");
    btn.setAttribute("aria-pressed", String(state.explainMode));
    if (!state.explainMode) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.textContent = state.explainFirst
      ? 'Explain mode: now click a second node to connect to "' + nodeName(state.explainFirst) + '".'
      : "Explain mode: click a first node, then a second.";
  }
  function renderNetActions() {
    var center = nodeById(state.centerNodeId);
    var html = '<span class="demo-badge" style="background:var(--surface);">Centre: ' + esc(center ? center.name : "—") + "</span>";
    if (state.netFilters.theme) {
      html += '<span class="demo-badge">Theme filter: ' + esc(themeLabel(state.netFilters.theme)) +
        ' <button style="all:unset;cursor:pointer;margin-left:4px;" id="netThemeClearBtn">✕</button></span>';
    }
    $("#netActions").innerHTML = html;
    var clearBtn = $("#netThemeClearBtn");
    if (clearBtn) clearBtn.addEventListener("click", function () { state.netFilters.theme = null; renderNetActions(); renderGraph(); });
  }
  function renderNetFilterPanel() {
    var centerOptions = D.allNodes.map(function (n) {
      return '<option value="' + esc(n.id) + '"' + (state.centerNodeId === n.id ? " selected" : "") + ">" + esc(n.name) + "</option>";
    }).join("");
    var relItems = Object.keys(D.RELATIONSHIP_META);
    $("#netFilterPanel").innerHTML =
      '<div class="filter-group"><h4>Centre node</h4><select id="netCenterSelect" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--canvas);color:var(--ink);">' +
      centerOptions + "</select></div>" +
      '<div class="filter-group"><h4>Relationship types</h4><div class="chip-row">' +
      relItems.map(function (t) { return chipHTML(t, D.RELATIONSHIP_META[t].label, state.netFilters.relTypes.has(t)); }).join("") + "</div></div>" +
      '<div class="filter-group"><h4>Legend</h4><div class="legend-mini">' +
      '<div class="row"><span class="sw" style="background:var(--group-performer);"></span>Research performer (CRC / university / institute)</div>' +
      '<div class="row"><span class="sw" style="background:var(--group-infrastructure);"></span>Infrastructure (NCRIS facility / precinct)</div>' +
      '<div class="row"><span class="sw" style="background:var(--group-industry);"></span>Industry &amp; government</div>' +
      '<div class="row"><span class="sw concept" style="background:var(--group-concept);"></span>Theme / project (shape-coded)</div>' +
      "</div></div>";
    $("#netCenterSelect").addEventListener("change", function (e) {
      state.centerNodeId = e.target.value; state.selectedNodeId = null; state.pathHighlight = null;
      renderGraph(); renderNetActions();
    });
    $$("#netFilterPanel .chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var val = btn.dataset.value;
        toggleSetMember(state.netFilters.relTypes, val);
        renderNetFilterPanel();
        renderGraph();
      });
    });
  }

  // -------------------------------------------------------------- pan / zoom
  function applyTransform() {
    var t = state.transform;
    $("#viewport").setAttribute("transform", "translate(" + t.x + "," + t.y + ") scale(" + t.k + ")");
  }
  function zoomBy(factor) {
    var t = state.transform, cx = 560, cy = 380;
    var worldX = (cx - t.x) / t.k, worldY = (cy - t.y) / t.k;
    var k2 = Math.max(0.4, Math.min(2.5, t.k * factor));
    state.transform = { x: cx - worldX * k2, y: cy - worldY * k2, k: k2 };
    applyTransform();
  }
  function setupCanvasInteractions() {
    var svgEl = $("#graphSvg");
    var pan = { active: false, moved: false, startX: 0, startY: 0, startTransform: null };
    svgEl.addEventListener("mousedown", function (e) {
      if (e.target.closest(".node-group")) return;
      pan.active = true; pan.moved = false;
      pan.startX = e.clientX; pan.startY = e.clientY;
      pan.startTransform = { x: state.transform.x, y: state.transform.y, k: state.transform.k };
      svgEl.classList.add("panning");
    });
    window.addEventListener("mousemove", function (e) {
      if (!pan.active) return;
      var dx = e.clientX - pan.startX, dy = e.clientY - pan.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pan.moved = true;
      var rect = svgEl.getBoundingClientRect();
      var scaleX = 1120 / rect.width, scaleY = 760 / rect.height;
      state.transform.x = pan.startTransform.x + dx * scaleX;
      state.transform.y = pan.startTransform.y + dy * scaleY;
      applyTransform();
    });
    window.addEventListener("mouseup", function () {
      if (pan.active && !pan.moved) {
        if (state.explainMode) { state.explainMode = false; state.explainFirst = null; resetNetHint(); updateExplainBanner(); }
        else if (state.selectedNodeId) { state.selectedNodeId = null; renderGraph(); renderNetActions(); }
      }
      pan.active = false;
      svgEl.classList.remove("panning");
    });
    svgEl.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = svgEl.getBoundingClientRect();
      var scaleX = 1120 / rect.width, scaleY = 760 / rect.height;
      var cx = (e.clientX - rect.left) * scaleX, cy = (e.clientY - rect.top) * scaleY;
      var t = state.transform;
      var worldX = (cx - t.x) / t.k, worldY = (cy - t.y) / t.k;
      var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      var k2 = Math.max(0.4, Math.min(2.5, t.k * factor));
      state.transform = { x: cx - worldX * k2, y: cy - worldY * k2, k: k2 };
      applyTransform();
    }, { passive: false });
    $("#zoomIn").addEventListener("click", function () { zoomBy(1.2); });
    $("#zoomOut").addEventListener("click", function () { zoomBy(1 / 1.2); });
    $("#zoomReset").addEventListener("click", function () { state.transform = { x: 0, y: 0, k: 1 }; applyTransform(); });
  }

  // ------------------------------------------------------------- entity drawer
  function drawerActionsHTML(node) {
    var inList = state.shortlist.has(node.id);
    return '<div class="drawer-actions"><button class="btn-mini ' + (inList ? "on" : "") + '" id="drawerShortlistBtn">' +
      (inList ? "★ In shortlist" : "☆ Add to shortlist") + "</button>" +
      '<button class="btn-mini" id="drawerCenterBtn">Centre network here</button></div>';
  }
  function connectionsHTML(node) {
    var rels = D.relationships.filter(function (r) { return r.sourceId === node.id || r.targetId === node.id; });
    if (!rels.length) return '<div class="drawer-note">No mapped relationships for this entity yet.</div>';
    return '<div class="field-grid">' + rels.map(function (r) { return relCardHTML(r, node.id); }).join("") + "</div>";
  }
  function relCardHTML(r, fromId) {
    var otherId = r.sourceId === fromId ? r.targetId : r.sourceId;
    var relLabel = (D.RELATIONSHIP_META[r.type] || {}).label || r.type;
    return '<div class="rel-card"><div><strong>' + esc(relLabel) + "</strong> — " + linkSpan(otherId) + "</div>" +
      '<div class="rc-meta-row"><span>Intensity: ' + esc(r.intensity) + "</span>" + confidenceBadgeHTML(r.confidence) + "</div>" +
      '<div class="rc-evidence">' + esc(r.evidence || "") + "</div></div>";
  }
  function orgBodyHTML(node) {
    return "<p>" + esc(node.summary || "") + '</p><dl class="field-grid">' +
      fieldRow("State", node.state ? esc(stateName(node.state)) : "") +
      fieldRow("Sectors", (node.sectors || []).map(function (s) { return '<span class="tag-pill">' + esc(cap(s)) + "</span>"; }).join(" ")) +
      fieldRow("Research themes", (node.themes || []).map(function (t) { return '<span class="tag-pill">' + esc(themeLabel(t)) + "</span>"; }).join(" ")) +
      fieldRow("Host / partners", node.hostOrPartners ? esc(node.hostOrPartners) : "") +
      fieldRow("Active initiatives", (node.activeInitiatives || []).map(esc).join(", ")) +
      fieldRow("Industry partners", (node.industryPartners || []).map(linkSpan).join(", ")) +
      fieldRow("Related facilities", (node.relatedFacilities || []).map(linkSpan).join(", ")) +
      fieldRow("Collaboration signal", node.collaborationSignal ? cap(node.collaborationSignal) : "") +
      fieldRow("Data confidence", confidenceBadgeHTML(node.dataConfidence)) +
      fieldRow("Last updated", node.lastUpdated) + "</dl>" +
      (node.evidenceSnippet ? '<div class="rc-evidence">' + esc(node.evidenceSnippet) + "</div>" : "") +
      drawerActionsHTML(node) +
      '<div class="section-label" style="margin:6px 0 0;">Mapped connections</div>' + connectionsHTML(node) +
      (node.sourceNotes && node.sourceNotes.length ? '<div class="drawer-note">Sources: ' + node.sourceNotes.map(esc).join("; ") + "</div>" : "");
  }
  function infraBodyHTML(node) {
    return "<p>" + esc(node.summary || "") + '</p><dl class="field-grid">' +
      fieldRow("State", node.state ? esc(stateName(node.state)) : "") +
      fieldRow("Sectors", (node.sectors || []).map(function (s) { return '<span class="tag-pill">' + esc(cap(s)) + "</span>"; }).join(" ")) +
      fieldRow("Research themes", (node.themes || []).map(function (t) { return '<span class="tag-pill">' + esc(themeLabel(t)) + "</span>"; }).join(" ")) +
      fieldRow("Capability", node.capability ? esc(node.capability) : "") +
      fieldRow("Access model", node.accessModel ? esc(node.accessModel) : "") +
      fieldRow("Data confidence", confidenceBadgeHTML(node.dataConfidence)) +
      fieldRow("Last updated", node.lastUpdated) + "</dl>" +
      (node.evidenceSnippet ? '<div class="rc-evidence">' + esc(node.evidenceSnippet) + "</div>" : "") +
      drawerActionsHTML(node) +
      '<div class="section-label" style="margin:6px 0 0;">Mapped connections</div>' + connectionsHTML(node) +
      (node.sourceNotes && node.sourceNotes.length ? '<div class="drawer-note">Sources: ' + node.sourceNotes.map(esc).join("; ") + "</div>" : "");
  }
  function themeBodyHTML(node) {
    return "<p>" + esc(node.summary || "") + '</p><dl class="field-grid">' +
      fieldRow("Geographic distribution", node.geographicDistribution ? esc(node.geographicDistribution) : "") +
      fieldRow("Historical trend", node.historicalTrend ? esc(node.historicalTrend) : "") +
      fieldRow("Key actors", (node.keyActorIds || []).map(linkSpan).join(", ")) +
      fieldRow("Related projects", (node.relatedProjects || []).map(linkSpan).join(", ")) +
      fieldRow("Data confidence", confidenceBadgeHTML(node.dataConfidence)) +
      fieldRow("Last updated", node.lastUpdated) + "</dl>" +
      (node.gaps && node.gaps.length ? '<div><div class="section-label" style="margin:6px 0 8px;">Known gaps</div><ul class="gap-list">' +
        node.gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul></div>" : "") +
      drawerActionsHTML(node) +
      '<div class="section-label" style="margin:6px 0 0;">Mapped connections</div>' + connectionsHTML(node);
  }
  function projectBodyHTML(node) {
    return "<p>" + esc(node.summary || "") + '</p><dl class="field-grid">' +
      fieldRow("Host", node.hostId ? linkSpan(node.hostId) : "") +
      fieldRow("State", node.state ? esc(stateName(node.state)) : "") +
      fieldRow("Themes", (node.themes || []).map(function (t) { return '<span class="tag-pill">' + esc(themeLabel(t)) + "</span>"; }).join(" ")) +
      fieldRow("Data confidence", confidenceBadgeHTML(node.dataConfidence)) +
      fieldRow("Last updated", node.lastUpdated) + "</dl>" +
      (node.evidenceSnippet ? '<div class="rc-evidence">' + esc(node.evidenceSnippet) + "</div>" : "") +
      drawerActionsHTML(node) +
      '<div class="section-label" style="margin:6px 0 0;">Mapped connections</div>' + connectionsHTML(node);
  }
  function entityBodyHTML(node) {
    if (ORG_TYPES.indexOf(node.type) !== -1) return orgBodyHTML(node);
    if (INFRA_TYPES.indexOf(node.type) !== -1) return infraBodyHTML(node);
    if (node.type === "research_theme") return themeBodyHTML(node);
    if (node.type === "project_initiative") return projectBodyHTML(node);
    return "<p>" + esc(node.summary || "") + "</p>";
  }
  function setDrawerIcon(node) {
    var meta = D.TYPE_META[node.type] || {};
    var groupVar = GROUP_VAR[meta.group] || "--brand";
    var ink = meta.group === "concept" ? "var(--group-concept-ink)" : "#fff";
    var el = $("#drawerIcon");
    el.style.background = "var(" + groupVar + ")";
    el.style.color = ink;
    el.innerHTML = meta.icon ? '<svg viewBox="0 0 24 24"><use href="#' + meta.icon + '"></use></svg>' : "";
  }
  function wireEntityBody(node) {
    var sBtn = document.getElementById("drawerShortlistBtn");
    if (sBtn) sBtn.addEventListener("click", function () { toggleShortlist(node.id); openEntity(node.id); });
    var cBtn = document.getElementById("drawerCenterBtn");
    if (cBtn) cBtn.addEventListener("click", function () {
      state.centerNodeId = node.id; state.selectedNodeId = null; state.pathHighlight = null; switchView("network");
    });
  }
  function openEntity(id) {
    var node = nodeById(id);
    if (!node) return;
    state.selectedNodeId = id;
    setDrawerIcon(node);
    $("#drawerTitle").textContent = node.name;
    $("#drawerSub").textContent = (D.TYPE_META[node.type] || {}).label || "";
    $("#drawerBody").innerHTML = entityBodyHTML(node);
    wireEntityBody(node);
    openDrawer();
    if (state.view === "network") { renderGraph(); renderNetActions(); }
  }
  function openDrawer() {
    var d = $("#drawer");
    d.hidden = false;
    d.removeAttribute("inert");
    d.classList.add("open");
  }
  function closeDrawer() {
    var d = $("#drawer");
    d.classList.remove("open");
    d.setAttribute("inert", "");
    setTimeout(function () { if (!d.classList.contains("open")) d.hidden = true; }, 220);
  }
  function openInfoDrawer(title, text) {
    $("#drawerIcon").style.background = "var(--brand-tint)";
    $("#drawerIcon").style.color = "var(--brand-strong)";
    $("#drawerIcon").innerHTML = "ℹ";
    $("#drawerTitle").textContent = title;
    $("#drawerSub").textContent = "";
    $("#drawerBody").innerHTML = "<p>" + esc(text) + "</p>";
    openDrawer();
  }

  // ------------------------------------------------------------------ shortlist
  function toggleShortlist(id) {
    if (state.shortlist.has(id)) state.shortlist.delete(id); else state.shortlist.add(id);
    updateShortlistBadge();
    if ($("#shortlistDrawer").classList.contains("open")) renderShortlistDrawer();
  }
  function updateShortlistBadge() { $("#shortlistCount").textContent = state.shortlist.size; }
  function briefingHTML(ids) {
    var nodes = ids.map(nodeById).filter(Boolean);
    var sectors = new Set();
    nodes.forEach(function (n) { (n.sectors || []).forEach(function (s) { sectors.add(s); }); });

    var actorsHTML = nodes.map(function (n) {
      var bits = [];
      if (n.collaborationSignal) bits.push(cap(n.collaborationSignal) + " collaboration signal");
      if (n.dataConfidence) bits.push((D.CONFIDENCE_META[n.dataConfidence] || {}).label || n.dataConfidence);
      var themeLabels = themeIdsOfNode(n).map(themeLabel);
      if (themeLabels.length) bits.push("active in " + themeLabels.join(", "));
      return "<div><h5>" + esc(n.name) + "</h5><p>" + esc(n.summary || n.capability || "") + "</p>" +
        (bits.length ? '<p style="font-size:12px;color:var(--ink-secondary);">Why it matters: ' + esc(bits.join(" · ")) + "</p>" : "") +
        "<p>" + confidenceBadgeHTML(n.dataConfidence) + "</p></div>";
    }).join("");

    var pathways = [];
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var res = shortestPath(nodes[i].id, nodes[j].id);
        if (res && res.nodes && res.nodes.length > 1) pathways.push(res.nodes.map(nodeName).join(" → "));
      }
    }
    var pathwayHTML = '<div><h5>Collaboration pathway</h5>' + (pathways.length
      ? '<ul class="list-compact">' + pathways.slice(0, 4).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>"
      : '<p style="font-size:12.5px;color:var(--ink-muted);">No connecting path found between shortlisted entities in this pilot subset.</p>') + "</div>";

    var shortlistedThemeIds = new Set();
    nodes.forEach(function (n) { themeIdsOfNode(n).forEach(function (t) { shortlistedThemeIds.add(t); }); });
    var terms = [];
    nodes.forEach(function (n) { terms.push(n.name.toLowerCase()); if (n.state) terms.push(stateName(n.state).toLowerCase()); });
    shortlistedThemeIds.forEach(function (t) { terms.push(themeLabel(t).toLowerCase()); });
    var gaps = (D.insights.decarbonisationGaps || []).filter(function (g) {
      var gl = g.toLowerCase();
      return terms.some(function (t) { return t && gl.indexOf(t) !== -1; });
    });
    var gapsHTML = gaps.length
      ? '<div><h5>Relevant data gaps</h5><ul class="list-compact">' + gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul></div>"
      : "";

    var followUps = D.questions.filter(function (q) {
      return (q.relevantEntityIds || []).some(function (id) {
        var n = nodeById(id);
        return n && themeIdsOfNode(n).some(function (t) { return shortlistedThemeIds.has(t); });
      });
    }).map(function (q) { return q.query; });
    if (!followUps.length) followUps = D.questions.slice(0, 2).map(function (q) { return q.query; });
    followUps = followUps.slice(0, 3);
    var followUpsHTML = '<div><h5>Suggested AI Discovery follow-ups</h5><div class="chips">' +
      followUps.map(function (q) { return '<button class="btn-mini briefing-followup" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div></div>";

    return '<div class="briefing"><div><h5>Briefing preview</h5><p>' + nodes.length + " entities shortlisted across " + sectors.size +
      " sector(s). This is an illustrative preview only, generated locally from mock data — no external report is produced.</p></div>" +
      actorsHTML + pathwayHTML + gapsHTML + followUpsHTML + "</div>";
  }
  function renderShortlistDrawer() {
    var ids = Array.from(state.shortlist);
    $("#shortlistSub").textContent = ids.length + (ids.length === 1 ? " item" : " items");
    if (!ids.length) {
      $("#shortlistBody").innerHTML = '<div class="drawer-note">No entities shortlisted yet. Use the ☆ Shortlist button on directory cards or entity profiles.</div>';
      return;
    }
    $("#shortlistBody").innerHTML = "<div>" + ids.map(function (id) {
      var n = nodeById(id);
      if (!n) return "";
      return '<div class="shortlist-item"><div><div class="si-name">' + esc(n.name) + '</div><div class="si-type">' +
        esc((D.TYPE_META[n.type] || {}).label || n.type) + '</div></div><button class="btn-mini" data-remove="' + esc(id) + '">Remove</button></div>';
    }).join("") + '</div><button class="icon-btn primary" id="generateBriefingBtn">Generate briefing</button><div id="briefingOutput"></div>';
    $$("#shortlistBody [data-remove]").forEach(function (btn) { btn.addEventListener("click", function () { toggleShortlist(btn.dataset.remove); }); });
    var genBtn = $("#generateBriefingBtn");
    if (genBtn) genBtn.addEventListener("click", function () {
      $("#briefingOutput").innerHTML = briefingHTML(ids);
      $$("#briefingOutput .briefing-followup").forEach(function (b) {
        b.addEventListener("click", function () {
          switchView("ai");
          $("#aiInput").value = b.dataset.q;
          askAI(b.dataset.q);
        });
      });
    });
  }

  // -------------------------------------------------------------- AI discovery
  function matchQuestion(query) {
    var q = query.toLowerCase();
    var best = null, bestScore = 0;
    D.questions.forEach(function (item) {
      var score = 0;
      (item.matchKeywords || []).forEach(function (k) { if (q.indexOf(k.toLowerCase()) !== -1) score++; });
      if (score > bestScore) { bestScore = score; best = item; }
    });
    return bestScore > 0 ? best : null;
  }
  function linkChip(id) {
    var n = nodeById(id);
    if (!n) return "";
    return '<button class="btn-mini entity-chip" data-id="' + esc(id) + '">' + esc(n.name) + "</button>";
  }
  function applyVizAction(action) {
    if (!action || !action.view) return;
    if (action.view === "network") {
      if (action.centerNodeId) { state.centerNodeId = action.centerNodeId; state.pathHighlight = null; }
      state.selectedNodeId = action.selectNodeId || null;
      if (action.hop) {
        state.hop = action.hop;
        $$("#hopSeg button").forEach(function (b) { b.setAttribute("aria-pressed", Number(b.dataset.hop) === action.hop ? "true" : "false"); });
      }
      switchView("network");
      if (action.selectNodeId) openEntity(action.selectNodeId);
    } else if (action.view === "geo") {
      switchView("geo");
      if (action.stateCode) { state.selectedState = action.stateCode; renderGeo(); }
      if (action.themeCategoryId) {
        var cat = D.explorerCategories.filter(function (c) { return c.id === action.themeCategoryId; })[0];
        if (cat && cat.themeId) {
          state.netFilters.theme = cat.themeId;
          state.dirFilters.themes = new Set([cat.themeId]);
          renderThemeGrid();
        }
      }
    } else {
      switchView(action.view);
    }
  }

  function askAI(query) {
    if (!query || !query.trim()) return;
    var match = matchQuestion(query);
    var thread = $("#aiThread");
    var qDiv = document.createElement("div");
    qDiv.className = "ai-q";
    qDiv.textContent = query;
    thread.appendChild(qDiv);
    var card = document.createElement("div");
    card.className = "ai-card";
    if (match) {
      card.innerHTML =
        '<div class="ai-answer">' + esc(match.answer) + "</div>" +
        '<div class="ai-row"><h5>Relevant entities</h5><div class="chips">' + (match.relevantEntityIds || []).map(linkChip).join("") + "</div></div>" +
        '<div class="ai-row"><h5>Evidence</h5><ul class="list-compact">' + (match.evidence || []).map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul></div>" +
        '<div class="ai-row"><h5>Suggested visualisation</h5>' +
        (match.vizAction
          ? '<button class="btn-mini viz-action">' + esc(match.suggestedVisualisation || "Open visualisation") + "</button>"
          : '<p style="font-size:12.5px;">' + esc(match.suggestedVisualisation || "") + "</p>") + "</div>" +
        '<div class="ai-row">' + confidenceBadgeHTML(match.confidence) + "</div>" +
        '<div class="ai-row chips">' + (match.followUps || []).map(function (f) { return '<button class="btn-mini follow-up" data-q="' + esc(f) + '">' + esc(f) + "</button>"; }).join("") + "</div>";
    } else {
      card.innerHTML = '<div class="ai-answer">No pre-scripted answer matches this question in the pilot dataset. Try one of the suggested questions above, or search the Directory directly.</div>';
    }
    thread.appendChild(card);
    $$(".follow-up", card).forEach(function (b) { b.addEventListener("click", function () { $("#aiInput").value = b.dataset.q; askAI(b.dataset.q); }); });
    var vizBtn = card.querySelector(".viz-action");
    if (vizBtn && match) vizBtn.addEventListener("click", function () { applyVizAction(match.vizAction); });
    $("#aiInput").value = "";
    thread.scrollTop = thread.scrollHeight;
  }
  function renderAI() {
    $("#aiSuggest").innerHTML = D.questions.map(function (q) { return '<button data-q="' + esc(q.query) + '">' + esc(q.query) + "</button>"; }).join("");
    $$("#aiSuggest button").forEach(function (b) { b.addEventListener("click", function () { $("#aiInput").value = b.dataset.q; askAI(b.dataset.q); }); });
  }

  // -------------------------------------------------------------- geography
  function renderGeo() {
    $$("#auMap .au-state").forEach(function (g) {
      var code = g.dataset.code;
      var region = D.regions.filter(function (r) { return r.code === code; })[0] || {};
      g.classList.toggle("hotspot", !!region.decarbHotspot);
      g.setAttribute("aria-pressed", String(state.selectedState === code));
    });
    renderRegionDetail();
    renderThemeGrid();
  }
  function selectState(code) {
    state.selectedState = state.selectedState === code ? null : code;
    renderGeo();
  }
  function primaryActorForState(code) {
    var linkedActors = D.actors.filter(function (a) { return a.state === code; });
    if (!linkedActors.length) return null;
    var adj = buildAdjacency(null);
    var best = linkedActors[0];
    linkedActors.forEach(function (a) {
      if ((adj.get(a.id) || []).length > (adj.get(best.id) || []).length) best = a;
    });
    return best.id;
  }
  function renderRegionDetail() {
    var el = $("#regionDetail");
    if (!state.selectedState) { el.innerHTML = "Select a state to see capability density, decarbonisation hotspot status, and collaboration links."; return; }
    var region = D.regions.filter(function (r) { return r.code === state.selectedState; })[0];
    if (!region) { el.innerHTML = "No data for this state in the pilot subset."; return; }
    var linkedActors = D.actors.filter(function (a) { return a.state === state.selectedState; });
    el.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">' + esc(region.name) + "</div>" +
      "<div>CRCs: " + (region.crcCount || 0) + " · NCRIS facilities: " + (region.ncrisCount || 0) + " · Organisations: " + (region.orgCount || 0) + "</div>" +
      "<div>Capability density: " + esc(cap(region.capabilityDensity || "—")) + (region.decarbHotspot ? " · <strong>Decarbonisation hotspot</strong>" : "") + "</div>" +
      "<div>Collaboration links: " + (region.collaborationLinks || 0) + "</div>" +
      (linkedActors.length ? '<div class="rc-tags" style="margin-top:8px;">' + linkedActors.map(function (a) { return linkChip(a.id); }).join("") + "</div>" :
        '<div class="drawer-note">No pilot actors located in this state.</div>') +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">' +
      '<button class="btn-mini" id="viewInDirectoryBtn">View in Directory</button>' +
      (linkedActors.length ? '<button class="btn-mini" id="centreNetworkBtn">Centre network here</button>' : "") +
      "</div>";
    var btn = $("#viewInDirectoryBtn");
    if (btn) btn.addEventListener("click", function () { state.dirFilters.states = new Set([state.selectedState]); switchView("directory"); });
    var cBtn = $("#centreNetworkBtn");
    if (cBtn) cBtn.addEventListener("click", function () {
      var anchor = primaryActorForState(state.selectedState);
      if (anchor) { state.centerNodeId = anchor; state.selectedNodeId = null; state.pathHighlight = null; switchView("network"); }
    });
  }
  function renderThemeGrid() {
    $("#themeGrid").innerHTML = D.explorerCategories.map(function (c) {
      var active = c.themeId && state.netFilters.theme === c.themeId;
      return '<button class="theme-card' + (c.inPilot ? "" : " out-of-scope") + '" data-id="' + esc(c.id) + '" data-theme-id="' + esc(c.themeId || "") +
        '" aria-pressed="' + (!!active) + '"' + (c.inPilot ? "" : " disabled") + '><div class="tc-name">' + esc(c.label) + '</div>' +
        '<div class="tc-note">' + esc(c.note || (c.inPilot ? "In pilot scope" : "Out of pilot scope")) + "</div></button>";
    }).join("");
    $$("#themeGrid .theme-card").forEach(function (btn) {
      if (btn.disabled) return;
      btn.addEventListener("click", function () {
        var themeId = btn.dataset.themeId;
        if (!themeId) return;
        if (state.netFilters.theme === themeId) { state.netFilters.theme = null; state.dirFilters.themes.delete(themeId); }
        else { state.netFilters.theme = themeId; state.dirFilters.themes = new Set([themeId]); }
        renderThemeGrid();
      });
    });
  }

  // -------------------------------------------------------------- insights
  function insightCard(title, bodyHTML) { return '<div class="insight-card"><h3>' + esc(title) + "</h3>" + bodyHTML + "</div>"; }
  function insightClustersHTML(clusters) {
    var strengthPct = { strong: 100, medium: 65, weak: 35 };
    return clusters.map(function (c) {
      return '<div class="bar-row"><div class="b-label">' + esc(c.name) + '</div><div class="bar-track"><div class="bar-fill" style="width:' +
        (strengthPct[c.strength] || 50) + '%"></div></div></div>' +
        '<div class="rc-tags" style="margin:2px 0 10px;">' + c.actorIds.map(linkChip).join("") + "</div>";
    }).join("");
  }
  function insightUnderConnectedHTML(list) {
    return '<ul class="gap-list">' + list.map(function (r) { return "<li><strong>" + esc(r.code) + "</strong> — " + esc(r.note) + "</li>"; }).join("") + "</ul>";
  }
  function insightFastGrowingHTML(list) {
    var arrow = { up: "▲ Growing", steady: "▬ Steady", down: "▼ Declining" };
    return '<div class="rc-tags">' + list.map(function (t) {
      return '<span class="trend-pill">' + esc(themeLabel(t.themeId)) + " " + esc(arrow[t.trend] || t.trend) + "</span>";
    }).join("") + "</div>";
  }
  function insightBridgingHTML(list) {
    return list.map(function (b) {
      return '<div class="bar-row"><button class="btn-mini entity-chip" data-id="' + esc(b.actorId) + '" style="width:150px;flex:none;text-align:left;">' +
        esc(nodeName(b.actorId)) + '</button><div class="bar-track"><div class="bar-fill" style="width:' + Math.round(b.score * 100) +
        '%;background:var(--group-industry);"></div></div></div><div class="rc-evidence" style="margin-bottom:10px;">' + esc(b.note) + "</div>";
    }).join("");
  }
  function insightMatrixHTML(s) {
    var max = Math.max.apply(null, [1].concat(s.matrix.reduce(function (a, row) { return a.concat(row); }, [])));
    var html = '<div class="heat-grid" style="grid-template-columns:120px repeat(' + s.facilities.length + ',1fr);">';
    html += "<div></div>" + s.facilities.map(function (f) { return '<div style="font-size:10px;color:var(--ink-muted);text-align:center;">' + esc(nodeName(f)) + "</div>"; }).join("");
    s.crcs.forEach(function (crcId, i) {
      html += '<div style="font-size:11px;color:var(--ink-secondary);display:flex;align-items:center;">' + esc(nodeName(crcId)) + "</div>";
      s.matrix[i].forEach(function (v) {
        var alpha = v ? 0.15 + 0.75 * (v / max) : 0.06;
        html += '<div class="heat-cell" style="background:rgba(42,120,214,' + alpha + ');">' + v + "</div>";
      });
    });
    html += "</div>";
    return html;
  }
  function insightGapsHTML(gaps, opps) {
    return '<div class="section-label" style="margin:0 0 8px;">Gaps</div><ul class="gap-list">' +
      gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul>" +
      '<div class="section-label" style="margin:16px 0 8px;">Opportunities</div><ul class="opp-list">' +
      opps.map(function (o) { return "<li>" + esc(o.text) + " " + confidenceBadgeHTML(o.confidence) + "</li>"; }).join("") + "</ul>";
  }
  function renderInsights() {
    var ins = D.insights;
    $("#insightGrid").innerHTML = [
      insightCard("Top collaboration clusters", insightClustersHTML(ins.topCollaborationClusters)),
      insightCard("Under-connected regions", insightUnderConnectedHTML(ins.underConnectedRegions)),
      insightCard("Fast-growing themes", insightFastGrowingHTML(ins.fastGrowingThemes)),
      insightCard("Bridging organisations", insightBridgingHTML(ins.bridgingOrgs)),
      insightCard("CRC × NCRIS facility strength", insightMatrixHTML(ins.crcNcrisStrength)),
      insightCard("Decarbonisation gaps &amp; opportunities", insightGapsHTML(ins.decarbonisationGaps, ins.opportunities)),
    ].join("");
  }

  // -------------------------------------------------------------- data trust
  function renderTrust() {
    var counts = {};
    Object.keys(D.CONFIDENCE_META).forEach(function (k) { counts[k] = 0; });
    D.allNodes.forEach(function (n) { if (counts[n.dataConfidence] != null) counts[n.dataConfidence]++; });
    D.relationships.forEach(function (r) { if (counts[r.confidence] != null) counts[r.confidence]++; });
    $("#confidenceLegend").innerHTML = Object.keys(D.CONFIDENCE_META).map(function (k) {
      var meta = D.CONFIDENCE_META[k];
      return '<div class="confidence ' + k + '"><span class="dot"></span>' + esc(meta.label) + ' <span style="color:var(--ink-muted);">(' + counts[k] + ")</span></div>";
    }).join("");
    $("#sourceGrid").innerHTML = D.sources.map(function (s) { return '<div class="source-card"><h4>' + esc(s.name) + "</h4><p>" + esc(s.notes) + "</p></div>"; }).join("");
  }

  // -------------------------------------------------------------- walkthrough
  var WT_ACTIONS = [
    // Step 1 — Search "decarbonisation" in the Intelligent Directory.
    function () {
      switchView("directory");
      state.search = "decarbonisation";
      $("#searchInput").value = state.search;
      $("#searchMenu").hidden = true;
      renderDirectory();
    },
    // Step 2 — Open a Directory result to see its full entity profile.
    function () {
      openEntity("fbi-crc");
    },
    // Step 3 — Switch to the Ecosystem Network, centred on "Decarbonisation".
    function () {
      switchView("network");
      state.centerNodeId = "decarbonisation";
      state.hop = 2;
      $$("#hopSeg button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.hop === "2" ? "true" : "false"); });
      renderNetFilterPanel();
      renderGraph();
      renderNetActions();
    },
    // Step 4 — Explain the connection between Future Battery Industries CRC and ANFF.
    function () {
      runExplainConnection("fbi-crc", "anff");
    },
    // Step 5 — Open the Geography map.
    function () {
      switchView("geo");
      state.selectedState = "WA";
      renderGeo();
    },
    // Step 6 — Ask the AI Discovery assistant about battery recycling clusters.
    function () {
      switchView("ai");
      var q = "Where are battery recycling capabilities clustered?";
      $("#aiInput").value = q;
      askAI(q);
    },
    // Step 7 — Add three actors to the shortlist.
    function () {
      ["fbi-crc", "anff", "pilbara-cluster"].forEach(function (id) { state.shortlist.add(id); });
      updateShortlistBadge();
    },
    // Step 8 — Generate a briefing preview from the shortlist.
    function () {
      renderShortlistDrawer();
      openShortlistDrawer();
      var genBtn = document.getElementById("generateBriefingBtn");
      if (genBtn) genBtn.click();
    },
  ];
  var wtHighlightEl = null;
  function clearWtHighlight() {
    if (wtHighlightEl) { wtHighlightEl.classList.remove("wt-highlight"); wtHighlightEl = null; }
  }
  function runWalkthroughStep() {
    var idx = state.walkthrough.index;
    var step = D.walkthrough.steps[idx];
    $("#wtStep").textContent = "Step " + (idx + 1) + " of " + D.walkthrough.steps.length;
    $("#wtCaption").textContent = step.caption;
    $("#wtBack").disabled = idx === 0;
    $("#wtNext").textContent = idx === D.walkthrough.steps.length - 1 ? "Finish" : "Next";
    WT_ACTIONS[idx]();
    clearWtHighlight();
    var target = step.target && document.querySelector(step.target);
    if (target) { target.classList.add("wt-highlight"); wtHighlightEl = target; }
  }
  function startWalkthrough() {
    state.walkthrough.active = true;
    state.walkthrough.index = 0;
    $("#walkthroughBar").hidden = false;
    runWalkthroughStep();
  }
  function endWalkthrough() {
    state.walkthrough.active = false;
    $("#walkthroughBar").hidden = true;
    clearWtHighlight();
  }

  // ------------------------------------------------------------------- boot
  function openShortlistDrawer() {
    var d = $("#shortlistDrawer");
    d.hidden = false;
    d.removeAttribute("inert");
    d.classList.add("open");
  }
  function closeShortlistDrawer() {
    var d = $("#shortlistDrawer");
    d.classList.remove("open");
    d.setAttribute("inert", "");
    setTimeout(function () { if (!d.classList.contains("open")) d.hidden = true; }, 220);
  }
  function wireGlobalUI() {
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#shortlistBtn").addEventListener("click", function () { renderShortlistDrawer(); openShortlistDrawer(); });
    $("#shortlistClose").addEventListener("click", closeShortlistDrawer);

    $("#auMap").addEventListener("click", function (e) {
      var g = e.target.closest(".au-state");
      if (g) selectState(g.dataset.code);
    });
    $("#auMap").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var g = e.target.closest(".au-state");
      if (!g) return;
      e.preventDefault();
      selectState(g.dataset.code);
    });

    $("#tabbar").addEventListener("click", function (e) {
      var btn = e.target.closest(".tab-btn");
      if (btn) switchView(btn.dataset.view);
    });

    $("#hopSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-hop]");
      if (!btn) return;
      state.hop = Number(btn.dataset.hop);
      $$("#hopSeg button").forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
      renderGraph();
    });
    $("#explainBtn").addEventListener("click", function () {
      state.explainMode = true;
      if (state.selectedNodeId) {
        state.explainFirst = state.selectedNodeId;
        setNetHint('Click a node to explain its connection to "' + nodeName(state.selectedNodeId) + '".');
      } else {
        state.explainFirst = null;
        setNetHint("Click the first node for the connection.");
      }
      updateExplainBanner();
    });
    $("#strongestPathBtn").addEventListener("click", function () {
      var startId = state.selectedNodeId || state.centerNodeId;
      var result = strongestCollaborationPath(startId, state.hop);
      renderStrongestPathDrawer(startId, result);
    });
    $("#netResetBtn").addEventListener("click", function () {
      state.selectedNodeId = null; state.pathHighlight = null; state.explainMode = false; state.explainFirst = null;
      state.transform = { x: 0, y: 0, k: 1 };
      applyTransform();
      resetNetHint();
      updateExplainBanner();
      renderGraph();
      renderNetActions();
    });
    setupCanvasInteractions();

    $("#aiAskBtn").addEventListener("click", function () { askAI($("#aiInput").value); });
    $("#aiInput").addEventListener("keydown", function (e) { if (e.key === "Enter") askAI($("#aiInput").value); });

    document.addEventListener("click", function (e) {
      var link = e.target.closest(".entity-link, .entity-chip");
      if (link) { e.preventDefault(); openEntity(link.dataset.id); }
    });

    $("#searchInput").addEventListener("input", function (e) {
      var q = e.target.value.trim();
      state.search = q;
      if (state.view === "directory") renderDirectory();
      if (!q) { $("#searchMenu").hidden = true; $("#searchMenu").innerHTML = ""; return; }
      var matches = D.allNodes.filter(function (n) { return nodeMatchesSearch(n, q.toLowerCase()); }).slice(0, 8);
      $("#searchMenu").innerHTML = matches.length
        ? matches.map(function (n) {
            return '<button data-id="' + esc(n.id) + '"><span class="r-name">' + esc(n.name) + '</span><span class="r-meta">' +
              esc((D.TYPE_META[n.type] || {}).label || n.type) + "</span></button>";
          }).join("")
        : '<div class="r-empty">No matches.</div>';
      $("#searchMenu").hidden = false;
      $$("#searchMenu button").forEach(function (b) {
        b.addEventListener("click", function () { openEntity(b.dataset.id); $("#searchMenu").hidden = true; $("#searchInput").value = ""; state.search = ""; });
      });
    });
    $("#searchInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { state.search = e.target.value; switchView("directory"); $("#searchMenu").hidden = true; }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".searchbar")) { var m = $("#searchMenu"); if (m) m.hidden = true; }
    });

    $("#railToggle").addEventListener("click", function () {
      var panel = document.querySelector(".view:not([hidden]) .filter-panel");
      if (panel) panel.style.display = panel.style.display === "none" ? "flex" : "none";
    });
    $("#themeToggle").addEventListener("click", function () {
      var root = document.documentElement;
      var current = root.getAttribute("data-theme");
      var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var isDark = current === "dark" || (current !== "light" && systemDark);
      root.setAttribute("data-theme", isDark ? "light" : "dark");
    });

    $("#walkthroughBtn").addEventListener("click", startWalkthrough);
    $("#wtExit").addEventListener("click", endWalkthrough);
    $("#wtNext").addEventListener("click", function () {
      if (state.walkthrough.index >= D.walkthrough.steps.length - 1) { endWalkthrough(); return; }
      state.walkthrough.index++;
      runWalkthroughStep();
    });
    $("#wtBack").addEventListener("click", function () {
      if (state.walkthrough.index <= 0) return;
      state.walkthrough.index--;
      runWalkthroughStep();
    });
  }

  function init() {
    wireGlobalUI();
    updateShortlistBadge();
    applyTransform();
    switchView("overview");
  }
  init();
})();
