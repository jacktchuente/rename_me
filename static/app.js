const directoryInput = document.getElementById("directory");
const loadFilesBtn = document.getElementById("loadFiles");
const fileList = document.getElementById("fileList");
const previewBtn = document.getElementById("preview");
const applyBtn = document.getElementById("apply");
const previewRows = document.getElementById("previewRows");
const previewMeta = document.getElementById("previewMeta");
const alerts = document.getElementById("alerts");
const progressWrap = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

const presetName = document.getElementById("presetName");
const presetSelect = document.getElementById("presetSelect");
const savePresetBtn = document.getElementById("savePreset");
const loadPresetBtn = document.getElementById("loadPreset");
const deletePresetBtn = document.getElementById("deletePreset");

const addDeleteBtn = document.getElementById("addDelete");
const addExtractBtn = document.getElementById("addExtract");
const addOrderBtn = document.getElementById("addOrder");
const addImdbBtn = document.getElementById("addImdb");
const addPaddingBtn = document.getElementById("addPadding");
const transformList = document.getElementById("transformList");

let lastPreview = null;
let transforms = [];
let progressTimer = null;

const typeLabels = {
  delete: "Suppression",
  extract: "Extraction",
  order: "Ordre",
  padding: "Padding",
  imdb: "IMDb",
};

function setAlerts(messages) {
  alerts.innerHTML = "";
  messages.forEach((message) => {
    const line = document.createElement("div");
    line.textContent = message;
    alerts.appendChild(line);
  });
}

function setProgress(active, message, percent) {
  if (!progressWrap) {
    return;
  }
  if (!active) {
    progressWrap.classList.add("hidden");
    progressBar.style.width = "0%";
    progressText.textContent = "";
    return;
  }
  progressWrap.classList.remove("hidden");
  if (typeof percent === "number") {
    progressBar.style.width = `${percent}%`;
  }
  if (message) {
    progressText.textContent = message;
  }
}

function renderFiles(files) {
  fileList.innerHTML = "";
  files.forEach((file) => {
    const item = document.createElement("li");
    item.textContent = file;
    fileList.appendChild(item);
  });
}

function renderPreview(preview) {
  previewRows.innerHTML = "";
  preview.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "table-row" + (item.changed ? "" : " unchanged");
    const original = document.createElement("span");
    original.textContent = item.original;
    const proposed = document.createElement("span");
    proposed.textContent = item.proposed;
    row.style.animationDelay = `${index * 0.03}s`;
    row.appendChild(original);
    row.appendChild(proposed);
    previewRows.appendChild(row);
  });
  previewMeta.textContent = `${preview.length} elements`;
}

function createTransform(type) {
  const id = crypto.randomUUID();
  if (type === "delete") {
    return { id, type, needle: "" };
  }
  if (type === "extract") {
    return { id, type, pattern: "", template: "" };
  }
  if (type === "order") {
    return { id, type, start: 1 };
  }
  if (type === "imdb") {
    return { id, type, imdb_id: "" };
  }
  if (type === "padding") {
    return { id, type, side: "before", length: 3, char: "0" };
  }
  return { id, type: "delete", needle: "" };
}

function updateTransform(id, field, value) {
  transforms = transforms.map((transform) => {
    if (transform.id !== id) {
      return transform;
    }
    return { ...transform, [field]: value };
  });
}

function moveTransform(id, direction) {
  const index = transforms.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= transforms.length) {
    return;
  }
  const updated = [...transforms];
  [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
  transforms = updated;
  renderTransforms();
}

function removeTransform(id) {
  transforms = transforms.filter((item) => item.id !== id);
  renderTransforms();
}

function transformHeader(transform) {
  const header = document.createElement("div");
  header.className = "transform-header";

  const title = document.createElement("strong");
  title.textContent = typeLabels[transform.type] || transform.type;

  const actions = document.createElement("div");
  actions.className = "transform-actions";

  const upBtn = document.createElement("button");
  upBtn.className = "ghost tiny";
  upBtn.textContent = "Haut";
  upBtn.addEventListener("click", () => moveTransform(transform.id, "up"));

  const downBtn = document.createElement("button");
  downBtn.className = "ghost tiny";
  downBtn.textContent = "Bas";
  downBtn.addEventListener("click", () => moveTransform(transform.id, "down"));

  const removeBtn = document.createElement("button");
  removeBtn.className = "ghost tiny";
  removeBtn.textContent = "Retirer";
  removeBtn.addEventListener("click", () => removeTransform(transform.id));

  actions.appendChild(upBtn);
  actions.appendChild(downBtn);
  actions.appendChild(removeBtn);

  header.appendChild(title);
  header.appendChild(actions);
  return header;
}

function createInput({ value, placeholder, type = "text" }) {
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.value = value;
  return input;
}

