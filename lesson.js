/* ==========================================================
      POUCHDB SETUP
========================================================== */
const db = new PouchDB("study_guide");

const key = "apikey-31961a88dab14c3a81794b3e84c37bfd";
const pwd = "0185d38d9d48d337c3766ebc11b237b2c3a71335";
const server = "7c287143-8753-4717-a3a7-f69f6a6499b4-bluemix.cloudant.com";
const dbase = "mathchat";

const dburl = "https://" + key + ":" + pwd + "@" + server + "/" + dbase;

const remoteDB = new PouchDB(dburl);

db.sync(remoteDB, { live: true, retry: true });

function saveDoc(doc) {
  if (!doc._id) doc._id = doc.type + "_" + Date.now();
  return db.put(doc);
}

function loadDocs(type) {
  return db.allDocs({ include_docs: true })
           .then(r => r.rows.map(x => x.doc).filter(d => d.type === type));
}


/* ==========================================================
      LESSON & USER CONTEXT
========================================================== */
const params = new URLSearchParams(window.location.search);
const currentLesson = params.get("lesson");
const effectiveLesson = currentLesson || "default";



/* ==========================================================
      LOAD LESSON METADATA (title + description)
========================================================== */
db.get("lesson:" + effectiveLesson).then(lesson => {
  document.getElementById("lesson-title").textContent = lesson.title || "";
  document.getElementById("lesson-desc").innerHTML =
    marked.parse(lesson.description || "");
  MathJax.typesetPromise([document.getElementById("lesson-desc")]);
}).catch(err => {
  console.warn("Lesson metadata not found:", err);
});

// Load user from localStorage
let currentUser = { username: "guest", role: "student" };
try {
  const savedUser = JSON.parse(localStorage.getItem("mathworksUser") || "null");
  if (savedUser && savedUser.username) {
    currentUser.username = savedUser.username;
    currentUser.role = savedUser.role || "student";
  }
} catch (e) {
  console.error("Unable to load mathworksUser from localStorage:", e);
}

let session = {
  user: currentUser.username,
  lesson: effectiveLesson,
  started: Date.now(),
  completedQuestions: {},
  workspaces: [],       // Array where workspaces[i] = {steps: [...], input: "..."} for question i
  answers: [],          // Array where answers[i] = student's answer for question i
  score: null,
  submitted: false
};

// Session persistence helpers
const recordKey = `recordSession:${effectiveLesson}:${currentUser.username}`;
// If URL param 'record=1' supplied, respect that and persist to localStorage.
const recordParam = params.get('record');
if (recordParam === '1' || recordParam === 'true') {
  session.recorded = true;
  localStorage.setItem(recordKey, 'true');
} else {
  session.recorded = (localStorage.getItem(recordKey) === "true");
}
session.sessionDoc = null;    // will hold the saved session doc when recording
session.viewingSession = null; // when teacher is viewing/joining a student session

/* ==========================================================
      SMALL STARTUP TWEAKS
========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const asciiBox = document.getElementById("asciiBox");
  if (asciiBox) asciiBox.focus();
});

/* ==========================================================
      UNICODE NORMALIZATION (NO IMPLICIT MULTIPLICATION)
========================================================== */
function normalize(expr) {
  return expr
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/\u00D7/g, "*")
    .replace(/\u22C5/g, "*")
    .replace(/\u2062/g, "*")
    .replace(/\u00F7/g, "/")
    .replace(/·/g, "*")
    // Greek letters -> named equivalents (common math vars)
    .replace(/\u03B1/g, "alpha")   // α
    .replace(/\u0391/g, "alpha")   // Α
    .replace(/\u03B2/g, "beta")    // β
    .replace(/\u0392/g, "beta")    // Β
    .replace(/\u03B3/g, "gamma")   // γ
    .replace(/\u0393/g, "gamma")   // Γ
    .replace(/\u03B4/g, "delta")   // δ
    .replace(/\u0394/g, "delta")   // Δ
    .replace(/\u03B8/g, "theta")   // θ
    .replace(/\u0398/g, "theta")   // Θ
    .replace(/\u03BC/g, "mu")      // μ
    .replace(/\u039C/g, "mu")      // Μ
    .replace(/\u03C3/g, "sigma")   // σ
    .replace(/\u03A3/g, "sigma")   // Σ
    .replace(/\u03C6/g, "phi")     // φ
    .replace(/\u03D5/g, "phi")     // ϕ (variant)
    .replace(/\u03A0/g, "pi")      // Π
    .replace(/\u03C0/g, "pi")      // π
    .trim();
}

/* ==========================================================
      NOTES
========================================================== */

