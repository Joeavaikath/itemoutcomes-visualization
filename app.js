const SCENARIOS = window.SCENARIOS || [];
let activeScenario = null;
let PARTICIPANTS = [];
let STORYBOARD = [];

const PHASE_LABELS = {
  prepare: "Prepare",
  capture: "Capture",
  "first-write": "First write",
  operations: "Operations",
  finalize: "Finalize",
  done: "Done",
};

const ROW_HEIGHT = 66;
const TOP_GAP = 34;
const BOTTOM_GAP = 34;

const $ = (selector) => document.querySelector(selector);

const stage = $("#sequence-stage");
const participantsEl = $("#participants");
const svg = $("#sequence-svg");
const sequenceScroll = $("#sequence-scroll");
const artifactView = $("#artifact-view");
const volumeInfoEl = $("#volume-info");
const finalizedBadge = $("#finalized-badge");
const phaseBadge = $("#phase-badge");
const narrationEl = $("#narration");
const stepCounter = $("#step-counter");
const phaseMarks = $("#phase-marks");
const scrubber = $("#scrubber");
const playButton = $("#play");
const stepButton = $("#step");
const resetButton = $("#reset");
const speedSelect = $("#speed");
const scenarioSelect = $("#scenario");
const scenarioDescription = $("#scenario-description");

let currentStep = 0;
let playing = false;
let timer = null;
let speed = Number(speedSelect.value);
let view = "table";
let snapshots = [];
let autoScroll = true;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function keyOf(row) {
  return `${row.groupResource}|${row.namespace || ""}|${row.name}`;
}

function emptyArtifact() {
  return {
    schemaVersion: "v1",
    kind: "backup",
    backupName: "",
    finalized: false,
    items: [],
  };
}

function applyOperation(artifact, operation, state) {
  switch (operation.type) {
    case "snapshot": {
      for (const key of Object.keys(artifact)) delete artifact[key];
      Object.assign(artifact, clone(operation.value));
      break;
    }

    case "envelope":
      Object.assign(artifact, clone(operation.patch));
      break;

    case "upsertRow": {
      const row = clone(operation.row);
      const rowKey = keyOf(row);
      const index = artifact.items.findIndex((item) => keyOf(item) === rowKey);
      if (index >= 0) {
        artifact.items[index] = { ...artifact.items[index], ...row };
      } else {
        artifact.items.push(row);
      }
      break;
    }

    case "patchRow": {
      const index = artifact.items.findIndex((item) => keyOf(item) === operation.key);
      if (index < 0) break;
      Object.assign(artifact.items[index], clone(operation.patch));
      for (const field of operation.remove || []) {
        delete artifact.items[index][field];
      }
      break;
    }

    case "renameRow": {
      const fromKey = keyOf(operation.from);
      const to = clone(operation.to);
      const toKey = keyOf(to);
      const index = artifact.items.findIndex((item) => keyOf(item) === fromKey);
      if (index < 0) break;

      const [row] = artifact.items.splice(index, 1);
      row.groupResource = to.groupResource;
      row.namespace = to.namespace;
      row.name = to.name;

      for (const item of artifact.items) {
        if (item.parent && keyOf(item.parent) === fromKey) {
          item.parent = {
            groupResource: to.groupResource,
            namespace: to.namespace,
            name: to.name,
          };
        }
      }

      const existingIndex = artifact.items.findIndex((item) => keyOf(item) === toKey);
      if (existingIndex >= 0) {
        artifact.items[existingIndex] = { ...artifact.items[existingIndex], ...row };
      } else {
        artifact.items.push(row);
      }
      break;
    }

    case "volumeInfo":
      state.volumeInfo = clone(operation.value);
      break;

    default:
      break;
  }
}

