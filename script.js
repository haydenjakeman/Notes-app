const DB_NAME = "notes_super_app";
const DB_VERSION = 1;
const STORE = "notes";

let db;
let currentId = null;
let filter = "all";

let mediaRecorder = null;
let audioChunks = [];
let recordingStarted = 0;
let recordingTimer = null;

const $ = id => document.getElementById(id);

const els = {
  grid: $("notesGrid"),
  empty: $("empty"),
  emptyTitle: $("emptyTitle"),
  emptyText: $("emptyText"),
  modal: $("editorModal"),
  title: $("titleInput"),
  body: $("bodyInput"),
  attachments: $("attachments"),
  save: $("saveState"),
  search: $("search"),
  pageTitle: $("pageTitle"),
  noteCount: $("noteCount"),
  allCount: $("allCount"),
  favCount: $("favCount"),
  archiveCount: $("archiveCount"),
  favorite: $("favoriteBtn"),
  archive: $("archiveBtn"),
  recording: $("recordingPanel"),
  recordTime: $("recordingTime"),
  toast: $("toast")
};

/* ---------------- DATABASE ---------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, {
          keyPath: "id"
        });

        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = event => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function transaction(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function getAll() {
  return new Promise((resolve, reject) => {
    const request = transaction().getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getNote(id) {
  return new Promise((resolve, reject) => {
    const request = transaction().get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putNote(note) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").put(note);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteNote(id) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/* ---------------- HELPERS ---------------- */

function uid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return Date.now() + "-" + Math.random();
}

function now() {
  return new Date().toISOString();
}

function escapeHTML(text = "") {
  return text.replace(/[&<>"']/g, character => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character];
  });
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2000);
}

function updateSave(text) {
  els.save.textContent = text;
}

/* ---------------- NOTES ---------------- */

function blankNote() {
  return {
    id: uid(),
    title: "",
    body: "",
    favorite: false,
    archived: false,
    attachments: [],
    audio: [],
    createdAt: now(),
    updatedAt: now()
  };
}

async function createNote() {
  const note = blankNote();

  await putNote(note);

  await edit(note.id);
}

async function edit(id) {
  const note = await getNote(id);

  if (!note) return;

  currentId = id;

  els.title.value = note.title || "";
  els.body.value = note.body || "";

  els.favorite.textContent = note.favorite ? "★" : "☆";
  els.archive.textContent = note.archived ? "↩" : "▣";

  renderAttachments(note);

  els.modal.classList.remove("hidden");

  els.title.focus();

  updateSave("Saved");
}

function closeEditor() {
  stopRecording(false);

  els.modal.classList.add("hidden");

  currentId = null;
}

let saveTimer;

function scheduleSave() {
  updateSave("Saving…");

  clearTimeout(saveTimer);

  saveTimer = setTimeout(saveCurrent, 350);
}

async function saveCurrent() {
  if (!currentId) return;

  const note = await getNote(currentId);

  if (!note) return;

  note.title = els.title.value;
  note.body = els.body.value;
  note.updatedAt = now();

  await putNote(note);

  updateSave("Saved");

  render();
}

async function updateCurrent(callback) {
  const note = await getNote(currentId);

  if (!note) return;

  callback(note);

  note.updatedAt = now();

  await putNote(note);

  await edit(currentId);

  await render();
}

/* ---------------- RENDER NOTES ---------------- */

function visibleNotes(allNotes) {
  let notes = allNotes;

  if (filter === "favorites") {
    notes = notes.filter(note => note.favorite);
  }

  if (filter === "archived") {
    notes = notes.filter(note => note.archived);
  }

  if (filter === "all") {
    notes = notes.filter(note => !note.archived);
  }

  const search = els.search.value.trim().toLowerCase();

  if (search) {
    notes = notes.filter(note => {
      const mainText =
        (note.title || "") +
        " " +
        (note.body || "");

      const attachments = (note.attachments || [])
        .map(file => file.name)
        .join(" ");

      return (
        mainText.toLowerCase().includes(search) ||
        attachments.toLowerCase().includes(search)
      );
    });
  }

  return notes.sort(
    (a, b) =>
      new Date(b.updatedAt) -
      new Date(a.updatedAt)
  );
}