function loadNotes() {
  loadDocs("note").then(notes => {

    // Filter by lesson
    notes = notes.filter(n => n.lesson === effectiveLesson);

    const list = document.getElementById("notes-list");
    list.innerHTML = "";

    notes.forEach(note => {

      // Student sees: teacher notes + their own
      if (currentUser.role === "student") {
        const isMine = note.user === currentUser.username;
        const isTeacher = note.role === "teacher";
        if (!isMine && !isTeacher) return;
      }

      const row = document.createElement("div");
      row.className = "note-row w3-padding-small w3-border-bottom w3-hover-light-grey";

      const title = document.createElement("span");
      title.className = "note-title";
      title.style.cursor = "pointer";
      const owner = note.user ? ` (${note.user})` : "";
      title.textContent = (note.title || "") + owner;
      title.onclick = () => renderNote(note);

      const icons = document.createElement("span");
      icons.style.float = "right";

      // Teacher OR owner may edit/delete
      const canEdit = currentUser.role === "teacher" ||
                      note.user === currentUser.username;

      if (canEdit) {
        const edit = document.createElement("span");
        edit.textContent = "🖉";
        edit.title = "Edit";
        edit.style.cursor = "pointer";
        edit.style.marginLeft = "10px";
        edit.onclick = () => {
          document.getElementById("note-editor").open = true;
          document.getElementById("note-title").value = note.title;
          document.getElementById("note-body").value = note.body;
          document.getElementById("save-note-btn").onclick =
            () => saveEditedNote(note);
        };

        const del = document.createElement("span");
        del.textContent = "🗑️";
        del.title = "Delete";
        del.style.cursor = "pointer";
        del.style.marginLeft = "10px";
        del.onclick = () => {
          if (confirm("Delete note?")) db.remove(note).then(loadNotes);
        };

        icons.appendChild(edit);
        icons.appendChild(del);
      }

      row.appendChild(title);
      row.appendChild(icons);
      list.appendChild(row);
    });
  });
}

function saveEditedNote(oldNote) {
  // Extra defense
  if (
    currentUser.role !== "teacher" &&
    oldNote.user !== currentUser.username
  ) {
    alert("You can only edit your own notes.");
    return;
  }

  oldNote.title = document.getElementById("note-title").value.trim();
  oldNote.body  = document.getElementById("note-body").value.trim();

  saveDoc(oldNote).then(() => {
    document.getElementById("save-note-btn").onclick = saveNewNote;
    loadNotes();
  });
}

function renderNote(note) {
  const area = document.getElementById("render-area");

  // 1. Render Markdown first
  area.innerHTML = marked.parse(note.body || "");

  // 2. Convert [[%%expr%%]] → buttons
  convertMathButtons(area);

  // 3. Typeset math (after buttons added)
  MathJax.typesetPromise([area]);
}

function convertMathButtons(container) {
  // Matches [[%%...%%]]
  const pattern = /\[\[%%([\s\S]*?)%%\]\]/g;

  container.innerHTML = container.innerHTML.replace(pattern, (match, expr) => {
    const encoded = expr.replace(/"/g, "&quot;"); // prevent HTML break
    return `
      <button class="math-btn w3-button w3-light-grey w3-round w3-small"
              data-math="${encoded}">
        %%${encoded}%%
      </button>
    `;
  });

  // Attach click handlers
  container.querySelectorAll(".math-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const expr = btn.dataset.math.trim();
      insertAtSelection(expr);
    });
  });
}

function insertAtSelection(expr) {
  const asciiBox = document.getElementById("asciiBox");
  if (!asciiBox) return;

  const start = asciiBox.selectionStart ?? asciiBox.value.length;
  const end   = asciiBox.selectionEnd ?? asciiBox.value.length;
  const text  = asciiBox.value;

  // Replace highlighted text
  asciiBox.value = text.slice(0, start) + expr + text.slice(end);

  // Move cursor to end of inserted text
  const newPos = start + expr.length;
  asciiBox.selectionStart = asciiBox.selectionEnd = newPos;

  asciiBox.focus();
}

function sendToWorkspace(expr) {
  // Currently unused, but kept for possible future use
  const asciiBox = document.getElementById("asciiBox");
  if (!asciiBox) return;
  asciiBox.value = expr;
  asciiBox.selectionStart = asciiBox.selectionEnd = asciiBox.value.length;
  asciiBox.focus();
}

function saveNewNote() {
  const title = document.getElementById("note-title").value.trim();
  const body  = document.getElementById("note-body").value.trim();
  if (!title) return alert("Missing title.");

  saveDoc({
    type: "note",
    lesson: effectiveLesson,
    title,
    body,
    user: currentUser.username,
    role: currentUser.role
  }).then(() => {
    document.getElementById("note-title").value = "";
    document.getElementById("note-body").value = "";
    loadNotes();
  });
}

