import topicsPayload from "../data/topics.json";
import dependenciesPayload from "../data/dependencies.json";
import "./styles.css";

const topics = topicsPayload.topics;
const dependencies = dependenciesPayload.dependencies;

const palette = {
  Mathematics: "#496cff",
  Science: "#90b5ec",
  English: "#eb5c8e",
  History: "#f0e5c9",
  "Personal & Social Development": "#ef3733",
  "Life Skills": "#e8a6b5",
  Computing: "#7676c9",
  "Learning to Learn": "#ebb39d",
};

const subjects = Object.keys(palette);
const byId = new Map(topics.map((topic) => [topic.id, topic]));
const incoming = new Map();
const outgoing = new Map();

dependencies.forEach((edge) => {
  incoming.set(edge.topicId, [...(incoming.get(edge.topicId) ?? []), edge]);
  outgoing.set(edge.prerequisiteId, [...(outgoing.get(edge.prerequisiteId) ?? []), edge]);
});

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967295;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function topicAge(topic) {
  return (topic.ageRangeStart + topic.ageRangeEnd) / 2;
}

function topicPosition(topic) {
  const ageProgress = clamp((topicAge(topic) - 3) / 11, 0, 1);
  const subjectAngle = (subjects.indexOf(topic.subject) / subjects.length) * Math.PI * 2;
  const domainOffset = (hash(topic.domain) - 0.5) * 0.7;
  const jitter = (hash(topic.id) - 0.5) * 0.38;
  const radius = 48 + ageProgress * 350 + (hash(`${topic.id}:r`) - 0.5) * 64;
  const angle = subjectAngle + domainOffset + jitter;
  return {
    x: Math.cos(angle) * radius,
    y: (0.5 - ageProgress) * 585 + (hash(`${topic.id}:y`) - 0.5) * 58,
    z: Math.sin(angle) * radius,
  };
}

const graphNodes = topics.map((topic) => ({ ...topic, position: topicPosition(topic) }));
const graphById = new Map(graphNodes.map((topic) => [topic.id, topic]));
const activeSubjects = new Set(subjects);
const state = {
  selected: null,
  hovered: null,
  history: [],
  rotation: { x: -0.09, y: -0.22 },
  distance: 905,
  level: 1,
  dragging: false,
  pointer: { x: 0, y: 0 },
};

const app = document.querySelector("#app");
const canvas = document.querySelector("#graph");
const context = canvas.getContext("2d", { alpha: true });
const panel = document.querySelector("#panel");
const tooltip = document.querySelector("#tooltip");
const search = document.querySelector("#search");
const searchInput = document.querySelector("#search-input");
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const filterList = document.querySelector("#filter-list");
const filters = document.querySelector("#filters");
const zoomLevel = document.querySelector("#zoom-level");
const zoomLabel = document.querySelector("#zoom-label");

document.querySelector("#topic-count").textContent = `${topics.length.toLocaleString()} concepts`;
document.querySelector("#edge-count").textContent = `${dependencies.length.toLocaleString()} prerequisite links`;

let width = 0;
let height = 0;
let dpr = 1;
let screenPoints = [];
let visibleNodes = [];
let visibleEdges = [];
let visibleIds = new Set();
let connectedIds = new Set();
let pointerDrag = null;
const pointers = new Map();
let pinch = null;

function setVisibleGraph() {
  visibleNodes = graphNodes.filter((node) => activeSubjects.has(node.subject));
  visibleIds = new Set(visibleNodes.map((node) => node.id));
  visibleEdges = dependencies.filter((edge) => visibleIds.has(edge.prerequisiteId) && visibleIds.has(edge.topicId));
}

function setConnected() {
  connectedIds = new Set();
  if (!state.selected) return;
  connectedIds.add(state.selected.id);
  (incoming.get(state.selected.id) ?? []).forEach((edge) => connectedIds.add(edge.prerequisiteId));
  (outgoing.get(state.selected.id) ?? []).forEach((edge) => connectedIds.add(edge.topicId));
}

function renderFilters() {
  filterList.innerHTML = subjects.map((subject) => {
    const count = topics.filter((topic) => topic.subject === subject).length;
    return `<button type="button" class="${activeSubjects.has(subject) ? "active" : ""}" aria-pressed="${activeSubjects.has(subject)}" data-subject="${escapeHtml(subject)}"><i style="background:${palette[subject]}"></i><span>${escapeHtml(subject)}</span><b>${count}</b></button>`;
  }).join("");
}