async function render() {
  const allNotes = await getAll();

  els.allCount.textContent =
    allNotes.filter(note => !note.archived).length;

  els.favCount.textContent =
    allNotes.filter(note =>
      note.favorite && !note.archived
    ).length;

  els.archiveCount.textContent =
    allNotes.filter(note => note.archived).length;

  els.pageTitle.textContent =
    filter === "favorites"
      ? "Favorites"
      : filter === "archived"
      ? "Archived"
      : "All Notes";

  const notes = visibleNotes(allNotes);

  els.noteCount.textContent =
    `${notes.length} note${notes.length === 1 ? "" : "s"}`;

  els.grid.innerHTML = notes.map(note => {
    const preview =
      note.body?.trim() ||
      (
        note.attachments?.length
          ? "📎 Attachment"
          : note.audio?.length
          ? "🎙 Voice note"
          : "Empty note"
      );

    const voice =
      note.audio?.length
        ? `<span class="voice-chip">
            🎙 ${note.audio.length}
            voice note${note.audio.length > 1 ? "s" : ""}
           </span>`
        : "";

    return `
      <article class="note-card" data-id="${note.id}">
        <h3>${escapeHTML(note.title || "Untitled note")}</h3>

        <div class="note-preview">
          ${escapeHTML(preview)}
        </div>

        <div class="card-bottom">
          <span>${formatDate(note.updatedAt)}</span>
          ${voice}
          <span class="star">
            ${note.favorite ? "★" : ""}
          </span>
        </div>
      </article>
    `;
  }).join("");

  els.grid
    .querySelectorAll(".note-card")
    .forEach(card => {
      card.onclick = () => edit(card.dataset.id);
    });

  els.empty.classList.toggle(
    "show",
    notes.length === 0
  );

  if (els.search.value) {
    els.emptyTitle.textContent = "No matching notes";
    els.emptyText.textContent =
      "Try another search.";
  } else if (filter === "favorites") {
    els.emptyTitle.textContent =
      "No favorite notes";
    els.emptyText.textContent =
      "Favorite a note to see it here.";
  } else if (filter === "archived") {
    els.emptyTitle.textContent =
      "No archived notes";
    els.emptyText.textContent =
      "Archived notes will appear here.";
  } else {
    els.emptyTitle.textContent =
      "No notes yet";
    els.emptyText.textContent =
      "Create your first note and everything will be saved automatically.";
  }
}

/* ---------------- ATTACHMENTS ---------------- */

function renderAttachments(note) {
  let html = "";

  (note.attachments || []).forEach((attachment, index) => {
    const image =
      attachment.type.startsWith("image/")
        ? `<img src="${attachment.data}" alt="">`
        : "📎";

    html += `
      <div class="attachment">
        ${image}

        <span>
          ${escapeHTML(attachment.name)}
        </span>

        <button data-remove="${index}">
          ✕
        </button>
      </div>
    `;
  });

  (note.audio || []).forEach((audio, index) => {
    html += `
      <div class="attachment">

        <span>
          🎙 ${escapeHTML(
            audio.name || "Voice note"
          )}
        </span>

        <audio
          controls
          src="${audio.data}">
        </audio>

        <button data-audio-remove="${index}">
          ✕
        </button>

      </div>
    `;
  });

  els.attachments.innerHTML = html;

  els.attachments
    .querySelectorAll("[data-remove]")
    .forEach(button => {
      button.onclick = () =>
        removeAttachment(
          Number(button.dataset.remove)
        );
    });

  els.attachments
    .querySelectorAll("[data-audio-remove]")
    .forEach(button => {
      button.onclick = () =>
        removeAudio(
          Number(button.dataset.audioRemove)
        );
    });
}

async function removeAttachment(index) {
  await updateCurrent(note => {
    note.attachments.splice(index, 1);
  });
}

async function removeAudio(index) {
  await updateCurrent(note => {
    note.audio.splice(index, 1);
  });
}

/* ---------------- TEXT TOOLS ---------------- */

function insertAtCursor(text) {
  const start = els.body.selectionStart;
  const end = els.body.selectionEnd;

  const value = els.body.value;

  els.body.value =
    value.slice(0, start) +
    text +
    value.slice(end);

  els.body.selectionStart =
    els.body.selectionEnd =
      start + text.length;

  scheduleSave();

  els.body.focus();
}