document.getElementById("save-note-btn").onclick = saveNewNote;
loadNotes();

/* ==========================================================
      WORKSPACE (STEP CHECKER)
========================================================== */
let steps = [];
const workspaceEl = document.getElementById("workspace");

const builtinNames = new Set([
  "sin","cos","tan","sec","csc","cot",
  "asin","acos","atan","sqrt","log","ln","abs",
  "min","max","exp","pi","e"
]);

function extractVars(expr) {
  return [...new Set(
    (expr.match(/[a-zA-Z_]+/g) || [])
      .filter(v => !builtinNames.has(v))
  )];
}

// Convert array-like objects into arrays for easier handling.
// Accepts Arrays (returns as-is), numeric-keyed objects ({0:..,1:..}) or general
// objects of workspace entries and returns an array of the values in numeric order
// when possible or a best-effort Object.values fallback.
function normalizeArrayLike(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (typeof obj === 'object') {
    const numericKeys = Object.keys(obj).filter(k => /^\d+$/.test(k));
    if (numericKeys.length > 0) {
      numericKeys.sort((a,b) => Number(a) - Number(b));
      return numericKeys.map(k => obj[k]);
    }
    return Object.values(obj);
  }
  return [];
}

/* ==========================================================
      PREPROCESSOR — trig^n x → (trig(x))^n
========================================================== */

function preprocess(expr) {
  expr = normalize(expr);

  // Case 1: cos^2(x)  → (cos(x))^2
  expr = expr.replace(
    /\b(sin|cos|tan|sec|csc|cot)\s*\^\s*([0-9]+)\s*\(\s*([^)]+)\s*\)/g,
    (m, fn, power, inside) => `(${fn}(${inside}))^${power}`
  );

  // Case 2: cos^2x → (cos(x))^2  BUT only if x is a single variable/greek letter
  expr = expr.replace(
    /\b(sin|cos|tan|sec|csc|cot)\s*\^\s*([0-9]+)\s*([A-Za-zθφπ])/g,
    (m, fn, power, variable) => `(${fn}(${variable}))^${power}`
  );

  return expr;
}

/* ==========================================================
      SCOPE HANDLING FOR EQUATION CHECKING
========================================================== */
let currentScope = {};

function setScope(expr) {
  // Remove the "scope:" prefix and trim
  // Normalize the scope string so Greek letters become named vars
  const list = normalize(expr.slice(6).trim());  // assumes expr starts with "scope:"

  // Split ONLY on commas: support "θ=7*pi/6, x=2"
  const assignments = list.split(",").map(s => s.trim()).filter(Boolean);

  const scopeObj = {};

  for (const item of assignments) {
    const parts = item.split("=");
    if (parts.length !== 2) continue;

    const name  = parts[0].trim();
    const value = parts[1].trim();

    if (!name || !value) continue;

    try {
      scopeObj[name] = math.evaluate(value);
    } catch (e) {
      console.error("Bad scope entry:", item, e);
    }
  }

  currentScope = scopeObj;
  return true;
}

function preprocessTrigArgs(expr) {
  return expr.replace(
    /\b(sin|cos|tan|sec|csc|cot)\s+([A-Za-zθφπ0-9]+)/g,
    (m, fn, arg) => `${fn}(${arg})`
  );
}

function equationEq(exprA, exprB) {
  exprA = preprocess(exprA);
  exprB = preprocess(exprB);

  exprA = preprocessTrigArgs(exprA);
  exprB = preprocessTrigArgs(exprB);
  try {
    const [leftA, rightA] = exprA.split("=").map(s => s.trim());
    const [leftB, rightB] = exprB.split("=").map(s => s.trim());

    if (!leftA || !rightA || !leftB || !rightB) return false;

    const Aleft  = math.evaluate(leftA,  currentScope);
    const Aright = math.evaluate(rightA, currentScope);
    const Bleft  = math.evaluate(leftB,  currentScope);
    const Bright = math.evaluate(rightB, currentScope);

    return (
      Math.abs(Aleft - Aright) < 1e-6 &&
      Math.abs(Bleft - Bright) < 1e-6
    );
  } catch (e) {
    return false;
  }
}