function updateZoomLabel() {
  const nextLevel = state.distance < 610 ? 3 : state.distance < 970 ? 2 : 1;
  state.level = nextLevel;
  zoomLevel.textContent = `0${nextLevel}`;
  zoomLabel.textContent = nextLevel === 1 ? "System" : nextLevel === 2 ? "Concepts" : "Relations";
}

function resize() {
  const rect = app.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function project(point) {
  const cosY = Math.cos(state.rotation.y);
  const sinY = Math.sin(state.rotation.y);
  const cosX = Math.cos(state.rotation.x);
  const sinX = Math.sin(state.rotation.x);
  const x1 = point.x * cosY - point.z * sinY;
  const z1 = point.x * sinY + point.z * cosY;
  const y1 = point.y * cosX - z1 * sinX;
  const z2 = point.y * sinX + z1 * cosX;
  const scale = state.distance / Math.max(185, state.distance + z2);
  return {
    x: (width < 800 ? width * 0.53 : width * 0.62) + x1 * scale,
    y: height * 0.51 + y1 * scale,
    depth: z2,
    scale,
  };
}

function drawBackground() {
  context.clearRect(0, 0, width, height);
  const gradient = context.createRadialGradient(width * 0.61, height * 0.42, 0, width * 0.61, height * 0.42, Math.max(width, height) * 0.75);
  gradient.addColorStop(0, "#101521");
  gradient.addColorStop(0.58, "#090b12");
  gradient.addColorStop(1, "#07090f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawGraph() {
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground();
  if (!state.dragging && !state.selected && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) state.rotation.y += 0.00042;

  const projected = new Map();
  visibleNodes.forEach((node) => projected.set(node.id, project(node.position)));

  visibleEdges.forEach((edge) => {
    const source = projected.get(edge.prerequisiteId);
    const target = projected.get(edge.topicId);
    if (!source || !target) return;
    const highlighted = Boolean(state.selected && (edge.prerequisiteId === state.selected.id || edge.topicId === state.selected.id));
    context.globalAlpha = state.selected && !highlighted ? 0.024 : highlighted ? 0.78 : state.level === 3 ? 0.14 : 0.075;
    context.strokeStyle = highlighted ? "#e9e8f2" : edge.strength === "hard" ? "#7984a9" : "#555d79";
    context.lineWidth = highlighted ? 1.15 : 0.43;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
  });

  const sorted = visibleNodes
    .map((node) => ({ node, point: projected.get(node.id) }))
    .sort((a, b) => b.point.depth - a.point.depth);

  screenPoints = [];
  sorted.forEach(({ node, point }) => {
    const active = state.selected?.id === node.id;
    const connected = connectedIds.has(node.id);
    const dimmed = Boolean(state.selected && !connected);
    const base = 2.05 + clamp(node.centrality, 0, 1) * 5.8;
    const radius = clamp(base * point.scale, 1.25, active ? 13 : 9.5);

    if (active || connected) {
      context.globalAlpha = active ? 0.34 : 0.11;
      context.fillStyle = palette[node.subject];
      context.beginPath();
      context.arc(point.x, point.y, radius + (active ? 14 : 6), 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = dimmed ? 0.075 : clamp(0.46 + point.scale * 0.38, 0.4, 1);
    context.fillStyle = active ? "#fff8ed" : palette[node.subject];
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();

    if (active) {
      context.globalAlpha = 1;
      context.strokeStyle = palette[node.subject];
      context.lineWidth = 2;
      context.stroke();
    }

    if ((active || (connected && state.level === 3)) && width >= 700) {
      context.globalAlpha = dimmed ? 0.1 : 0.88;
      context.fillStyle = "#f1efed";
      context.font = "600 9px Inter, sans-serif";
      context.textAlign = "center";
      context.fillText(node.name, point.x, point.y + radius + 14);
    }

    screenPoints.push({ id: node.id, x: point.x, y: point.y, radius: Math.max(10, radius + 4), depth: point.depth });
  });
  context.globalAlpha = 1;
  requestAnimationFrame(drawGraph);
}

function nearestNode(x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  screenPoints.forEach((point) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= point.radius && distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });
  return nearest ? graphById.get(nearest.id) : null;
}

function allPrerequisites(topicId) {
  const seen = new Set();
  const queue = (incoming.get(topicId) ?? []).map((edge) => edge.prerequisiteId);
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    (incoming.get(id) ?? []).forEach((edge) => queue.push(edge.prerequisiteId));
  }
  return seen;
}

function relationRows(edges, direction) {
  return edges.slice(0, 14).map((edge) => {
    const id = direction === "incoming" ? edge.prerequisiteId : edge.topicId;
    const topic = byId.get(id);
    if (!topic) return "";
    return `<button type="button" data-topic-id="${escapeHtml(topic.id)}"><i style="background:${palette[topic.subject]}"></i><span><b>${escapeHtml(topic.name)}</b><small>${escapeHtml(edge.reason)}</small></span><em>age ${topic.ageRangeStart}</em></button>`;
  }).join("");
}

function renderPanel() {
  const topic = state.selected;
  if (!topic) {
    panel.hidden = true;
    app.classList.remove("has-selection");
    return;
  }
  const directPrerequisites = incoming.get(topic.id) ?? [];
  const directUnlocks = outgoing.get(topic.id) ?? [];
  const total = allPrerequisites(topic.id).size;
  const assessment = topic.assessmentPrompt?.replaceAll("{{name}}", "the learner");
  const age = topic.ageRangeStart === topic.ageRangeEnd ? `age ${topic.ageRangeStart}` : `ages ${topic.ageRangeStart}–${topic.ageRangeEnd}`;
  panel.innerHTML = `
    <header>${state.history.length ? '<button type="button" data-action="back">← Back</button>' : "<span></span>"}<button type="button" data-action="close" aria-label="Close concept">×</button></header>
    <p class="panel-meta"><i style="background:${palette[topic.subject]}"></i>${escapeHtml(topic.domain)} · ${age}</p>
    <h2>${escapeHtml(topic.name)}</h2>
    <p class="panel-description">${escapeHtml(topic.description)}</p>
    <div class="panel-count"><strong>${total}</strong><span>${total === 1 ? "prerequisite" : "prerequisites"} in total<br />traced all the way back</span></div>
    ${assessment ? `<blockquote class="assessment">${escapeHtml(assessment)}</blockquote>` : ""}
    ${directPrerequisites.length ? `<section class="relation-section"><p>Builds directly on <b>${directPrerequisites.length}</b></p>${relationRows(directPrerequisites, "incoming")}</section>` : ""}
    ${directUnlocks.length ? `<section class="relation-section"><p>Unlocks next <b>${directUnlocks.length}</b></p>${relationRows(directUnlocks, "outgoing")}</section>` : ""}
    ${topic.evidence?.length ? `<details open><summary>Evidence of understanding</summary><ul>${topic.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
    ${topic.standards?.length ? `<details><summary>Curriculum alignment · ${topic.standards.length}</summary><ul>${topic.standards.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
  `;
  panel.hidden = false;
  panel.scrollTop = 0;
  app.classList.add("has-selection");
}

function selectTopic(topic, remember = true) {
  if (!topic) return;
  if (remember && state.selected && state.selected.id !== topic.id) state.history.push(state.selected.id);
  state.selected = graphById.get(topic.id) ?? topic;
  state.distance = clamp(state.distance * 0.86, 405, 1450);
  setConnected();
  updateZoomLabel();
  renderPanel();
  closeSearch();
  history.replaceState({}, "", `${location.pathname}?concept=${encodeURIComponent(topic.id)}`);
}

function clearSelection() {
  state.selected = null;
  state.history = [];
  setConnected();
  renderPanel();
  history.replaceState({}, "", location.pathname);
}

function showTooltip(topic, x, y) {
  if (!topic || state.selected || state.dragging) {
    tooltip.hidden = true;
    return;
  }
  tooltip.innerHTML = `<small>${escapeHtml(topic.subject)} · ${escapeHtml(topic.domain)} · age ${topic.ageRangeStart}</small><b>${escapeHtml(topic.name)}</b><span>${escapeHtml(topic.description)}</span>`;
  tooltip.style.borderLeftColor = palette[topic.subject];
  const left = clamp(x + 18, 12, width - 302);
  const top = clamp(y + 15, 65, height - 155);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.hidden = false;
}

function zoom(factor) {
  state.distance = clamp(state.distance * factor, 395, 1500);
  updateZoomLabel();
}

function resetGraph() {
  state.rotation = { x: -0.09, y: -0.22 };
  state.distance = 905;
  clearSelection();
  updateZoomLabel();
}

function openSearch() {
  search.hidden = false;
  searchInput.focus();
}

function closeSearch() {
  search.hidden = true;
  searchInput.value = "";
  searchResults.innerHTML = "";
  searchStatus.textContent = "Search by concept, domain, subject, or description";
}

function renderSearchResults(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    searchResults.innerHTML = "";
    searchStatus.textContent = "Search by concept, domain, subject, or description";
    return;
  }
  const results = topics.filter((topic) => `${topic.name} ${topic.domain} ${topic.subject} ${topic.description}`.toLowerCase().includes(normalized)).slice(0, 24);
  searchStatus.textContent = `${results.length} matching ${results.length === 1 ? "concept" : "concepts"}`;
  searchResults.innerHTML = results.map((topic) => `<button type="button" data-topic-id="${escapeHtml(topic.id)}"><i style="background:${palette[topic.subject]}"></i><span><b>${escapeHtml(topic.name)}</b><small>${escapeHtml(topic.domain)} · ${escapeHtml(topic.description)}</small></span><em>→</em></button>`).join("");
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (event) => {
  const point = eventPoint(event);
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, point);
  state.dragging = true;
  canvas.classList.add("dragging");
  tooltip.hidden = true;
  if (pointers.size === 1) pointerDrag = { id: event.pointerId, ...point, startX: point.x, startY: point.y, rotationX: state.rotation.x, rotationY: state.rotation.y };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(b.x - a.x, b.y - a.y), camera: state.distance };
    pointerDrag = null;
  }
});