function insertWrap(before, after) {
  const start = els.body.selectionStart;
  const end = els.body.selectionEnd;

  const value = els.body.value;

  const selected =
    value.slice(start, end);

  els.body.value =
    value.slice(0, start) +
    before +
    selected +
    after +
    value.slice(end);

  els.body.selectionStart =
    start + before.length;

  els.body.selectionEnd =
    start +
    before.length +
    selected.length;

  scheduleSave();

  els.body.focus();
}

/* ---------------- VOICE RECORDING ---------------- */

async function startRecording() {

  if (!navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia) {

    toast(
      "Voice recording isn't supported here"
    );

    return;
  }

  if (!currentId) {
    toast("Open a note first");
    return;
  }

  try {

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: true
      });

    audioChunks = [];

    let recorderOptions = {};

    /*
      Some browsers support different recording
      formats, so choose one that works.
    */

    if (
      MediaRecorder.isTypeSupported &&
      MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus"
      )
    ) {
      recorderOptions.mimeType =
        "audio/webm;codecs=opus";
    }

    mediaRecorder =
      new MediaRecorder(
        stream,
        recorderOptions
      );

    const recorder = mediaRecorder;

    recordingStarted = Date.now();

    recorder.ondataavailable = event => {

      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }

    };

    /*
      IMPORTANT:
      Save the MIME type before stopping.
      This prevents the old bug where mediaRecorder
      was set to null before onstop finished.
    */

    const recorderMimeType =
      recorder.mimeType || "audio/webm";

    recorder.onstop = async () => {

      try {

        if (audioChunks.length === 0) {

          toast("No audio was recorded");

          return;
        }

        const blob =
          new Blob(
            audioChunks,
            {
              type: recorderMimeType
            }
          );

        const data =
          await fileToDataURL(blob);

        const note =
          await getNote(currentId);

        if (!note) {
          toast("Couldn't find the note");
          return;
        }

        if (!note.audio) {
          note.audio = [];
        }

        note.audio.push({
          id: uid(),

          name:
            "Voice note • " +
            new Date().toLocaleString(),

          type:
            blob.type || "audio/webm",

          data: data
        });

        note.updatedAt = now();

        /*
          This is the important part:
          the audio is actually written into
          IndexedDB before anything is cleared.
        */

        await putNote(note);

        /*
          Refresh the audio list immediately.
        */

        renderAttachments(note);

        updateSave("Saved");

        await render();

        toast("Voice note saved 🎙️");

      } catch (error) {

        console.error(
          "VOICE SAVE ERROR:",
          error
        );

        toast(
          "Couldn't save the voice note"
        );

      } finally {

        stream
          .getTracks()
          .forEach(track =>
            track.stop()
          );

        audioChunks = [];
      }
    };

    recorder.onerror = event => {

      console.error(
        "VOICE RECORDER ERROR:",
        event
      );

      toast(
        "Recording error"
      );
    };

    recorder.start();

    els.recording.classList.remove(
      "hidden"
    );

    updateRecordingTime();

    clearInterval(recordingTimer);

    recordingTimer =
      setInterval(
        updateRecordingTime,
        500
      );

    toast("Recording…");

  } catch (error) {

    console.error(
      "MICROPHONE ERROR:",
      error
    );

    toast(
      "Microphone permission was blocked"
    );
  }
}

function updateRecordingTime() {

  const seconds =
    Math.floor(
      (Date.now() - recordingStarted) /
      1000
    );

  const minutes =
    String(
      Math.floor(seconds / 60)
    ).padStart(2, "0");

  const remainingSeconds =
    String(
      seconds % 60
    ).padStart(2, "0");

  els.recordTime.textContent =
    `${minutes}:${remainingSeconds}`;
}

function stopRecording(save = true) {

  if (!mediaRecorder) {
    return;
  }

  const recorder =
    mediaRecorder;

  /*
    DO NOT clear audioChunks here.
    The onstop handler still needs them.
  */

  if (
    recorder.state !== "inactive"
  ) {
    recorder.stop();
  }

  mediaRecorder = null;

  els.recording.classList.add(
    "hidden"
  );

  clearInterval(
    recordingTimer
  );

  recordingTimer = null;

  els.recordTime.textContent =
    "00:00";
}

/* ---------------- FILE UPLOAD ---------------- */

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {

    const reader =
      new FileReader();

    reader.onload =
      () => resolve(reader.result);

    reader.onerror =
      reject;

    reader.readAsDataURL(file);
  });
}