function numericEq(exprA, exprB, trials = 6) {
  exprA = preprocess(exprA);
  exprB = preprocess(exprB);

  exprA = preprocessTrigArgs(exprA);
  exprB = preprocessTrigArgs(exprB);

  const varsA = extractVars(exprA);
  const varsB = extractVars(exprB);
  const vars = [...new Set([...varsA, ...varsB])];

  // We'll attempt to obtain `trials` successful numeric evaluations. Expressions
  // that produce non-finite values (e.g. sqrt of a negative) will be skipped
  // and retried up to maxAttempts; otherwise a domain error would cause a
  // false negative. If we cannot gather enough valid samples, return false.
  const maxAttempts = Math.max(trials * 10, 30);
  let successes = 0;
  let attempts = 0;

  while (successes < trials && attempts < maxAttempts) {
    attempts++;
    let scope = {};
    vars.forEach(v => scope[v] = Math.random() * 4 - 2);

    try {
      const valA = math.evaluate(exprA, scope);
      const valB = math.evaluate(exprB, scope);

      // Only compare numeric values. math.evaluate may return Complex or
      // other non-number values; skip those trials.
      if (typeof valA !== 'number' || typeof valB !== 'number') {
        continue;
      }

      if (!Number.isFinite(valA) || !Number.isFinite(valB)) {
        // Skip domain errors such as sqrt(negative), division by zero, etc.
        continue;
      }

      if (Math.abs(valA - valB) > 1e-6) return false;

      // This trial succeeded
      successes++;

    } catch (e) {
      // Evaluation failed (domain or parse errors); skip and try again
      continue;
    }
  }

  // If we managed `trials` successful comparisons and none differed, assume
  // numeric equality; otherwise we couldn't validate enough points.
  return successes >= trials;
}


function addStep() {
  const asciiBox = document.getElementById("asciiBox");
  if (!asciiBox) return;

  let expr = asciiBox.value.trim();
  if (!expr) return;

  // 1. SCOPE COMMAND
  if (expr.startsWith("scope:")) {
    setScope(expr);
    workspaceEl.innerHTML += `<div class='w3-text-green'>Scope updated.</div>`;
    return;
  }

  // 2. EQUATION OR EXPRESSION CHECKING
  const isEquation = expr.includes("=");
  const prevIsEquation = steps.length > 0 && steps[steps.length - 1].includes("=");

  if (document.getElementById("checkStepBox").checked && steps.length > 0) {
    const prev = steps[steps.length - 1];
    let equivalent = false;

    if (isEquation && prevIsEquation) {
      equivalent = equationEq(prev, expr);
    } else {
      equivalent = numericEq(prev, expr);
    }

    if (!equivalent) {
      workspaceEl.innerHTML += `<div class='w3-text-red'>✘ Not equivalent</div>`;
      return;
    }

    workspaceEl.innerHTML += `<div class='w3-text-green'>✔ Equivalent</div>`;
    // 3. ADD STEP (when check is enabled)
    steps.push(expr);

    // Save to session
    const asciiBoxNow = document.getElementById('asciiBox');
    const inputVal = asciiBoxNow ? asciiBoxNow.value : "";
    session.workspaces[index] = { steps: [...steps], input: inputVal };
    saveSession();

    workspaceEl.innerHTML += `<div>%%${expr}%%</div>`;
    MathJax.typesetPromise([workspaceEl]);
    workspaceEl.scrollTop = workspaceEl.scrollHeight;

    // Return here to avoid adding the step again below
    return;

  }

  // 3. ADD STEP TO WORKSPACE (when check is not enabled)
  steps.push(expr);

  // Save to session
  const asciiBoxNow = document.getElementById('asciiBox');
  const inputVal = asciiBoxNow ? asciiBoxNow.value : "";
  session.workspaces[index] = { steps: [...steps], input: inputVal };
  saveSession();

  workspaceEl.innerHTML += `<div>%%${expr}%%</div>`;
  MathJax.typesetPromise([workspaceEl]);
  workspaceEl.scrollTop = workspaceEl.scrollHeight;
}

document.getElementById("sendBtn").onclick = addStep;
document.getElementById("clearWorkspaceBtn").onclick = () => {
  workspaceEl.innerHTML = "";
  steps = [];
  const asciiBoxEl = document.getElementById('asciiBox');
  if (asciiBoxEl) asciiBoxEl.value = '';
  // persist cleared workspace for current index
  session.workspaces[index] = { steps: [], input: '' };
  saveSession();
};

/* ==========================================================
      PROBLEM SETS (with EDIT FEATURE)
========================================================== */

let editingPS = null;