function renderTransforms() {
  transformList.innerHTML = "";
  transforms.forEach((transform) => {
    const item = document.createElement("div");
    item.className = "transform-item";
    item.appendChild(transformHeader(transform));

    if (transform.type === "delete") {
      const input = createInput({
        value: transform.needle || "",
        placeholder: "Chaine a supprimer",
      });
      input.addEventListener("input", (event) => {
        updateTransform(transform.id, "needle", event.target.value);
      });
      item.appendChild(input);
    }

    if (transform.type === "extract") {
      const pattern = createInput({
        value: transform.pattern || "",
        placeholder: 'Regex, ex: "^Nom(99[a-z])"',
      });
      pattern.addEventListener("input", (event) => {
        updateTransform(transform.id, "pattern", event.target.value);
      });

      const template = createInput({
        value: transform.template || "",
        placeholder: 'Template, ex: "S$1E$2"',
      });
      template.addEventListener("input", (event) => {
        updateTransform(transform.id, "template", event.target.value);
      });

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Utilisez $1, $2... pour injecter les groupes captures.";

      item.appendChild(pattern);
      item.appendChild(template);
      item.appendChild(hint);
    }

    if (transform.type === "order") {
      const input = createInput({
        value: transform.start || 1,
        placeholder: "1",
        type: "number",
      });
      input.min = "0";
      input.addEventListener("input", (event) => {
        const value = parseInt(event.target.value || "1", 10);
        updateTransform(transform.id, "start", value);
      });

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Le renommage numerote les fichiers dans l'ordre alphabetique actuel.";

      item.appendChild(input);
      item.appendChild(hint);
    }

    if (transform.type === "imdb") {
      const input = createInput({
        value: transform.imdb_id || "",
        placeholder: "tt1234567",
      });
      input.addEventListener("input", (event) => {
        updateTransform(transform.id, "imdb_id", event.target.value);
      });

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Associe les fichiers a la liste chronologique d'episodes (SxxEyy).";

      item.appendChild(input);
      item.appendChild(hint);
    }

    if (transform.type === "padding") {
      const sideSelect = document.createElement("select");
      const beforeOption = document.createElement("option");
      beforeOption.value = "before";
      beforeOption.textContent = "Avant";
      const afterOption = document.createElement("option");
      afterOption.value = "after";
      afterOption.textContent = "Apres";
      sideSelect.appendChild(beforeOption);
      sideSelect.appendChild(afterOption);
      sideSelect.value = transform.side || "before";
      sideSelect.addEventListener("change", (event) => {
        updateTransform(transform.id, "side", event.target.value);
      });

      const lengthInput = createInput({
        value: transform.length || 0,
        placeholder: "Longueur",
        type: "number",
      });
      lengthInput.min = "0";
      lengthInput.addEventListener("input", (event) => {
        const value = parseInt(event.target.value || "0", 10);
        updateTransform(transform.id, "length", value);
      });

      const charInput = createInput({
        value: transform.char || "0",
        placeholder: "Caractere",
      });
      charInput.maxLength = 1;
      charInput.addEventListener("input", (event) => {
        updateTransform(transform.id, "char", event.target.value);
      });

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Complete le nom jusqu'a la longueur choisie.";

      item.appendChild(sideSelect);
      item.appendChild(lengthInput);
      item.appendChild(charInput);
      item.appendChild(hint);
    }

    transformList.appendChild(item);
  });
}

function gatherTransforms() {
  return transforms.map((transform) => {
    const { id, ...payload } = transform;
    return payload;
  });
}

async function loadFiles() {
  const directory = directoryInput.value.trim();
  if (!directory) {
    setAlerts(["Veuillez renseigner un chemin de dossier."]);
    return;
  }
  const response = await fetch(`/api/files?directory=${encodeURIComponent(directory)}`);
  const data = await response.json();
  if (!response.ok) {
    setAlerts([data.detail || "Impossible de charger les fichiers."]);
    return;
  }
  renderFiles(data.files);
  setAlerts([]);
}

async function preview() {
  const directory = directoryInput.value.trim();
  if (!directory) {
    setAlerts(["Veuillez renseigner un chemin de dossier."]);
    return null;
  }
  const payload = {
    directory,
    transforms: gatherTransforms(),
  };
  const response = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    setAlerts([data.detail || "Previsualisation impossible."]);
    return null;
  }
  lastPreview = data;
  renderPreview(data.preview);
  const messages = [];
  if (data.unchanged.length) {
    messages.push(`Attention: ${data.unchanged.length} fichier(s) inchange(s).`);
  }
  if (data.imdb_missing.length) {
    messages.push("IMDb: certains fichiers n'ont pas d'episode correspondant.");
  }
  setAlerts(messages);
  return data;
}

