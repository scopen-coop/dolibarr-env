"use strict";

var instances = [];
function routeFromPath() {
  var path = window.location.pathname;
  var instance = path.match(/^\/instances\/([A-Za-z0-9][A-Za-z0-9_-]{0,47})\/?$/);
  if (instance) return { page: "instance", name: instance[1] };
  if (path === "/instances") return { page: "instances" };
  if (path === "/cores") return { page: "cores" };
  return { page: "overview" };
}
var route = routeFromPath();
var selectedName = route.name || "";
var currentAction = "";
var toastTimer = null;
var actionDefinitions = {
  start: { title: "Démarrer l’instance", button: "Démarrer", copy: "Le gestionnaire va démarrer les services Docker de cette instance.", typed: false },
  stop: { title: "Arrêter l’instance", button: "Arrêter", copy: "Les services Docker seront arrêtés. Les fichiers et la base de données restent en place.", typed: false },
  restart: { title: "Redémarrer l’instance", button: "Redémarrer", copy: "Les services Docker vont être redémarrés. Les connexions en cours peuvent être interrompues.", typed: false },
  build: { title: "Reconstruire l’image PHP", button: "Reconstruire", copy: "L’image PHP de cette instance va être reconstruite.", typed: false },
  sanitize: { title: "Nettoyer la base de données", button: "Nettoyer", copy: "Le script de nettoyage va être appliqué à la base de données. Cette opération peut modifier des données.", typed: true },
  restore: { title: "Restaurer une sauvegarde", button: "Restaurer", copy: "La base actuelle sera remplacée par la sauvegarde choisie. Cette opération ne peut pas être annulée.", typed: true, backup: true }
};

function byId(id) { return document.getElementById(id); }