canvas.addEventListener("pointermove", (event) => {
  const point = eventPoint(event);
  state.pointer = point;
  if (!pointers.has(event.pointerId)) {
    const topic = nearestNode(point.x, point.y);
    if (topic?.id !== state.hovered?.id) state.hovered = topic;
    showTooltip(topic, point.x, point.y);
    canvas.style.cursor = topic ? "pointer" : "grab";
    return;
  }
  pointers.set(event.pointerId, point);
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    state.distance = clamp(pinch.camera / (Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, pinch.distance)), 395, 1500);
    updateZoomLabel();
  } else if (pointerDrag?.id === event.pointerId) {
    state.rotation.y = pointerDrag.rotationY + (point.x - pointerDrag.x) * 0.006;
    state.rotation.x = clamp(pointerDrag.rotationX + (point.y - pointerDrag.y) * 0.0046, -1.08, 1.08);
  }
});

function finishPointer(event) {
  const point = eventPoint(event);
  const drag = pointerDrag;
  const moved = drag ? Math.hypot(point.x - drag.startX, point.y - drag.startY) : 100;
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    state.dragging = false;
    canvas.classList.remove("dragging");
    pointerDrag = null;
  }
  if (moved < 7) selectTopic(nearestNode(point.x, point.y));
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("pointerleave", () => { tooltip.hidden = true; });
canvas.addEventListener("wheel", (event) => { event.preventDefault(); zoom(Math.exp(event.deltaY * 0.001)); }, { passive: false });
canvas.addEventListener("dblclick", () => zoom(0.72));