$("fileInput").onchange = async event => {

  if (!currentId) return;

  const files =
    [...event.target.files];

  for (const file of files) {

    if (
      file.size >
      30 * 1024 * 1024
    ) {

      toast(
        "File too large (30MB max)"
      );

      continue;
    }

    const data =
      await fileToDataURL(file);

    await updateCurrent(note => {

      if (!note.attachments) {
        note.attachments = [];
      }

      note.attachments.push({
        id: uid(),
        name: file.name,
        type: file.type,
        data: data
      });

    });
  }

  event.target.value = "";
};

/* ---------------- BUTTONS ---------------- */

$("newNote").onclick =
  createNote;

$("newNoteTop").onclick =
  createNote;

$("emptyButton").onclick =
  createNote;

$("closeEditor").onclick =
  closeEditor;

$("search").oninput =
  render;

els.title.oninput =
  scheduleSave;

els.body.oninput =
  scheduleSave;

$("favoriteBtn").onclick =
  () =>
    updateCurrent(
      note =>
        note.favorite =
          !note.favorite
    );

$("archiveBtn").onclick =
  () =>
    updateCurrent(
      note =>
        note.archived =
          !note.archived
    );

$("deleteBtn").onclick =
  async () => {

    if (!currentId) return;

    if (
      confirm(
        "Delete this note permanently?"
      )
    ) {

      await deleteNote(
        currentId
      );

      closeEditor();

      await render();

      toast(
        "Note deleted"
      );
    }
  };

/* ---------------- EDITING TOOLS ---------------- */

$("boldBtn").onclick =
  () =>
    insertWrap(
      "**",
      "**"
    );

$("italicBtn").onclick =
  () =>
    insertWrap(
      "*",
      "*"
    );

$("checkBtn").onclick =
  () =>
    insertAtCursor(
      "☐ "
    );

$("dateBtn").onclick =
  () =>
    insertAtCursor(
      new Date().toLocaleString()
    );

$("colorBtn").onclick =
  () =>
    insertAtCursor(
      "==highlight== "
    );

/* ---------------- VOICE BUTTON ---------------- */

$("voiceBtn").onclick =
  startRecording;

$("stopRecording").onclick =
  () =>
    stopRecording(true);

/* ---------------- NAVIGATION ---------------- */

document
  .querySelectorAll(".nav-item")
  .forEach(button => {

    button.onclick = () => {

      filter =
        button.dataset.filter;

      document
        .querySelectorAll(
          ".nav-item"
        )
        .forEach(item =>
          item.classList.remove(
            "active"
          )
        );

      button.classList.add(
        "active"
      );

      render();

      if (
        window.innerWidth < 701
      ) {
        $("sidebar")
          .classList.remove(
            "open"
          );
      }
    };
  });

/* ---------------- THEME ---------------- */

$("darkToggle").onclick = () => {

  document.body.classList.toggle(
    "light"
  );

  localStorage.setItem(
    "notes-theme",
    document.body.classList.contains(
      "light"
    )
      ? "light"
      : "dark"
  );
};

/* ---------------- MOBILE MENU ---------------- */

$("menuBtn").onclick = () => {

  $("sidebar")
    .classList.toggle(
      "open"
    );
};

/* ---------------- KEYBOARD ---------------- */

document.addEventListener(
  "keydown",
  event => {

    if (
      (event.ctrlKey ||
        event.metaKey) &&
      event.key.toLowerCase() === "n"
    ) {

      event.preventDefault();

      createNote();
    }

    if (
      event.key === "Escape" &&
      !els.modal.classList.contains(
        "hidden"
      )
    ) {

      closeEditor();
    }
  }
);

/* ---------------- CLOSE / SAVE ---------------- */

window.addEventListener(
  "beforeunload",
  () => {
    saveCurrent();
  }
);

/* ---------------- START APP ---------------- */

(async () => {

  try {

    await openDB();

    if (
      localStorage.getItem(
        "notes-theme"
      ) === "light"
    ) {

      document.body.classList.add(
        "light"
      );
    }

    const notes =
      await getAll();

    if (notes.length === 0) {

      const welcome =
        blankNote();

      welcome.title =
        "Welcome to Notes";

      welcome.body =
        "Your notes are saved automatically on this device.\n\n" +
        "You can write, record voice notes, attach files and images, favorite notes, archive them, and search everything.";

      await putNote(
        welcome
      );
    }

    await render();

  } catch (error) {

    console.error(
      error
    