function configurePage() {
  var pages = {
    overview: ["Vue d’ensemble", "Parc Dolibarr", "Suivez et gérez vos instances depuis un seul endroit."],
    instances: ["Instances", "Instances Dolibarr", "Consultez et gérez les instances de tous vos clients."],
    instance: [route.name, route.name, "Détails, actions et logs de cette instance."],
    cores: ["Cores et sources", "Cores et sources Dolibarr", "Gérez les versions des cores et dolibarr-source."]
  }[route.page];
  document.querySelectorAll("[data-page]").forEach(function (page) { page.hidden = page.dataset.page !== route.page; });
  document.querySelectorAll("[data-nav]").forEach(function (link) {
    var active = link.dataset.nav === (route.page === "instance" ? "instances" : route.page);
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  byId("breadcrumbCurrent").textContent = pages[0];
  byId("pageTitle").textContent = pages[1];
  byId("pageSubtitle").textContent = pages[2];
  byId("createButton").hidden = route.page !== "overview" && route.page !== "instances";
}

async function request(path, options) {
  var response = await fetch(path, options || { cache: "no-store" });
  var data = {};
  try { data = await response.json(); } catch (_error) { data = {}; }
  if (!response.ok) throw new Error(data.error || data.output || data.errorMessage || "La requête a échoué.");
  return data;
}

function makeStatus(status) {
  var labels = { running: "En service", stopped: "Arrêtée", partial: "Partielle", error: "Erreur" };
  var badge = document.createElement("span");
  badge.className = "status-badge status-" + (labels[status] ? status : "error");
  badge.textContent = labels[status] || "Inconnue";
  return badge;
}

function makeAvatar(name) {
  var avatar = document.createElement("span");
  avatar.className = "instance-avatar";
  avatar.textContent = name.slice(0, 1);
  avatar.setAttribute("aria-hidden", "true");
  return avatar;
}

function iconButton(label, path, action, className) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "small-action" + (className ? " " + className : "");
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  var pathNode = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathNode.setAttribute("d", path);
  svg.appendChild(pathNode);
  button.appendChild(svg);
  var text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
  button.addEventListener("click", function () { openAction(action); });
  return button;
}

function filteredInstances() {
  var query = byId("searchInput").value.trim().toLocaleLowerCase("fr");
  return instances.filter(function (item) {
    var matches = !query || [item.name, item.version, item.url].join(" ").toLocaleLowerCase("fr").includes(query);
    return matches;
  });
}

function renderTable() {
  var tbody = byId("instanceRows");
  var visible = filteredInstances();
  tbody.replaceChildren();
  byId("navCount").textContent = String(instances.length);
  byId("resultCount").textContent = visible.length + (visible.length > 1 ? " instances affichées" : " instance affichée");
  if (!visible.length) {
    var emptyRow = document.createElement("tr");
    var emptyCell = document.createElement("td");
    emptyCell.className = "table-message";
    emptyCell.colSpan = 4;
    emptyCell.textContent = instances.length ? "Aucune instance ne correspond à la recherche." : "Aucune instance enregistrée.";
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    return;
  }
  visible.forEach(function (item) {
    var row = document.createElement("tr");
    if (item.name === selectedName) row.classList.add("selected-row");
    var nameCell = document.createElement("td");
    var select = document.createElement("button");
    select.type = "button";
    select.className = "instance-select";
    select.setAttribute("aria-label", "Afficher " + item.name);
    select.appendChild(makeAvatar(item.name));
    var nameWrap = document.createElement("span");
    var name = document.createElement("span");
    name.className = "instance-name";
    name.textContent = item.name;
    var caption = document.createElement("span");
    caption.className = "instance-caption";
    caption.textContent = item.phpImage || "Image PHP inconnue";
    nameWrap.append(name, caption);
    select.appendChild(nameWrap);
    select.addEventListener("click", function () { selectInstance(item.name); });
    nameCell.appendChild(select);

    var versionCell = document.createElement("td");
    versionCell.className = "version-cell";
    versionCell.textContent = item.version || "—";
    var urlCell = document.createElement("td");
    if (item.url) {
      var link = document.createElement("a");
      link.className = "url-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      link.title = item.url;
      urlCell.appendChild(link);
    } else {
      var noUrl = document.createElement("span");
      noUrl.className = "url-empty";
      noUrl.textContent = "Non définie";
      urlCell.appendChild(noUrl);
    }
    var statusCell = document.createElement("td");
    var badge = makeStatus(item.status);
    if (item.statusDetail) badge.title = item.statusDetail;
    statusCell.appendChild(badge);
    row.append(nameCell, versionCell, urlCell, statusCell);
    tbody.appendChild(row);
  });
}

function renderStats() {
  var running = instances.filter(function (item) { return item.status === "running"; }).length;
  var attention = instances.length - running;
  byId("totalCount").textContent = String(instances.length);
  byId("runningCount").textContent = String(running);
  byId("attentionCount").textContent = String(attention);
}

function selectedInstance() {
  return instances.find(function (item) { return item.name === selectedName; }) || null;
}

function renderDetail() {
  var panel = byId("detailPanel");
  var item = selectedInstance();
  panel.replaceChildren();
  if (!item) {
    var empty = document.createElement("div");
    empty.className = "detail-empty";
    var orbit = document.createElement("div");
    orbit.className = "empty-orbit";
    var mark = document.createElement("span");
    orbit.appendChild(mark);
    var title = document.createElement("strong");
    title.textContent = "Instance introuvable";
    var copy = document.createElement("p");
    copy.textContent = "Cette instance n’existe pas ou n’est plus disponible.";
    empty.append(orbit, title, copy);
    panel.appendChild(empty);
    return;
  }

  var content = document.createElement("div");
  content.className = "detail-content";
  var top = document.createElement("div");
  top.className = "detail-top";
  var titleWrap = document.createElement("div");
  titleWrap.className = "detail-title";
  titleWrap.appendChild(makeAvatar(item.name));
  var identity = document.createElement("div");
  var heading = document.createElement("h2");
  heading.textContent = item.name;
  var subtitle = document.createElement("p");
  subtitle.textContent = "Instance client";
  identity.append(heading, subtitle);
  titleWrap.appendChild(identity);
  top.append(titleWrap, makeStatus(item.status));
  content.appendChild(top);
  if (item.statusDetail) {
    var warning = document.createElement("p");
    warning.className = "detail-warning";
    warning.textContent = item.statusDetail;
    content.appendChild(warning);
  }

  var urlCard = document.createElement("div");
  urlCard.className = "detail-url";
  var urlText = document.createElement("div");
  var urlLabel = document.createElement("span");
  urlLabel.className = "detail-url-label";
  urlLabel.textContent = "ADRESSE WEB";
  urlText.appendChild(urlLabel);
  if (item.url) {
    var urlLink = document.createElement("a");
    urlLink.href = item.url;
    urlLink.target = "_blank";
    urlLink.rel = "noopener noreferrer";
    urlLink.textContent = item.url;
    urlLink.title = item.url;
    urlText.appendChild(urlLink);
  } else {
    var noUrl = document.createElement("span");
    noUrl.className = "url-empty";
    noUrl.textContent = "Non définie";
    urlText.appendChild(noUrl);
  }
  var ext = document.createElement("span");
  ext.className = "external-mark";
  ext.textContent = "↗";
  ext.setAttribute("aria-hidden", "true");
  urlCard.append(urlText, ext);
  content.appendChild(urlCard);

  var meta = document.createElement("div");
  meta.className = "detail-meta";
  [["DOLIBARR", item.version || "—"], ["IMAGE PHP", item.phpImage || "—"]].forEach(function (entry) {
    var block = document.createElement("div");
    var label = document.createElement("span");
    label.className = "meta-label";
    label.textContent = entry[0];
    var value = document.createElement("span");
    value.className = "meta-value";
    value.textContent = entry[1];
    value.title = entry[1];
    block.append(label, value);
    meta.appendChild(block);
  });
  content.appendChild(meta);
  content.appendChild(document.createElement("div")).className = "detail-rule";
  var actionLabel = document.createElement("p");
  actionLabel.className = "action-label";
  actionLabel.textContent = "ACTIONS RAPIDES";
  content.appendChild(actionLabel);

  var primaryActions = document.createElement("div");
  primaryActions.className = "action-grid";
  var start = iconButton("Démarrer", "M8 5v14l11-7z", "start");
  var stop = iconButton("Arrêter", "M6 6h12v12H6z", "stop", "danger-text");
  var restart = iconButton("Redémarrer", "M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2", "restart");
  start.disabled = item.status === "running";
  stop.disabled = item.status === "stopped";
  restart.disabled = item.status === "stopped";
  primaryActions.append(start, stop, restart);
  content.appendChild(primaryActions);

  var secondary = document.createElement("div");
  secondary.className = "secondary-actions";
  secondary.append(
    iconButton("Reconstruire", "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "build"),
    iconButton("Nettoyer la base", "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3", "sanitize", "danger-text"),
    iconButton("Restaurer", "M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2", "restore")
  );
  content.appendChild(secondary);
  panel.appendChild(content);
}

function notify(message, isError) {
  var toast = byId("toast");
  toast.textContent = message;
  toast.classList.toggle("error", Boolean(isError));
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { toast.classList.remove("visible"); }, 4200);
}

async function loadLogs() {
  var item = selectedInstance();
  var button = byId("logsRefresh");
  if (!item) return;
  button.disabled = true;
  button.textContent = "Chargement…";
  byId("logOutput").textContent = "Lecture des logs…";
  try {
    var data = await request("/api/instances/" + encodeURIComponent(item.name) + "/logs");
    byId("logOutput").textContent = data.logs || data.error || "Aucun log disponible pour cette instance.";
    byId("logOutput").scrollTop = byId("logOutput").scrollHeight;
  } catch (error) {
    byId("logOutput").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Actualiser";
  }
}

async function loadBackups(clientName) {
  var name = clientName || selectedName;
  if (!name) return [];
  var data = await request("/api/instances/" + encodeURIComponent(name) + "/backups");
  return data.backups || [];
}

function setBackupOptions(backups, selectedName) {
  var select = byId("backupSelect");
  select.replaceChildren();
  if (!backups.length) {
    select.add(new Option("Aucune sauvegarde .sql trouvée dans clients/…/db", ""));
    return false;
  }
  backups.forEach(function (backup) {
    var size = backup.size < 1024 * 1024 ? Math.round(backup.size / 1024) + " Ko" : (backup.size / (1024 * 1024)).toFixed(1) + " Mo";
    select.add(new Option(backup.name + " · " + size, backup.name));
  });
  select.value = selectedName || backups[0].name;
  return true;
}

async function refreshInstances(showError) {
  try {
    var data = await request("/api/instances");
    instances = data.instances || [];
    selectedName = route.page === "instance" ? route.name : "";
    renderStats();
    renderTable();
    renderDetail();
    if (route.page === "instance" && selectedInstance()) await loadLogs();
    else if (route.page === "instance") byId("logOutput").textContent = "Cette instance est introuvable.";
  } catch (error) {
    if (showError) notify(error.message, true);
    byId("instanceRows").replaceChildren();
    var row = document.createElement("tr");
    var cell = document.createElement("td");
    cell.className = "table-message";
    cell.colSpan = 4;
    cell.textContent = "Impossible de charger les instances. Vérifiez le gestionnaire Docker.";
    row.appendChild(cell);
    byId("instanceRows").appendChild(row);
    byId("resultCount").textContent = "Données indisponibles";
  }
}

function selectInstance(name) {
  window.location.assign("/instances/" + encodeURIComponent(name));
}

function openAction(action) {
  var item = selectedInstance();
  if (!item || !actionDefinitions[action]) return;
  currentAction = action;
  var definition = actionDefinitions[action];
  byId("actionTitle").textContent = definition.title;
  byId("actionCopy").textContent = definition.copy + " Instance : " + item.name + ".";
  byId("actionSubmit").textContent = definition.button;
  byId("actionSubmit").disabled = false;
  byId("confirmationField").hidden = !definition.typed;
  byId("confirmationInput").value = "";
  byId("confirmationInput").required = definition.typed;
  byId("confirmationInput").placeholder = item.name;
  byId("backupField").hidden = !definition.backup;
  byId("uploadBackupField").hidden = !definition.backup;
  byId("uploadBackupButton").hidden = !definition.backup;
  byId("uploadBackupButton").disabled = true;
  byId("backupFile").value = "";
  byId("backupSelect").replaceChildren();
  byId("backupSelect").required = Boolean(definition.backup);
  if (definition.backup) {
    byId("backupSelect").add(new Option("Chargement des sauvegardes…", ""));
    byId("actionSubmit").disabled = true;
    loadBackups(item.name).then(function (backups) {
      if (selectedName !== item.name || currentAction !== action) return;
      byId("actionSubmit").disabled = !setBackupOptions(backups);
    }).catch(function (error) {
      byId("backupSelect").replaceChildren(new Option(error.message, ""));
    });
  }
  byId("actionDialog").showModal();
  if (definition.typed) byId("confirmationInput").focus();
}

byId("actionForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  var item = selectedInstance();
  if (!item) return;
  var definition = actionDefinitions[currentAction];
  if (definition.typed && byId("confirmationInput").value !== item.name) {
    notify("Le nom saisi ne correspond pas à l’instance.", true);
    return;
  }
  var payload = { client: item.name, action: currentAction };
  payload.confirmation = definition.typed ? byId("confirmationInput").value : item.name;
  if (definition.backup) payload.backup = byId("backupSelect").value;
  byId("actionSubmit").disabled = true;
  byId("actionSubmit").textContent = "Opération en cours…";
  try {
    var result = await request("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    byId("actionDialog").close();
    notify(definition.button + " · " + item.name + (result.output ? " — " + result.output.slice(-220) : " terminé."));
    await refreshInstances(false);
  } catch (error) {
    byId("actionSubmit").disabled = false;
    byId("actionSubmit").textContent = definition.button;
    notify(error.message, true);
  }
});

byId("backupFile").addEventListener("change", function () {
  byId("uploadBackupButton").disabled = !byId("backupFile").files.length;
});

byId("uploadBackupButton").addEventListener("click", async function () {
  var item = selectedInstance();
  var file = byId("backupFile").files[0];
  if (!item || !file || currentAction !== "restore") return;
  var button = byId("uploadBackupButton");
  button.disabled = true;
  button.textContent = "Téléversement…";
  try {
    await request("/api/instances/" + encodeURIComponent(item.name) + "/backups?filename=" + encodeURIComponent(file.name), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    });
    byId("backupFile").value = "";
    if (selectedName === item.name && currentAction === "restore") {
      byId("actionSubmit").disabled = !setBackupOptions(await loadBackups(item.name), file.name);
    }
    notify("Dump importé dans les sauvegardes de " + item.name + ".");
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.textContent = "Importer le dump";
    button.disabled = !byId("backupFile").files.length;
  }
});