filterList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-subject]");
  if (!button) return;
  const subject = button.dataset.subject;
  if (activeSubjects.has(subject)) activeSubjects.delete(subject); else activeSubjects.add(subject);
  if (!activeSubjects.size) subjects.forEach((item) => activeSubjects.add(item));
  if (state.selected && !activeSubjects.has(state.selected.subject)) clearSelection();
  setVisibleGraph();
  renderFilters();
});

panel.addEventListener("click", (event) => {
  const action = event.target.closest("button[data-action]")?.dataset.action;
  if (action === "close") clearSelection();
  if (action === "back") {
    const previous = state.history.pop();
    if (previous) selectTopic(byId.get(previous), false);
  }
  const topicButton = event.target.closest("button[data-topic-id]");
  if (topicButton) selectTopic(byId.get(topicButton.dataset.topicId));
});

searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-topic-id]");
  if (button) selectTopic(byId.get(button.dataset.topicId));
});

document.querySelector("#search-trigger").addEventListener("click", openSearch);
document.querySelector("#search-close").addEventListener("click", closeSearch);
document.querySelector("#begin").addEventListener("click", () => zoom(0.72));
document.querySelector("#zoom-in").addEventListener("click", () => zoom(0.78));
document.querySelector("#zoom-out").addEventListener("click", () => zoom(1.28));
document.querySelector("#reset").addEventListener("click", resetGraph);
document.querySelector("#filters-title").addEventListener("click", () => {
  filters.classList.toggle("collapsed");
  document.querySelector("#filters-title").setAttribute("aria-expanded", String(!filters.classList.contains("collapsed")));
});
searchInput.addEventListener("input", () => renderSearchResults(searchInput.value));

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && search.hidden && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); openSearch(); }
  if (event.key === "Escape") {
    if (!search.hidden) closeSearch();
    else if (state.selected) clearSelection();
  }
});

window.addEventListener("resize", resize);
resize();
setVisibleGraph();
renderFilters();
updateZoomLabel();

const initialConcept = new URLSearchParams(location.search).get("concept");
if (initialConcept && byId.has(initialConcept)) selectTopic(byId.get(initialConcept), false);

requestAnimationFrame(drawGraph);
