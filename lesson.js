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
  workspaces: {},       // already implemented!
  answers: {},          // we can store these too if you want
  score: null,
  submitted: false
};

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

  for (let i = 0; i < trials; i++) {
    let scope = {};
    vars.forEach(v => scope[v] = Math.random() * 4 - 2);

    try {
      const valA = math.evaluate(exprA, scope);
      const valB = math.evaluate(exprB, scope);

      if (!Number.isFinite(valA) || !Number.isFinite(valB)) return false;
      if (Math.abs(valA - valB) > 1e-6) return false;

    } catch {
      return false;
    }
  }
  return true;
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
    session.workspaces[index] = [...steps];

    workspaceEl.innerHTML += `<div>%%${expr}%%</div>`;
    MathJax.typesetPromise([workspaceEl]);
    workspaceEl.scrollTop = workspaceEl.scrollHeight;

    // Return here to avoid adding the step again below
    return;

  }

  // 3. ADD STEP TO WORKSPACE (when check is not enabled)
  steps.push(expr);

  // Save to session
  session.workspaces[index] = [...steps];

  workspaceEl.innerHTML += `<div>%%${expr}%%</div>`;
  MathJax.typesetPromise([workspaceEl]);
  workspaceEl.scrollTop = workspaceEl.scrollHeight;
}

document.getElementById("sendBtn").onclick = addStep;
document.getElementById("clearWorkspaceBtn").onclick = () => {
  workspaceEl.innerHTML = "";
  steps = [];
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
  answers = [];

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
        steps = [...session.workspaces[index]];
    } else {
        // Start fresh with the question itself
        steps = [cleanQ];
        session.workspaces[index] = [...steps];
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
    asciiBox.value = cleanQ;
    asciiBox.selectionStart = asciiBox.selectionEnd = asciiBox.value.length;
    asciiBox.focus();
  }

  // RESTORE ANSWER + NAV BUTTONS
  document.getElementById("pset-answer").value = answers[index] || "";

  document.getElementById("prev-q-btn").disabled = (index === 0);
  document.getElementById("next-q-btn").disabled =
    (index === currentPS.questions.length - 1);

  // ALWAYS ENABLE STEP CHECK (you can change this if you want)
  document.getElementById("checkStepBox").checked = true;
}

document.getElementById("prev-q-btn").onclick = () => {
    // Save current workspace before moving
    session.workspaces[index] = [...steps];

    answers[index] = document.getElementById("pset-answer").value;
    index--;
    showQ();

};

document.getElementById("next-q-btn").onclick = () => {
    session.workspaces[index] = [...steps];
    answers[index] = document.getElementById("pset-answer").value;
    index++;
    showQ();
};

document.getElementById("check-pset-btn").onclick = () => {
  answers[index] = document.getElementById("pset-answer").value;

  let correct = 0;
  let report = `<h4>Results</h4>`;

  currentPS.questions.forEach((q, i) => {
    const student = (answers[i] || "").trim();
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
  MathJax.typesetPromise([resultBox]);
};


loadProblemSets();

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
});