function loadProblemSets() {
  loadDocs("pset").then(psets => {
    psets = psets.filter(ps => ps.lesson === effectiveLesson);

    const list = document.getElementById("pset-list");
    list.innerHTML = "";

    psets.forEach(ps => {
      const row = document.createElement("div");
      row.className = "w3-padding-small w3-border-bottom w3-hover-light-grey";

      // Clicking the name runs the PSet
      const nameSpan = document.createElement("span");
      nameSpan.style.cursor = "pointer";
      nameSpan.textContent = ps.name;
      nameSpan.onclick = () => startPSet(ps);
      row.appendChild(nameSpan);

      if (currentUser.role === "teacher") {
        // ✏️ EDIT
        const edit = document.createElement("span");
        edit.textContent = "🖉";
        edit.title = "Edit problem set";
        edit.style.cursor = "pointer";
        edit.style.float = "right";
        edit.style.marginLeft = "10px";
        edit.onclick = (ev) => {
          ev.stopPropagation();
          startEditPSet(ps);
        };
        row.appendChild(edit);

        // 🗑️ DELETE
        const del = document.createElement("span");
        del.textContent = "🗑️";
        del.title = "Delete problem set";
        del.style.cursor = "pointer";
        del.style.float = "right";
        del.style.marginLeft = "10px";
        del.onclick = (ev) => {
          ev.stopPropagation();
          if (confirm("Delete this problem set?")) {
            db.remove(ps).then(loadProblemSets);
          }
        };
        row.appendChild(del);
      }

      list.appendChild(row);
    });
  });
}

document.getElementById("save-pset-btn").onclick = saveNewPSet;

function saveNewPSet() {
  if (currentUser.role !== "teacher") {
    alert("Only teachers can create problem sets.");
    return;
  }

  const name = document.getElementById("pset-name").value.trim();
  const desc = document.getElementById("pset-desc").value.trim();
  const raw  = document.getElementById("pset-questions").value.trim();

  if (!name) return alert("Problem set name is required.");

  const questions = parseQuestions(raw);
  if (!questions.length) return;

  saveDoc({
    type: "pset",
    lesson: effectiveLesson,
    name,
    desc,
    questions,
    user: currentUser.username,
    role: currentUser.role
  }).then(() => {
    clearPSetFields();
    loadProblemSets();
  });
}

function startEditPSet(ps) {
  editingPS = ps;

  const creator = document.getElementById("pset-creator");
  creator.open = true;

  document.getElementById("pset-name").value = ps.name;
  document.getElementById("pset-desc").value = ps.desc;

  let text = "";
  ps.questions.forEach(q => {
    text += "question: " + q.question + "\n";
    if (q.prompt) {
      text += "prompt: " + q.prompt + "\n";
    }
    text += "answer: "   + q.answer   + "\n\n";
  });

  document.getElementById("pset-questions").value = text.trim();

  const btn = document.getElementById("save-pset-btn");
  btn.textContent = "Save Changes";
  btn.onclick = saveEditedPSet;
}

function saveEditedPSet() {
  if (!editingPS) return;

  const name = document.getElementById("pset-name").value.trim();
  const desc = document.getElementById("pset-desc").value.trim();
  const raw  = document.getElementById("pset-questions").value.trim();

  if (!name) return alert("Problem set name is required.");

  const questions = parseQuestions(raw);
  if (!questions.length) return;

  editingPS.name = name;
  editingPS.desc = desc;
  editingPS.questions = questions;

  saveDoc(editingPS).then(() => {
    editingPS = null;
    const btn = document.getElementById("save-pset-btn");
    btn.textContent = "Save";
    btn.onclick = saveNewPSet;

    clearPSetFields();
    loadProblemSets();
  });
}

function parseQuestions(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const questions = [];
  let currentQ = null;

  for (let line of lines) {
    if (line.toLowerCase().startsWith("question:")) {
      if (currentQ) questions.push(currentQ);
      currentQ = {
        question: line.substring(9).trim(),
        prompt: "",
        answer: ""
      };
    } else if (line.toLowerCase().startsWith("prompt:")) {
      if (!currentQ) {
        alert("Found 'prompt:' before any 'question:' line.");
        return [];
      }
      currentQ.prompt = line.substring(7).trim();
    } else if (line.toLowerCase().startsWith("answer:")) {
      if (!currentQ) {
        alert("Found 'answer:' before any 'question:' line.");
        return [];
      }
      currentQ.answer = line.substring(7).trim();
    }
  }

  if (currentQ) questions.push(currentQ);
  return questions;
}

function clearPSetFields() {
  document.getElementById("pset-name").value = "";
  document.getElementById("pset-desc").value = "";
  document.getElementById("pset-questions").value = "";
}

let currentPS = null;
let index = 0;
let answers = [];

function startPSet(ps) {
  currentPS = ps;
  index = 0;
  // Initialize session.answers array if not already set
  if (!Array.isArray(session.answers) || session.answers.length === 0) {
    session.answers = new Array(ps.questions.length).fill("");
  }

  document.getElementById("pset-runner").style.display = "block";
  document.getElementById("pset-runner-title").textContent = ps.name;
  document.getElementById("pset-runner-desc").textContent = ps.desc;

  showQ();
}