async function applyTransforms() {
  const snapshot = lastPreview || (await preview());
  if (!snapshot) {
    return;
  }
  if (snapshot.unchanged.length) {
    const confirmMessage =
      "Certains fichiers ne changent pas. Voulez-vous vraiment appliquer les transformations ?";
    if (!window.confirm(confirmMessage)) {
      return;
    }
  }
  if (progressTimer) {
    clearInterval(progressTimer);
  }
  let progressValue = 10;
  setProgress(true, "Traitement en cours...", progressValue);
  progressTimer = setInterval(() => {
    progressValue = Math.min(progressValue + 7, 90);
    setProgress(true, "Traitement en cours...", progressValue);
  }, 250);
  const response = await fetch("/api/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directory: directoryInput.value.trim(),
      transforms: gatherTransforms(),
    }),
  });
  const data = await response.json();
  clearInterval(progressTimer);
  progressTimer = null;
  if (!response.ok) {
    setProgress(true, "Erreur lors du traitement.", 100);
    setAlerts([data.detail || "Application impossible."]);
    setTimeout(() => setProgress(false), 1200);
    return;
  }
  setProgress(true, "Traitement termine.", 100);
  const messages = [
    `${data.renamed} fichier(s) renomme(s) sur ${data.total}.`,
    ...(data.unchanged.length ? ["Certains fichiers n'ont pas change."] : []),
    ...(data.imdb_missing.length ? ["IMDb: certains fichiers n'ont pas d'episode correspondant."] : []),
  ];
  if (data.errors && data.errors.length) {
    messages.push("Erreurs detectees:");
    data.errors.slice(0, 5).forEach((error) => messages.push(error));
    if (data.errors.length > 5) {
      messages.push(`... et ${data.errors.length - 5} autre(s).`);
    }
  }
  setAlerts(messages);
  setTimeout(() => setProgress(false), 1200);
  lastPreview = null;
  await loadFiles();
}

async function refreshPresets() {
  const response = await fetch("/api/presets");
  const data = await response.json();
  presetSelect.innerHTML = "";
  data.presets.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    presetSelect.appendChild(option);
  });
}

function applyPresetTransforms(items) {
  transforms = items.map((item) => ({
    id: crypto.randomUUID(),
    ...item,
  }));
  renderTransforms();
}

addDeleteBtn.addEventListener("click", () => {
  transforms.push(createTransform("delete"));
  renderTransforms();
});

addExtractBtn.addEventListener("click", () => {
  transforms.push(createTransform("extract"));
  renderTransforms();
});

addOrderBtn.addEventListener("click", () => {
  transforms.push(createTransform("order"));
  renderTransforms();
});

addImdbBtn.addEventListener("click", () => {
  transforms.push(createTransform("imdb"));
  renderTransforms();
});

addPaddingBtn.addEventListener("click", () => {
  transforms.push(createTransform("padding"));
  renderTransforms();
});

loadFilesBtn.addEventListener("click", () => {
  loadFiles().catch(() => setAlerts(["Erreur lors du chargement."]));
});

previewBtn.addEventListener("click", () => {
  preview().catch(() => setAlerts(["Erreur lors de la previsualisation."]));
});

applyBtn.addEventListener("click", () => {
  applyTransforms().catch(() => setAlerts(["Erreur lors de l'application."]));
});

savePresetBtn.addEventListener("click", async () => {
  const name = presetName.value.trim();
  if (!name) {
    setAlerts(["Veuillez nommer le preset."]);
    return;
  }
  const response = await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, transforms: gatherTransforms() }),
  });
  const data = await response.json();
  if (!response.ok) {
    setAlerts([data.detail || "Impossible d'enregistrer le preset."]);
    return;
  }
  presetName.value = "";
  await refreshPresets();
  setAlerts(["Preset enregistre."]);
});

loadPresetBtn.addEventListener("click", async () => {
  const name = presetSelect.value;
  if (!name) {
    return;
  }
  const response = await fetch(`/api/presets/${encodeURIComponent(name)}`);
  const data = await response.json();
  if (!response.ok) {
    setAlerts([data.detail || "Impossible de charger le preset."]);
    return;
  }
  applyPresetTransforms(data.transforms || []);
  setAlerts(["Preset charge."]);
});

deletePresetBtn.addEventListener("click", async () => {
  const name = presetSelect.value;
  if (!name) {
    return;
  }
  const response = await fetch(`/api/presets/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  const data = await response.json();
  if (!response.ok) {
    setAlerts([data.detail || "Impossible de supprimer le preset."]);
    return;
  }
  await refreshPresets();
  setAlerts(["Preset supprime."]);
});

renderTransforms();
refreshPresets().catch(() => {});
