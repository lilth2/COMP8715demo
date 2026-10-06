(function () {
  "use strict";
  // Graphical editor for the Ecosystem Network. It holds NO copy of the graph: nodes and links
  // are the Store's actors / projects / themes / relationships, and every create, edit, publish,
  // withdraw and delete goes through the same console forms and Store operations as the tables.
  // Only the canvas positions are editor-specific (Store.layout / Store.setLayout); they are
  // abstract canvas coordinates and are unrelated to office/map locations.
  var D = window.RD_DATA;
  var Store = window.RD_ADMIN_STORE;
  if (!D || !Store) return;

  var NS = "http://www.w3.org/2000/svg";
  var GROUP_COLOR = { research_performer: "#2a78d6", infrastructure: "#1baf7a", industry_gov: "#eb6834", concept: "#5b6472" };
  var COLLECTION_KIND = { actors: "org", projects: "project", themes: "theme" };
  var COLLECTION_WORD = { actors: "Organisation", projects: "Project", themes: "Research theme" };
  var ui = null;
  var s = {
    selected: null,        // { type: "node"|"edge", id }
    linkMode: false, linkSource: null,
    view: { x: 0, y: 0, k: 1 },
    drag: null, pan: null, dragPos: {},
    fitted: false, placing: false,
  };

  function $(sel) { return document.querySelector(sel); }
  function svgEl(tag, attrs, text) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
  }
  function esc(v) { return ui ? ui.esc(v) : String(v); }

  function model() {
    var snap = Store.snapshot();
    var nodes = [];
    [["actors", snap.actors], ["projects", snap.projects], ["themes", snap.themes]].forEach(function (pair) {
      pair[1].forEach(function (record) { nodes.push({ id: record.id, name: record.name, collection: pair[0], record: record }); });
    });
    return { nodes: nodes, edges: snap.relationships, byId: nodes.reduce(function (m, n) { m[n.id] = n; return m; }, {}) };
  }
  function groupOf(node) { return (D.TYPE_META[node.record.type] || {}).group; }
  function positions() { return Object.assign(Store.layout(), s.dragPos); }

  // ------------------------------------------------------------------ layout
  function collides(p, taken) { return Object.keys(taken).some(function (id) { var q = taken[id]; return Math.hypot(p.x - q.x, p.y - q.y) < 56; }); }
  // Deterministic initial placement, used only for nodes that have no saved position.
  function autoPlace(nodes, saved) {
    var out = {}, taken = Object.assign({}, saved);
    var rings = { themes: 130, projects: 250, actors: 380 }, twist = { themes: 0, projects: 0.45, actors: 0.12 };
    ["themes", "projects", "actors"].forEach(function (coll) {
      var missing = nodes.filter(function (n) { return n.collection === coll && !saved[n.id]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      missing.forEach(function (n, i) {
        var angle = 2 * Math.PI * i / missing.length + twist[coll] - Math.PI / 2, r = rings[coll];
        var p = { x: 600 + r * Math.cos(angle), y: 400 + r * Math.sin(angle) };
        for (var guard = 0; collides(p, taken) && guard < 40; guard++) { r += 30; p = { x: 600 + r * Math.cos(angle), y: 400 + r * Math.sin(angle) }; }
        p = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
        out[n.id] = p; taken[n.id] = p;
      });
    });
    return out;
  }
  async function ensureLayout() {
    if (s.placing) return;
    var m = model();
    var placed = autoPlace(m.nodes, Store.layout());
    if (!Object.keys(placed).length) return;
    s.placing = true;
    try { await Store.setLayout(placed); } catch (e) { /* positions are cosmetic; retry on next activation */ } finally { s.placing = false; }
  }
  function svgSize() { var r = $("#neSvg").getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600 }; }
  function fit() {
    var pos = positions(), ids = Object.keys(pos);
    if (!ids.length) { s.view = { x: 0, y: 0, k: 1 }; return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) { var p = pos[id]; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    var size = svgSize(), pad = 70;
    var k = Math.min((size.w - 2 * pad) / Math.max(maxX - minX, 1), (size.h - 2 * pad) / Math.max(maxY - minY, 1), 1.6);
    k = Math.max(0.2, Math.min(k, 1.6));
    s.view = { k: k, x: (size.w - (maxX - minX) * k) / 2 - minX * k, y: (size.h - (maxY - minY) * k) / 2 - minY * k };
    applyView();
  }
  function applyView() { var g = $("#neViewport"); if (g) g.setAttribute("transform", "translate(" + s.view.x + "," + s.view.y + ") scale(" + s.view.k + ")"); }
  function toWorld(clientX, clientY) {
    var r = $("#neSvg").getBoundingClientRect();
    return { x: (clientX - r.left - s.view.x) / s.view.k, y: (clientY - r.top - s.view.y) / s.view.k };
  }
  function viewCentre() {
    var size = svgSize(), r = $("#neSvg").getBoundingClientRect();
    var p = toWorld(r.left + size.w / 2, r.top + size.h / 2);
    var jitter = (Object.keys(Store.layout()).length % 5) * 18;
    return { x: Math.round(p.x + jitter), y: Math.round(p.y + jitter) };
  }

  // ------------------------------------------------------------------ filtering
  function filters() {
    return { q: ($("#neSearch").value || "").trim().toLowerCase(), status: $("#neStatus").value, group: $("#neGroup").value, rel: $("#neRelType").value };
  }
  function nodeVisible(node, f) {
    if (f.q && node.name.toLowerCase().indexOf(f.q) === -1) return false;
    if (f.group && node.collection !== f.group) return false;
    if (f.status === "draft" && node.record.status !== "draft") return false;
    if (f.status === "published" && node.record.status !== "published") return false;
    if (f.status === "pending" && !Store.hasPendingChanges(node.record)) return false;
    return true;
  }
  function anyFilter(f) { return Boolean(f.q || f.status || f.group || f.rel); }

  // ------------------------------------------------------------------ render
  function render() {
    if (!ui || !$("#neSvg")) return;
    var m = model(), pos = positions(), f = filters();
    if (s.selected) {
      var exists = s.selected.type === "node" ? Boolean(m.byId[s.selected.id]) : m.edges.some(function (e) { return e.id === s.selected.id; });
      if (!exists) s.selected = null;
    }
    if (s.linkSource && !m.byId[s.linkSource]) s.linkSource = null;
    var svg = $("#neSvg");
    svg.innerHTML = "";
    var vp = svgEl("g", { id: "neViewport" });
    var edgeLayer = svgEl("g", {}), nodeLayer = svgEl("g", {});
    vp.appendChild(edgeLayer); vp.appendChild(nodeLayer); svg.appendChild(vp);

    var active = anyFilter(f);
    var visible = {};
    m.nodes.forEach(function (n) { visible[n.id] = nodeVisible(n, f); });

    m.edges.forEach(function (e) {
      var a = pos[e.sourceId], b = pos[e.targetId];
      if (!a || !b) return;
      var relOk = !f.rel || e.type === f.rel;
      var dim = active && (!relOk || !visible[e.sourceId] || !visible[e.targetId]);
      var cls = "ne-edge" + (e.status === "draft" ? " draft" : "") + (s.selected && s.selected.type === "edge" && s.selected.id === e.id ? " sel" : "") + (dim ? " dim" : "");
      var g = svgEl("g", { "data-edge": e.id });
      g.appendChild(svgEl("line", { class: cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      var hit = svgEl("line", { class: "ne-edge-hit" + (dim ? " dim" : ""), x1: a.x, y1: a.y, x2: b.x, y2: b.y, "data-edge-hit": e.id });
      hit.appendChild(svgEl("title", {}, ((D.RELATIONSHIP_META[e.type] || {}).label || e.type) + ": " + m.byId[e.sourceId].name + " → " + m.byId[e.targetId].name + " (" + e.status + ")"));
      g.appendChild(hit);
      if (s.selected && s.selected.type === "edge" && s.selected.id === e.id) {
        g.appendChild(svgEl("text", { class: "ne-edge-label", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5, "text-anchor": "middle" }, (D.RELATIONSHIP_META[e.type] || {}).label || e.type));
      }
      edgeLayer.appendChild(g);
    });

    m.nodes.forEach(function (n) {
      var p = pos[n.id];
      if (!p) return;
      var color = GROUP_COLOR[groupOf(n)] || "#5b6472";
      var draft = n.record.status === "draft", pending = Store.hasPendingChanges(n.record);
      var selected = s.selected && s.selected.type === "node" && s.selected.id === n.id;
      var cls = "ne-node" + (selected ? " selected" : "") + (active && !visible[n.id] ? " dim" : "");
      var g = svgEl("g", { class: cls, transform: "translate(" + p.x + "," + p.y + ")", "data-node": n.id, tabindex: "0", role: "button",
        "aria-label": n.name + ", " + COLLECTION_WORD[n.collection] + ", " + n.record.status + (pending ? ", unpublished changes" : "") });
      if (pending) {
        if (n.collection === "actors") g.appendChild(svgEl("circle", { class: "ne-halo", r: 24 }));
        else g.appendChild(svgEl("rect", { class: "ne-halo", x: -22, y: -22, width: 44, height: 44, rx: 8 }));
      }
      var shapeAttrs = { class: "ne-shape", fill: draft ? "#ffffff" : color, stroke: color, "stroke-width": 2.5, "stroke-dasharray": draft ? "5 3" : null };
      if (n.collection === "actors") g.appendChild(svgEl("circle", Object.assign({ r: 17 }, shapeAttrs)));
      else if (n.collection === "projects") g.appendChild(svgEl("rect", Object.assign({ x: -16, y: -16, width: 32, height: 32, rx: 6 }, shapeAttrs)));
      else g.appendChild(svgEl("rect", Object.assign({ x: -13, y: -13, width: 26, height: 26, rx: 3, transform: "rotate(45)" }, shapeAttrs)));
      if (draft) {
        g.appendChild(svgEl("circle", { cx: 15, cy: -15, r: 8, fill: "#d69a24" }));
        g.appendChild(svgEl("text", { x: 15, y: -11.5, "text-anchor": "middle", style: "fill:#fff;font-weight:700;font-size:10px" }, "D"));
      }
      if (s.linkSource === n.id) g.appendChild(svgEl("circle", { r: 27, fill: "none", stroke: "#168a80", "stroke-width": 3, "stroke-dasharray": "3 3" }));
      var label = n.name.length > 24 ? n.name.slice(0, 23) + "…" : n.name;
      g.appendChild(svgEl("text", { y: 32, "text-anchor": "middle" }, label));
      g.appendChild(svgEl("title", {}, n.name + " — " + COLLECTION_WORD[n.collection] + " · " + n.record.status));
      nodeLayer.appendChild(g);
    });
    applyView();
    renderPanel(m);
    renderHint();
  }

  function renderHint() {
    var hint = $("#neHint");
    if (s.linkMode) hint.textContent = s.linkSource ? "Link mode: now click the second node." : "Link mode: click the first node, then the second.";
    else hint.textContent = "Drag nodes to arrange (saved automatically) · drag empty space to pan · scroll to zoom · click a node or line to edit.";
    $("#neLinkMode").setAttribute("aria-pressed", String(s.linkMode));
    $("#neLinkMode").textContent = s.linkMode ? "Cancel linking" : "Link nodes";
  }

  function actionBtn(act, label, cls) { return '<button class="btn small' + (cls ? " " + cls : "") + '" data-ne-action="' + act + '" type="button">' + esc(label) + "</button>"; }
  function lifecycleButtons(record) {
    var html = actionBtn("edit", "Edit") + actionBtn("preview", "Preview");
    if (record.status === "draft") html += actionBtn("publish", "Publish", "teal");
    else { if (Store.hasPendingChanges(record)) html += actionBtn("publish", "Publish changes", "teal"); html += actionBtn("withdraw", "Withdraw"); }
    return html + actionBtn("delete", "Delete", "danger");
  }
  function renderPanel(m) {
    var panel = $("#nePanel");
    var sel = s.selected;
    if (!sel) {
      var drafts = m.nodes.filter(function (n) { return n.record.status === "draft"; }).length + m.edges.filter(function (e) { return e.status === "draft"; }).length;
      panel.innerHTML = "<h3>Network overview</h3><div class=\"sub\">" + m.nodes.length + " nodes · " + m.edges.length + " links · " + drafts + " draft item(s)</div>" +
        "<p class=\"help\">Select a node or a line to edit it. Use <strong>+ Organisation / Project / Theme</strong> to add a draft node, and <strong>Link nodes</strong> to connect two nodes. Everything you change here appears in the tables too.</p>" +
        "<p class=\"help\">Drafts are drawn with dashed outlines and a D badge and are never shown on the public site until you publish them.</p>";
      return;
    }
    if (sel.type === "node") {
      var n = m.byId[sel.id], r = n.record;
      var rels = m.edges.filter(function (e) { return e.sourceId === n.id || e.targetId === n.id; });
      var typeLabel = (D.TYPE_META[r.type] || {}).label || r.type;
      panel.innerHTML = "<h3>" + esc(r.name) + '</h3><div class="sub">' + esc(COLLECTION_WORD[n.collection]) + " · " + esc(typeLabel) + "</div>" +
        "<div>" + ui.statusPill(r) + "</div>" +
        "<dl>" + (r.state ? "<dt>State</dt><dd>" + esc(r.state) + "</dd>" : "") +
        (n.collection === "projects" ? "<dt>Host</dt><dd>" + esc(r.hostId ? ui.nodeName(r.hostId) : "None") + "</dd>" : "") +
        (n.collection !== "themes" && (r.themes || []).length ? "<dt>Theme tags</dt><dd>" + esc((r.themes || []).map(ui.tagName).join(", ")) + "</dd>" : "") +
        "<dt>Confidence</dt><dd>" + ui.confidencePill(r.dataConfidence) + "</dd><dt>Summary</dt><dd>" + esc(r.summary || "—") + "</dd></dl>" +
        '<div class="btn-row">' + lifecycleButtons(r) + actionBtn("link", "Link from here") + "</div>" +
        "<dt style=\"font-size:10.5px;text-transform:uppercase;color:var(--muted)\">Links (" + rels.length + ")</dt>" +
        (rels.length ? "<ul>" + rels.map(function (e) {
          var other = e.sourceId === n.id ? e.targetId : e.sourceId;
          return '<li><button class="ne-link" data-ne-edge="' + esc(e.id) + '" type="button">' + esc((D.RELATIONSHIP_META[e.type] || {}).label || e.type) + " → " + esc(ui.nodeName(other)) + "</button> <em>(" + esc(e.status) + ")</em></li>";
        }).join("") + "</ul>" : '<p class="help">No links yet.</p>');
      return;
    }
    var e = m.edges.filter(function (x) { return x.id === sel.id; })[0];
    panel.innerHTML = "<h3>" + esc((D.RELATIONSHIP_META[e.type] || {}).label || e.type) + '</h3><div class="sub">Relationship</div><div>' + ui.statusPill(e) + "</div>" +
      "<dl><dt>From</dt><dd><button class=\"ne-link\" data-ne-node=\"" + esc(e.sourceId) + "\" type=\"button\">" + esc(ui.nodeName(e.sourceId)) + "</button></dd>" +
      "<dt>To</dt><dd><button class=\"ne-link\" data-ne-node=\"" + esc(e.targetId) + "\" type=\"button\">" + esc(ui.nodeName(e.targetId)) + "</button></dd>" +
      "<dt>Strength</dt><dd>" + esc(e.intensity) + "</dd><dt>Confidence</dt><dd>" + ui.confidencePill(e.confidence) + "</dd><dt>Evidence</dt><dd>" + esc(e.evidence || "—") + "</dd></dl>" +
      '<div class="btn-row">' + lifecycleButtons(e) + "</div>";
  }

  // ------------------------------------------------------------------ interaction
  function select(sel) { s.selected = sel; render(); }
  function presetFor(aId, bId) {
    var m = model(), a = m.byId[aId], b = m.byId[bId];
    if (!a || !b) return { sourceId: aId, targetId: bId, type: "collaborates_with" };
    if (a.collection === "themes" || b.collection === "themes") return { sourceId: aId, targetId: bId, type: "shares_research_theme" };
    if (a.collection === "projects" && b.collection === "actors") return { sourceId: aId, targetId: bId, type: "hosted_by" };
    if (a.collection === "actors" && b.collection === "projects") return { sourceId: bId, targetId: aId, type: "hosted_by" };
    return { sourceId: aId, targetId: bId, type: "collaborates_with" };
  }
  function handleLinkClick(id) {
    if (!s.linkSource) { s.linkSource = id; render(); return; }
    if (s.linkSource === id) { s.linkSource = null; render(); return; }
    var preset = presetFor(s.linkSource, id);
    s.linkSource = null; s.linkMode = false; render();
    ui.openRelationship(null, preset);
  }
  async function commitPosition(id) {
    var p = s.dragPos[id];
    delete s.dragPos[id];
    if (!p) return;
    var o = {}; o[id] = p;
    try { await Store.setLayout(o); } catch (error) { ui.showError(error); render(); }
  }
  function onPointerDown(ev) {
    var svg = $("#neSvg");
    var nodeEl = ev.target.closest("[data-node]"), hit = ev.target.closest("[data-edge-hit]");
    if (nodeEl) {
      var id = nodeEl.getAttribute("data-node");
      var start = positions()[id];
      s.drag = { id: id, sx: ev.clientX, sy: ev.clientY, ox: start.x, oy: start.y, moved: false };
      svg.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else if (hit) {
      select({ type: "edge", id: hit.getAttribute("data-edge-hit") });
    } else {
      s.pan = { sx: ev.clientX, sy: ev.clientY, vx: s.view.x, vy: s.view.y, moved: false };
      svg.setPointerCapture(ev.pointerId);
      svg.classList.add("panning");
    }
  }
  function onPointerMove(ev) {
    if (s.drag) {
      var dx = ev.clientX - s.drag.sx, dy = ev.clientY - s.drag.sy;
      if (!s.drag.moved && Math.hypot(dx, dy) < 4) return;
      s.drag.moved = true;
      s.dragPos[s.drag.id] = { x: s.drag.ox + dx / s.view.k, y: s.drag.oy + dy / s.view.k };
      render();
    } else if (s.pan) {
      var px = ev.clientX - s.pan.sx, py = ev.clientY - s.pan.sy;
      if (Math.hypot(px, py) > 3) s.pan.moved = true;
      s.view.x = s.pan.vx + px; s.view.y = s.pan.vy + py;
      applyView();
    }
  }
  async function onPointerUp(ev) {
    var svg = $("#neSvg");
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) { /* not captured */ }
    svg.classList.remove("panning");
    if (s.drag) {
      var d = s.drag; s.drag = null;
      if (d.moved) await commitPosition(d.id);
      else if (s.linkMode) handleLinkClick(d.id);
      else select({ type: "node", id: d.id });
    } else if (s.pan) {
      var moved = s.pan.moved; s.pan = null;
      if (!moved) { s.linkSource = null; select(null); }
    }
  }
  function onWheel(ev) {
    ev.preventDefault();
    var r = $("#neSvg").getBoundingClientRect();
    var px = ev.clientX - r.left, py = ev.clientY - r.top;
    var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    var k = Math.max(0.2, Math.min(3, s.view.k * factor));
    s.view.x = px - (px - s.view.x) * (k / s.view.k);
    s.view.y = py - (py - s.view.y) * (k / s.view.k);
    s.view.k = k;
    applyView();
  }

  function mount(api) {
    ui = api;
    var relSel = $("#neRelType");
    Object.keys(D.RELATIONSHIP_META).forEach(function (key) {
      var o = document.createElement("option"); o.value = key; o.textContent = D.RELATIONSHIP_META[key].label; relSel.appendChild(o);
    });
    var svg = $("#neSvg");
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("keydown", function (ev) {
      var nodeEl = ev.target.closest && ev.target.closest("[data-node]");
      if (nodeEl && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); if (s.linkMode) handleLinkClick(nodeEl.getAttribute("data-node")); else select({ type: "node", id: nodeEl.getAttribute("data-node") }); }
    });
    ["#neSearch", "#neStatus", "#neGroup", "#neRelType"].forEach(function (sel) { $(sel).addEventListener(sel === "#neSearch" ? "input" : "change", render); });
    $("#neSearch").addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter") return;
      var f = filters(), first = model().nodes.filter(function (n) { return nodeVisible(n, f); })[0];
      if (first) select({ type: "node", id: first.id });
    });
    function addNode(kind) { ui.openNew(kind, viewCentre()); }
    $("#neAddOrg").addEventListener("click", function () { addNode("org"); });
    $("#neAddProject").addEventListener("click", function () { addNode("project"); });
    $("#neAddTheme").addEventListener("click", function () { addNode("theme"); });
    $("#neLinkMode").addEventListener("click", function () { s.linkMode = !s.linkMode; s.linkSource = null; render(); });
    $("#neFit").addEventListener("click", fit);
    $("#neAutoArrange").addEventListener("click", async function () {
      var ok = await ui.askConfirm({ title: "Auto-arrange the editor layout", okLabel: "Auto-arrange", html: "<p>Resets the canvas positions of all nodes to the automatic layout. Only editor positions change; no records are modified.</p>" });
      if (ok !== "ok") return;
      try { await Store.resetLayout(); await ensureLayout(); fit(); } catch (error) { ui.showError(error); }
    });
    $("#nePanel").addEventListener("click", function (ev) {
      var act = ev.target.closest("[data-ne-action]"), edge = ev.target.closest("[data-ne-edge]"), node = ev.target.closest("[data-ne-node]");
      if (edge) { select({ type: "edge", id: edge.getAttribute("data-ne-edge") }); return; }
      if (node) { select({ type: "node", id: node.getAttribute("data-ne-node") }); return; }
      if (!act || !s.selected) return;
      var a = act.getAttribute("data-ne-action");
      if (a === "link") { s.linkMode = true; s.linkSource = s.selected.id; render(); return; }
      var kind;
      if (s.selected.type === "edge") kind = "rel";
      else { var nn = model().byId[s.selected.id]; kind = COLLECTION_KIND[nn.collection]; }
      ui.lifecycle(a, kind, s.selected.id);
    });
  }
  async function activate() {
    await ensureLayout();
    if (!s.fitted) { render(); fit(); s.fitted = true; }
    render();
  }

  window.RD_NETWORK_EDITOR = { mount: mount, activate: activate, render: render };
})();