function showQ() {
  const q = currentPS.questions[index];

  // RESET WORKSPACE
    workspaceEl.innerHTML = "";

    const cleanQ = q.question.replace(/%%/g, "");
    
    // If this question has stored work, restore it
    if (session.workspaces[index]) {
        const saved = session.workspaces[index];
        if (saved && saved.steps) {
            steps = [...saved.steps];
        } else if (Array.isArray(saved)) {
            // backwards compatibility
            steps = [...saved];
        }
    } else {
        // Start fresh with the question itself
        steps = [cleanQ];
      session.workspaces[index] = { steps: [...steps], input: cleanQ };
      saveSession();
    }

    // Render steps
    steps.forEach(s => {
        workspaceEl.innerHTML += `<div>%%${s}%%</div>`;
    });

    MathJax.typesetPromise([workspaceEl]);
    workspaceEl.scrollTop = workspaceEl.scrollHeight;


  const box = document.getElementById("pset-question-box");

  let display = `<strong>Question:</strong><br>${q.question}`;
  if (q.prompt) {
    const promptHtml = marked.parse(q.prompt);
    display += `<br><div class="w3-small w3-text-grey">${promptHtml}</div>`;
  }
  box.innerHTML = display;
  MathJax.typesetPromise([box]);

  // Load question into ASCII workspace input
  const asciiBox = document.getElementById("asciiBox");
  if (asciiBox) {
    // Restore saved input for this question if present
    const saved = session.workspaces[index];
    if (saved && saved.input !== undefined) {
      asciiBox.value = saved.input;
    } else {
      asciiBox.value = cleanQ;
    }
    asciiBox.selectionStart = asciiBox.selectionEnd = asciiBox.value.length;
    asciiBox.focus();
  }

  // RESTORE ANSWER + NAV BUTTONS
  document.getElementById("pset-answer").value = session.answers[index] || "";

  document.getElementById("prev-q-btn").disabled = (index === 0);
  document.getElementById("next-q-btn").disabled =
    (index === currentPS.questions.length - 1);

  // ALWAYS ENABLE STEP CHECK (you can change this if you want)
  document.getElementById("checkStepBox").checked = true;
}

document.getElementById("prev-q-btn").onclick = () => {
    // Save current workspace before moving
  const asciiNow = document.getElementById('asciiBox');
  session.workspaces[index] = { steps: [...steps], input: asciiNow ? asciiNow.value : '' };
  session.answers[index] = document.getElementById("pset-answer").value;
  saveSession();

    index--;
    showQ();

};

document.getElementById("next-q-btn").onclick = () => {
  const asciiNow = document.getElementById('asciiBox');
  session.workspaces[index] = { steps: [...steps], input: asciiNow ? asciiNow.value : '' };
  session.answers[index] = document.getElementById("pset-answer").value;
  saveSession();
    index++;
    showQ();
};

document.getElementById("check-pset-btn").onclick = () => {
  session.answers[index] = document.getElementById("pset-answer").value;

  let correct = 0;
  let report = `<h4>Results</h4>`;

  currentPS.questions.forEach((q, i) => {
    const student = (session.answers[i] || "").trim();
    const expected = q.answer.trim();
    const ok = numericEq(expected, student);

    if (ok) {
      correct++;
    } else {
      // Add wrong-answer block
      report += `
        <div class="w3-pale-red w3-padding w3-margin-top w3-border">
          <strong>Question ${i+1}:</strong><br>
          <span class="w3-small">${q.question}</span><br><br>

          <strong>Your answer:</strong><br>
          %%${student || "(blank)"}%%<br><br>

          <strong>Correct answer:</strong><br>
          %%${expected}%%
        </div>
      `;
    }
  });

  // Score summary
  report =
    `<div class="w3-padding w3-pale-blue w3-border">
        <strong>Score: ${correct} / ${currentPS.questions.length}</strong>
     </div>` +
    report;

  // Render into result box
  const resultBox = document.getElementById("pset-result");
  resultBox.innerHTML = report;

  // MathJax render all math
  // persist student's answers/score if recording
  session.submitted = true;
  session.score = correct;
  saveSession();

  MathJax.typesetPromise([resultBox]);
};


loadProblemSets();

/* ==========================================================
      SESSION PERSISTENCE + TEACHER VIEW
========================================================== */