function buildSnapshots() {
  const artifact = emptyArtifact();
  const state = { volumeInfo: null };

  return STORYBOARD.map((step) => {
    const operations = step.operations || (step.operation ? [step.operation] : []);
    for (const operation of operations) applyOperation(artifact, operation, state);
    return {
      artifact: clone(artifact),
      volumeInfo: clone(state.volumeInfo),
      step,
    };
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightJson(value) {
  const escaped = JSON.stringify(value, null, 2)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let className = "json-number";
      if (/^"/.test(match)) {
        className = /:$/.test(match) ? "json-key" : "json-string";
      } else if (/true|false/.test(match)) {
        className = "json-boolean";
      } else if (/null/.test(match)) {
        className = "json-null";
      }
      return `<span class="${className}">${match}</span>`;
    },
  );
}

function resourceParts(groupResource) {
  const parts = String(groupResource || "").split(".");
  return {
    resource: parts[0] || groupResource || "—",
    group: parts.slice(1).join("."),
  };
}

function renderParticipants() {
  participantsEl.style.setProperty("--participant-count", String(PARTICIPANTS.length));
  stage.style.minWidth = `${Math.max(680, PARTICIPANTS.length * 96)}px`;
  participantsEl.innerHTML = PARTICIPANTS.map(
    (participant) => `
      <div class="participant" data-participant="${escapeHtml(participant.id)}">
        <span class="participant-dot" style="--dot:${escapeHtml(participant.color)}"></span>
        <span class="participant-label">${escapeHtml(participant.label)}</span>
        <span class="participant-role">${escapeHtml(participant.role)}</span>
      </div>
    `,
  ).join("");
}

function participantCenters() {
  const stageRect = stage.getBoundingClientRect();
  return Object.fromEntries(
    PARTICIPANTS.map((participant) => {
      const el = stage.querySelector(`[data-participant="${participant.id}"]`);
      const rect = el.getBoundingClientRect();
      return [participant.id, rect.left - stageRect.left + rect.width / 2];
    }),
  );
}

function svgLabelBackground(label, x, y) {
  const width = Math.max(48, label.length * 5.9 + 14);
  return `<rect class="label-bg" x="${x - width / 2}" y="${y - 23}" width="${width}" height="16" rx="5" />`;
}

function renderSequence() {
  if (!PARTICIPANTS.length || !STORYBOARD.length) return;

  const step = STORYBOARD[currentStep];
  const centers = participantCenters();
  const width = stage.clientWidth;
  const headerHeight = participantsEl.offsetHeight;
  const top = headerHeight + TOP_GAP;
  const svgHeight = STORYBOARD.length * ROW_HEIGHT + BOTTOM_GAP;

  stage.style.height = `${top + svgHeight}px`;
  svg.style.top = `${top}px`;
  svg.style.height = `${svgHeight}px`;
  svg.setAttribute("viewBox", `0 0 ${width} ${svgHeight}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", svgHeight);

  const lifelines = PARTICIPANTS.map((participant) => {
    const x = centers[participant.id];
    return `<line class="lifeline" x1="${x}" y1="0" x2="${x}" y2="${svgHeight}" />`;
  }).join("");

  const steps = STORYBOARD.slice(0, currentStep + 1)
    .map((item, index) => {
      const y = TOP_GAP + index * ROW_HEIGHT;
      const active = index === currentStep;
      const x1 = centers[item.from];
      const x2 = centers[item.to];
      const labelX = Math.min(Math.max((x1 + x2) / 2, 110), Math.max(110, width - 110));
      const band = `<rect class="step-band${active ? " active" : ""}" x="0" y="${y - 24}" width="${width}" height="48" rx="8" />`;
      const marker = active ? "arrow-active" : "arrow-muted";
      const labelClass = `arrow-label${active ? " active" : ""}`;
      const dot = `<circle class="step-dot${active ? " active" : ""}" cx="${x1}" cy="${y}" r="4" />`;

      if (item.from === item.to) {
        const labelWidth = Math.max(48, item.call.length * 5.9 + 14);
        const rightFits = x1 + 22 + labelWidth / 2 <= width - 12;
        const labelX = rightFits ? x1 + 22 : x1 - 22;
        const loopPath = rightFits
          ? `M ${x1} ${y - 12} h 34 a 10 10 0 0 1 10 10 v 4 a 10 10 0 0 1 -10 10 h -34`
          : `M ${x1} ${y - 12} h -34 a 10 10 0 0 0 -10 10 v 4 a 10 10 0 0 0 10 10 h 34`;
        return `${band}<path class="arrow-line${active ? " active" : ""}" d="${loopPath}" marker-end="url(#${marker})" />${svgLabelBackground(item.call, labelX, y - 6)}<text class="${labelClass}" x="${labelX}" y="${y - 17}" text-anchor="middle">${escapeHtml(item.call)}</text>${dot}`;
      }

      return `${band}<line class="arrow-line${active ? " active" : ""}" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-end="url(#${marker})" />${svgLabelBackground(item.call, labelX, y)}<text class="${labelClass}" x="${labelX}" y="${y - 11}" text-anchor="middle">${escapeHtml(item.call)}</text>${dot}`;
    })
    .join("");

  svg.innerHTML = `
    <defs>
      <marker id="arrow-muted" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
      </marker>
      <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="#38bdf8" />
      </marker>
    </defs>
    ${lifelines}
    ${steps}
  `;

  document.querySelectorAll(".participant").forEach((el) => {
    const active = el.dataset.participant === step.from || el.dataset.participant === step.to;
    el.classList.toggle("active", active);
  });

  if (autoScroll) {
    const target = top + currentStep * ROW_HEIGHT - 150;
    sequenceScroll.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }
}

function outcomeChip(outcome) {
  const value = String(outcome || "Succeeded");
  return `<span class="chip ${value.toLowerCase()}">${escapeHtml(value)}</span>`;
}

function parentCell(row) {
  if (!row.parent) return "—";
  const parts = resourceParts(row.parent.groupResource);
  const source = row.parentSource
    ? `<span class="parent-source">${escapeHtml(row.parentSource)}</span>`
    : "";
  return `<span class="parent-ref">${escapeHtml(row.parent.name)}</span><span class="parent-resource">${escapeHtml(parts.resource)}</span>${source}`;
}

function volumeCell(row) {
  if (row.volume) {
    if (row.volume.skipped) {
      return `<span class="volume-ref">skipped</span><span class="volume-method">${escapeHtml(row.volume.skippedReason || "volume path")}</span>`;
    }
    const attempts = row.volume.attempts ? row.volume.attempts.length : 0;
    return `<span class="volume-ref">${escapeHtml(row.volume.result || "—")}</span><span class="volume-method">${escapeHtml(row.volume.method || "volume")}</span>${attempts > 1 ? `<span class="volume-attempts">${attempts} attempts</span>` : ""}`;
  }

  if (row.volumeAttempts && row.volumeAttempts.length) {
    const count = row.volumeAttempts.length;
    return `<span class="volume-attempts">${count} capture attempt${count === 1 ? "" : "s"}</span>`;
  }

  return "—";
}

function renderTable(snapshot) {
  const items = [...snapshot.artifact.items].sort((a, b) => {
    if (a.groupResource !== b.groupResource) return a.groupResource.localeCompare(b.groupResource);
    if ((a.namespace || "") !== (b.namespace || "")) return (a.namespace || "").localeCompare(b.namespace || "");
    return a.name.localeCompare(b.name);
  });

  if (!items.length) {
    artifactView.innerHTML = `<div class="empty-state">No rows yet.<br />Press <strong>Play</strong> or <strong>Step</strong> to start the capture pass.</div>`;
    return;
  }

  const highlight = snapshot.step.highlight;
  const rows = items
    .map((row) => {
      const parts = resourceParts(row.groupResource);
      const rowKey = keyOf(row);
      const flash = rowKey === highlight ? " flash" : "";
      const messages = row.messages || [];
      const messageText = messages.length
        ? `<span class="row-messages" title="${escapeHtml(messages.join(" · "))}">${escapeHtml(messages[0])}${messages.length > 1 ? ` · +${messages.length - 1} more` : ""}</span>`
        : "";
      let marker = "";
      if (row.skippedByVolume) {
        if (row.outcome === "Succeeded") {
          marker = `<span class="row-tag rescued" title="The row was rescued by a captured volume; SkippedByVolume remains true as provenance.">rescued</span>`;
        } else if (row.outcome === "Skipped") {
          marker = `<span class="row-tag" title="The row's skip came from a volume path and is eligible for rescue.">volume-path skip</span>`;
        }
      }

      return `
        <tr class="${flash.trim()}">
          <td>
            <span class="resource-name">${escapeHtml(parts.resource)}</span>
            ${parts.group ? `<span class="resource-group">${escapeHtml(parts.group)}</span>` : ""}
          </td>
          <td>
            <span class="object-name">${escapeHtml(row.name)}</span>
            <span class="object-ns">${escapeHtml(row.namespace || "cluster-scoped")}</span>
            ${messageText}
          </td>
          <td>${outcomeChip(row.outcome)}${marker}</td>
          <td>${parentCell(row)}</td>
          <td>${volumeCell(row)}</td>
        </tr>
      `;
    })
    .join("");

  artifactView.innerHTML = `
    <table class="artifact-table">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Object</th>
          <th>Outcome</th>
          <th>Parent</th>
          <th>Volume</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderVolumeInfo(volumeInfo) {
  if (!volumeInfo) {
    volumeInfoEl.classList.add("hidden");
    volumeInfoEl.innerHTML = "";
    return;
  }

  const volumes = Array.isArray(volumeInfo) ? volumeInfo : [volumeInfo];
  const rows = volumes
    .map((volume) => {
      const attempts = Array.isArray(volume.attempts)
        ? volume.attempts.length
        : Number(volume.attempts || 0);
      const result = volume.skipped
        ? `skipped${volume.skippedReason ? ` · ${volume.skippedReason}` : ""}`
        : volume.result;
      return `
        <div class="volume-item">
          <div class="volume-line">pvc ${escapeHtml(volume.pvcNamespace)}/${escapeHtml(volume.pvcName)} · pv ${escapeHtml(volume.pvName)}</div>
          <div class="volume-line"><strong>${escapeHtml(volume.method || "volume")}</strong> ${escapeHtml(result || "")}${attempts > 1 ? ` · ${attempts} attempts` : ""}</div>
        </div>
      `;
    })
    .join("");

  volumeInfoEl.classList.remove("hidden");
  volumeInfoEl.innerHTML = `
    <div class="volume-title"><span class="volume-dot"></span> Volume info</div>
    ${rows}
  `;
}

function renderArtifact(snapshot) {
  const finalized = snapshot.artifact.finalized;
  finalizedBadge.className = `badge ${finalized ? "finalized" : "muted"}`;
  finalizedBadge.textContent = finalized ? "finalized" : "provisional";

  renderVolumeInfo(snapshot.volumeInfo);

  if (view === "json") {
    artifactView.innerHTML = `<pre class="json-view">${highlightJson(snapshot.artifact)}</pre>`;
  } else {
    renderTable(snapshot);
  }
}

function renderTimeline(snapshot) {
  const step = snapshot.step;
  phaseBadge.textContent = PHASE_LABELS[step.phase] || step.phase;
  narrationEl.textContent = step.narration;
  stepCounter.textContent = `${currentStep + 1} / ${STORYBOARD.length}`;

  const phases = [...new Set(STORYBOARD.map((item) => item.phase))];
  const currentPhaseIndex = phases.indexOf(step.phase);
  phaseMarks.innerHTML = phases
    .map((phase, index) => {
      const className = index === currentPhaseIndex ? "active" : index < currentPhaseIndex ? "past" : "";
      return `<span class="phase-mark ${className}">${escapeHtml(PHASE_LABELS[phase] || phase)}</span>`;
    })
    .join("");

  scrubber.max = String(STORYBOARD.length - 1);
  scrubber.value = String(currentStep);
  const progress = STORYBOARD.length <= 1 ? 0 : (currentStep / (STORYBOARD.length - 1)) * 100;
  scrubber.style.setProperty("--progress", `${progress}%`);
}

function render() {
  const snapshot = snapshots[currentStep];
  renderSequence();
  renderArtifact(snapshot);
  renderTimeline(snapshot);
}

function setStep(index, options = {}) {
  currentStep = Math.max(0, Math.min(index, STORYBOARD.length - 1));
  autoScroll = options.scroll !== false;
  render();
}

function updatePlayButton() {
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.classList.toggle("primary", !playing);
}

function pause() {
  playing = false;
  if (timer) clearInterval(timer);
  timer = null;
  updatePlayButton();
}

function play() {
  if (playing) {
    pause();
    return;
  }

  if (currentStep >= STORYBOARD.length - 1) {
    currentStep = 0;
    render();
  }

  playing = true;
  autoScroll = true;
  updatePlayButton();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (currentStep >= STORYBOARD.length - 1) {
      pause();
      return;
    }
    setStep(currentStep + 1);
  }, speed);
}

function selectView(nextView) {
  view = nextView;
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderArtifact(snapshots[currentStep]);
}

playButton.addEventListener("click", play);
stepButton.addEventListener("click", () => {
  pause();
  setStep(currentStep + 1);
});
resetButton.addEventListener("click", () => {
  pause();
  setStep(0);
});
scrubber.addEventListener("input", (event) => {
  pause();
  setStep(Number(event.target.value));
});
speedSelect.addEventListener("change", (event) => {
  speed = Number(event.target.value);
  if (playing) {
    pause();
    play();
  }
});
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => selectView(tab.dataset.view));
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea")) return;
  if (event.code === "Space") {
    event.preventDefault();
    play();
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    pause();
    setStep(currentStep + 1);
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    pause();
    setStep(currentStep - 1);
  }
});
window.addEventListener("resize", () => {
  renderSequence();
});

function loadScenario(id) {
  pause();
  const scenario = SCENARIOS.find((item) => item.id === id) || SCENARIOS[0];
  if (!scenario) return;

  activeScenario = scenario;
  PARTICIPANTS = scenario.participants;
  STORYBOARD = scenario.steps;
  snapshots = buildSnapshots();
  currentStep = 0;
  autoScroll = true;
  sequenceScroll.scrollTop = 0;
  scenarioSelect.value = scenario.id;
  scenarioDescription.textContent = scenario.description;
  document.title = `Item Outcomes — ${scenario.title}`;
  renderParticipants();
  render();
  requestAnimationFrame(() => renderSequence());
}

scenarioSelect.innerHTML = SCENARIOS.map(
  (scenario) => `<option value="${escapeHtml(scenario.id)}">${escapeHtml(scenario.title)}</option>`,
).join("");
scenarioSelect.addEventListener("change", (event) => loadScenario(event.target.value));
if (SCENARIOS.length) loadScenario(SCENARIOS[0].id);