byId("createButton").addEventListener("click", async function () {
  try {
    var catalog = await request("/api/catalog");
    byId("newVersion").replaceChildren();
    (catalog.versions || []).forEach(function (version) { byId("newVersion").add(new Option("Dolibarr " + version, version)); });
    byId("newPhpImage").replaceChildren();
    (catalog.phpImages || []).forEach(function (image) { byId("newPhpImage").add(new Option(image, image)); });
    byId("createDialog").showModal();
    byId("newName").focus();
  } catch (error) { notify(error.message, true); }
});

async function refreshCoreList() {
  byId("coreOutput").textContent = "";
  try {
    var catalog = await request("/api/catalog");
    var versions = catalog.versions || [];
    byId("coreInstalled").textContent = versions.length ? "Versions installées : Dolibarr " + versions.join(", ") : "Aucun core Dolibarr installé.";
  } catch (error) {
    byId("coreInstalled").textContent = error.message;
  }
}

async function updateGitTarget(path, buttonId, workingText, progressText, successText) {
  var button = byId(buttonId);
  var idleText = button.textContent;
  button.disabled = true;
  button.textContent = workingText;
  byId("coreOutput").textContent = progressText;
  try {
    var result = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    byId("coreOutput").textContent = result.output || successText;
    notify(successText);
  } catch (error) {
    byId("coreOutput").textContent = error.message;
    notify(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = idleText;
  }
}

byId("updateCoresButton").addEventListener("click", function () {
  updateGitTarget("/api/cores/update", "updateCoresButton", "Mise à jour…", "Récupération des mises à jour Git des cores…", "Mise à jour des cores terminée.");
});

byId("updateSourceButton").addEventListener("click", function () {
  updateGitTarget("/api/source/update", "updateSourceButton", "Mise à jour…", "Récupération de dolibarr-source depuis Git…", "Mise à jour de dolibarr-source terminée.");
});

byId("addCoreForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  var button = byId("addCoreButton");
  button.disabled = true;
  button.textContent = "Ajout en cours…";
  byId("coreOutput").textContent = "Récupération de la branche officielle…";
  try {
    var result = await request("/api/cores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: byId("coreVersion").value }) });
    byId("coreOutput").textContent = result.output || "Core ajouté.";
    byId("coreVersion").value = "";
    var catalog = await request("/api/catalog");
    byId("coreInstalled").textContent = "Versions installées : Dolibarr " + (catalog.versions || []).join(", ");
    notify("Core Dolibarr ajouté.");
  } catch (error) {
    byId("coreOutput").textContent = error.message;
    notify("L’ajout du core a échoué.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Ajouter le core";
  }
});

byId("createForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  var submit = byId("createSubmit");
  submit.disabled = true;
  submit.textContent = "Création en cours…";
  var payload = { name: byId("newName").value.trim(), version: byId("newVersion").value, phpImage: byId("newPhpImage").value };
  try {
    var result = await request("/api/instances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    byId("createDialog").close();
    notify("Instance créée. " + (result.output || ""));
    await refreshInstances(false);
  } catch (error) { notify(error.message, true); }
  finally { submit.disabled = false; submit.textContent = "Créer l’instance"; }
});

document.querySelectorAll("[data-close]").forEach(function (button) {
  button.addEventListener("click", function () { byId(button.dataset.close).close(); });
});
byId("refreshButton").addEventListener("click", function () {
  refreshInstances(true);
  if (route.page === "cores") refreshCoreList();
});
byId("logsRefresh").addEventListener("click", loadLogs);
byId("searchInput").addEventListener("input", renderTable);
byId("actionDialog").addEventListener("close", function () { currentAction = ""; });
window.setInterval(function () { refreshInstances(false); }, 15000);
configurePage();
refreshInstances(false);
if (route.page === "cores") refreshCoreList();