async function saveSession() {
  if (!session.recorded) return;
  try {
    if (!session.sessionDoc) {
      // create initial doc
      session.sessionDoc = {
        _id: `session:${effectiveLesson}:${currentUser.username}:${Date.now()}`,
        type: "session",
        lesson: effectiveLesson,
        user: currentUser.username,
        started: session.started,
        workspaces: normalizeArrayLike(session.workspaces),
        answers: normalizeArrayLike(session.answers),
        submitted: session.submitted || false,
        score: session.score || null,
        lastUpdated: Date.now()
      };
      const res = await db.put(session.sessionDoc);
      session.sessionDoc._rev = res.rev;
      // Ensure in-memory session.workspaces/answers are native arrays
      session.workspaces = normalizeArrayLike(session.workspaces);
      session.answers = normalizeArrayLike(session.answers);
      console.log('Saved new session doc', session.sessionDoc._id, res.rev);
    } else {
      // update fields and save
      session.sessionDoc.workspaces = normalizeArrayLike(session.workspaces);
      session.sessionDoc.answers = normalizeArrayLike(session.answers);
      session.sessionDoc.submitted = session.submitted || false;
      session.sessionDoc.score = session.score || null;
      session.sessionDoc.lastUpdated = Date.now();
      const res = await db.put(session.sessionDoc);
      session.sessionDoc._rev = res.rev;
      // Ensure in-memory session.workspaces/answers are native arrays
      session.workspaces = normalizeArrayLike(session.workspaces);
      session.answers = normalizeArrayLike(session.answers);
      console.log('Updated session doc', session.sessionDoc._id, res.rev);
    }
    // refresh sessions list (for teachers)
    if (currentUser.role === 'teacher') loadSessions();
  } catch (e) {
    console.error("Failed to save session:", e);
  }
}

// Ensure session is saved before leaving the page (clicking Dashboard, closing tab, etc.)
window.addEventListener('beforeunload', (ev) => {
  if (session.recorded) {
    // Attempt synchronous save (best-effort); fallback to async save
    try {
      // navigator.sendBeacon could be used, but PouchDB doesn't expose a syncable beacon.
      // Call saveSession (async) but browser may not wait — still better than nothing.
      saveSession();
    } catch (e) {
      console.warn('beforeunload saveSession failed', e);
    }
  }
});

function renderSessionsList(sessions) {
  const list = document.getElementById("session-list");
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = "(no sessions)";
    return;
  }

  list.innerHTML = "";
  sessions.forEach(s => {
    const row = document.createElement("div");
    row.className = "w3-padding-small w3-border-bottom w3-hover-light-grey";

    const title = document.createElement("div");
    const ts = new Date(s.lastUpdated || s.started).toLocaleString();
    title.innerHTML = `<strong>${s.user}</strong> — <span class='w3-small w3-text-grey'>${ts}</span>`;
    row.appendChild(title);

    const actions = document.createElement("div");
    actions.style.float = "right";

    const joinBtn = document.createElement("button");
    joinBtn.className = "w3-button w3-small w3-light-grey";
    joinBtn.textContent = "Join";
    joinBtn.onclick = () => joinSession(s);
    actions.appendChild(joinBtn);

    const viewBtn = document.createElement("button");
    viewBtn.className = "w3-button w3-small w3-white";
    viewBtn.style.marginLeft = "6px";
    viewBtn.textContent = "View";
    viewBtn.onclick = () => {
      // show full session contents in the workspace area (read-only view)
      joinSession(s, {readOnly:true});
    };
    actions.appendChild(viewBtn);

    row.appendChild(actions);
    list.appendChild(row);
  });
}

function loadSessions() {
  loadDocs("session").then(sessions => {
    sessions = sessions.filter(s => s.lesson === effectiveLesson);
    // sort by user then by date desc
    sessions.sort((a,b) => {
      if (a.user === b.user) return (b.lastUpdated || b.started) - (a.lastUpdated || a.started);
      return a.user.localeCompare(b.user);
    });
    // Backwards-compatibility: normalize persisted session docs so they store
    // native JS Arrays rather than objects with numeric keys.
    sessions.forEach((s) => {
      let changed = false;
      const newWorkspaces = normalizeArrayLike(s.workspaces);
      const newAnswers = normalizeArrayLike(s.answers);
      if (Array.isArray(s.workspaces) === false && newWorkspaces.length > 0) {
        s.workspaces = newWorkspaces;
        changed = true;
      }
      if (Array.isArray(s.answers) === false && newAnswers.length > 0) {
        s.answers = newAnswers;
        changed = true;
      }
      if (changed) {
        // Save normalized doc back so future reads are consistent
        db.put(s).then(res => console.log('Normalized session doc', s._id, res.rev))
          .catch(e => console.warn('Failed to normalize session doc', s._id, e));
      }
    });
    renderSessionsList(sessions);
    // show panel for teachers
    if (currentUser.role === "teacher") {
      const panel = document.getElementById("sessions-panel");
      if (panel) panel.style.display = "block";
    }
  });
}

function joinSession(doc, opts = {}) {
  // doc: session document
  if (!doc) return;

  // mark that teacher is viewing
  session.viewingSession = doc._id || (doc.type + ":" + doc.user + ":" + (doc.started||0));

  // Render session into workspace showing all student work in sequence
  workspaceEl.innerHTML = "";

  // doc.workspaces used to be an array, but older/alternate codepaths
  // or some persisted documents might store workspaces as an object
  // with numeric keys (e.g. {0:..., 1:...}) rather than a real Array.
  // Normalize into an array to be defensive here.

  const workspaces = normalizeArrayLike(doc.workspaces);
  const answers = normalizeArrayLike(doc.answers);

  if (!Array.isArray(doc.workspaces)) console.warn('joinSession: doc.workspaces is not an Array; normalized for display', doc.workspaces);
  if (!Array.isArray(doc.answers) && doc.answers) console.warn('joinSession: doc.answers is not an Array; normalized for display', doc.answers);

  if (workspaces && workspaces.length > 0) {
    // For each question's workspace, show the saved steps
    workspaces.forEach((ws, qIdx) => {
      if (!ws) return;
      
      workspaceEl.innerHTML += `<div style="margin-bottom:20px; padding-bottom:10px; border-bottom:1px solid #ccc;">`;
      workspaceEl.innerHTML += `<strong style="color:#666;">Question ${qIdx+1}:</strong>`;
      
      const steps = ws.steps || (Array.isArray(ws) ? ws : []);
      if (steps.length === 0) {
        workspaceEl.innerHTML += `<div class="w3-text-grey w3-small">(no work saved)</div>`;
      } else {
        steps.forEach(s => {
          workspaceEl.innerHTML += `<div>%%${s}%%</div>`;
        });
      }
      
      // Show the student's answer if available
      if (answers && answers[qIdx]) {
        workspaceEl.innerHTML += `<div style="margin-top:8px; background:#f0f0f0; padding:6px; border-radius:3px;">`;
        workspaceEl.innerHTML += `<span class="w3-small w3-text-grey">Final answer:</span> %%${answers[qIdx]}%%`;
        workspaceEl.innerHTML += `</div>`;
      }
      
      workspaceEl.innerHTML += `</div>`;
    });
  } else {
    workspaceEl.innerHTML = "(no saved work)";
  }

  MathJax.typesetPromise([workspaceEl]);
  workspaceEl.scrollTop = workspaceEl.scrollHeight;

  // Disable input while viewing
  const asciiBox = document.getElementById("asciiBox");
  const sendBtn = document.getElementById("sendBtn");
  if (asciiBox) asciiBox.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  // Show banner with leave button
  const banner = document.getElementById("session-view-banner");
  if (banner) banner.style.display = "inline-block";
}

function leaveSessionView() {
  // Re-enable input and clear viewing flag
  session.viewingSession = null;
  const asciiBox = document.getElementById("asciiBox");
  const sendBtn = document.getElementById("sendBtn");
  if (asciiBox) asciiBox.disabled = false;
  if (sendBtn) sendBtn.disabled = false;

  const banner = document.getElementById("session-view-banner");
  if (banner) banner.style.display = "none";

  // Reload current workspace (either pset view or regular)
  if (currentPS) showQ();
  else {
    // clear and show any current steps variable
    workspaceEl.innerHTML = "";
    steps.forEach(s => workspaceEl.innerHTML += `<div>%%${s}%%</div>`);
    MathJax.typesetPromise([workspaceEl]);
  }
}

// wire up leave button
document.addEventListener('DOMContentLoaded', () => {
  const leaveBtn = document.getElementById('leave-session-btn');
  if (leaveBtn) leaveBtn.onclick = leaveSessionView;

  // set record checkbox initial state and handler
  const recBox = document.getElementById('record-session-checkbox');
  if (recBox) {
    recBox.checked = session.recorded;
    recBox.onchange = () => {
      session.recorded = !!recBox.checked;
      localStorage.setItem(recordKey, session.recorded ? 'true' : 'false');
      if (session.recorded) {
        // create an initial save immediately
        saveSession();
      }
    };
  }

  // If teacher, load sessions
  if (currentUser.role === 'teacher') loadSessions();
});

/* ==========================================================
      REALTIME LIVE UPDATES
========================================================== */
db.changes({
  since: "now",
  live: true,
  include_docs: true
})
.on("change", ch => {
  const d = ch.doc;
  if (!d || !d.type) return;

  if (d.type === "note" && d.lesson === effectiveLesson) loadNotes();
  if (d.type === "pset" && d.lesson === effectiveLesson) loadProblemSets();
  if (d.type === "session" && d.lesson === effectiveLesson) loadSessions();
});
