const DB_NAME = "notes_super_app";
const DB_VERSION = 1;
const STORE = "notes";
let db, currentId = null, filter = "all", mediaRecorder = null, audioChunks = [], recordingStarted = 0, recordingTimer = null;

const $ = id => document.getElementById(id);
const els = {
  grid:$("notesGrid"), empty:$("empty"), emptyTitle:$("emptyTitle"), emptyText:$("emptyText"),
  modal:$("editorModal"), title:$("titleInput"), body:$("bodyInput"), attachments:$("attachments"),
  save:$("saveState"), search:$("search"), pageTitle:$("pageTitle"), noteCount:$("noteCount"),
  allCount:$("allCount"), favCount:$("favCount"), archiveCount:$("archiveCount"),
  favorite:$("favoriteBtn"), archive:$("archiveBtn"), recording:$("recordingPanel"),
  recordTime:$("recordingTime"), toast:$("toast")
};

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random(); }
function now(){ return new Date().toISOString(); }

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(STORE)){
        const s=d.createObjectStore(STORE,{keyPath:"id"});
        s.createIndex("updatedAt","updatedAt");
      }
    };
    req.onsuccess=e=>{db=e.target.result;resolve(db)};
    req.onerror=()=>reject(req.error);
  });
}
function tx(mode="readonly"){return db.transaction(STORE,mode).objectStore(STORE)}
function getAll(){
  return new Promise((res,rej)=>{const r=tx().getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
}
function getNote(id){
  return new Promise((res,rej)=>{const r=tx().get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
}
function putNote(note){
  return new Promise((res,rej)=>{const r=tx("readwrite").put(note);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})
}
function deleteNote(id){
  return new Promise((res,rej)=>{const r=tx("readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})
}

function escapeHTML(s=""){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function formatDate(iso){
  const d=new Date(iso), nowD=new Date();
  if(d.toDateString()===nowD.toDateString()) return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  return d.toLocaleDateString([], {day:"numeric",month:"short",year:"numeric"});
}
function toast(msg){
  els.toast.textContent=msg;els.toast.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove("show"),1800);
}
function visibleNotes(all){
  let a=all;
  if(filter==="favorites")a=a.filter(n=>n.favorite);
  if(filter==="archived")a=a.filter(n=>n.archived);
  if(filter==="all")a=a.filter(n=>!n.archived);
  const q=els.search.value.trim().toLowerCase();
  if(q)a=a.filter(n=>(n.title+" "+n.body).toLowerCase().includes(q) || (n.attachments||[]).some(x=>x.name.toLowerCase().includes(q)));
  return a.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
}
async function render(){
  const all=await getAll();
  els.allCount.textContent=all.filter(n=>!n.archived).length;
  els.favCount.textContent=all.filter(n=>n.favorite&&!n.archived).length;
  els.archiveCount.textContent=all.filter(n=>n.archived).length;
  els.pageTitle.textContent=filter==="favorites"?"Favorites":filter==="archived"?"Archived":"All Notes";
  const notes=visibleNotes(all);
  els.noteCount.textContent=`${notes.length} note${notes.length===1?"":"s"}`;
  els.grid.innerHTML=notes.map(n=>{
    const preview=n.body?.trim() || (n.attachments?.length ? "📎 Attachment" : n.audio?.length ? "🎙 Voice note" : "Empty note");
    const voice=n.audio?.length?`<span class="voice-chip">🎙 ${n.audio.length} voice note${n.audio.length>1?"s":""}</span>`:"";
    return `<article class="note-card" data-id="${n.id}">
      <h3>${escapeHTML(n.title||"Untitled note")}</h3>
      <div class="note-preview">${escapeHTML(preview)}</div>
      <div class="card-bottom"><span>${formatDate(n.updatedAt)}</span>${voice}<span class="star">${n.favorite?"★":""}</span></div>
    </article>`;
  }).join("");
  els.grid.querySelectorAll(".note-card").forEach(c=>c.onclick=()=>edit(c.dataset.id));
  els.empty.classList.toggle("show",notes.length===0);
  els.emptyTitle.textContent=els.search.value?"No matching notes":filter==="favorites"?"No favorite notes":filter==="archived"?"No archived notes":"No notes yet";
  els.emptyText.textContent=els.search.value?"Try another search.":"Create your first note and everything will be saved automatically.";
}
function blankNote(){
  return {id:uid(),title:"",body:"",favorite:false,archived:false,attachments:[],audio:[],createdAt:now(),updatedAt:now()};
}
async function createNote(){const n=blankNote();await putNote(n);await edit(n.id)}
async function edit(id){
  const n=await getNote(id); if(!n)return;
  currentId=id; els.title.value=n.title||"";els.body.value=n.body||"";
  els.favorite.textContent=n.favorite?"★":"☆";els.archive.textContent=n.archived?"↩":"▣";
  renderAttachments(n);els.modal.classList.remove("hidden");els.title.focus();updateSave("Saved");
}
function closeEditor(){els.modal.classList.add("hidden");currentId=null;stopRecording(false)}
function updateSave(t){els.save.textContent=t}
let saveTimer;
function scheduleSave(){
  updateSave("Saving…");clearTimeout(saveTimer);
  saveTimer=setTimeout(saveCurrent,350);
}
async function saveCurrent(){
  if(!currentId)return;
  const n=await getNote(currentId);if(!n)return;
  n.title=els.title.value;n.body=els.body.value;n.updatedAt=now();
  await putNote(n);updateSave("Saved");render();
}
async function updateCurrent(fn){
  const n=await getNote(currentId);if(!n)return;
  fn(n);n.updatedAt=now();await putNote(n);await edit(currentId);await render();
}
function renderAttachments(n){
  els.attachments.innerHTML=(n.attachments||[]).map((a,i)=>{
    const image=a.type.startsWith("image/")?`<img src="${a.data}" alt="">`:"📎";
    return `<div class="attachment">${image}<span>${escapeHTML(a.name)}</span><button data-remove="${i}">✕</button></div>`;
  }).join("") + (n.audio||[]).map((a,i)=>`
    <div class="attachment"><span>🎙 ${escapeHTML(a.name||"Voice note")}</span>
      <audio controls src="${a.data}"></audio><button data-audio-remove="${i}">✕</button>
    </div>`).join("");
  els.attachments.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>removeAttachment(+b.dataset.remove));
  els.attachments.querySelectorAll("[data-audio-remove]").forEach(b=>b.onclick=()=>removeAudio(+b.dataset.audioRemove));
}
async function removeAttachment(i){await updateCurrent(n=>n.attachments.splice(i,1))}
async function removeAudio(i){await updateCurrent(n=>n.audio.splice(i,1))}

$("newNote").onclick=$("newNoteTop").onclick=$("emptyButton").onclick=createNote;
$("closeEditor").onclick=closeEditor;
els.title.oninput=els.body.oninput=scheduleSave;
$("search").oninput=render;
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{
  filter=b.dataset.filter;document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));b.classList.add("active");render();
  if(innerWidth<701)$("sidebar").classList.remove("open");
});
$("favoriteBtn").onclick=()=>updateCurrent(n=>n.favorite=!n.favorite);
$("archiveBtn").onclick=()=>updateCurrent(n=>n.archived=!n.archived);
$("deleteBtn").onclick=async()=>{
  if(!currentId)return;
  if(confirm("Delete this note permanently?")){await deleteNote(currentId);closeEditor();render();toast("Note deleted")}
};
$("boldBtn").onclick=()=>insertWrap("**","**");
$("italicBtn").onclick=()=>insertWrap("*","*");
$("checkBtn").onclick=()=>insertAtCursor("☐ ");
$("dateBtn").onclick=()=>insertAtCursor(new Date().toLocaleString());
$("colorBtn").onclick=()=>insertAtCursor("==highlight== ");
function insertAtCursor(t){
  const a=els.body.selectionStart,b=els.body.selectionEnd,v=els.body.value;
  els.body.value=v.slice(0,a)+t+v.slice(b);els.body.selectionStart=els.body.selectionEnd=a+t.length;scheduleSave();els.body.focus();
}
function insertWrap(a,b){
  const s=els.body.selectionStart,e=els.body.selectionEnd,v=els.body.value,sel=v.slice(s,e);
  els.body.value=v.slice(0,s)+a+sel+b+v.slice(e);els.body.selectionStart=s+a.length;els.body.selectionEnd=s+a.length+sel.length;scheduleSave();els.body.focus();
}
$("fileInput").onchange=async e=>{
  if(!currentId)return;
  const files=[...e.target.files];
  for(const f of files){
    if(f.size>30*1024*1024){toast("File too large (30MB max)");continue}
    const data=await fileToDataURL(f);
    await updateCurrent(n=>n.attachments.push({id:uid(),name:f.name,type:f.type,data}));
  }
  e.target.value="";
};
function fileToDataURL(file){return new Promise((r,j)=>{const x=new FileReader();x.onload=()=>r(x.result);x.onerror=j;x.readAsDataURL(file)})}

$("voiceBtn").onclick=startRecording;
$("stopRecording").onclick=()=>stopRecording(true);
async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia){toast("Voice recording is not supported here");return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];mediaRecorder=new MediaRecorder(stream);recordingStarted=Date.now();
    mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};
    mediaRecorder.onstop=async()=>{
      const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      const data=await fileToDataURL(blob);
      await updateCurrent(n=>n.audio.push({id:uid(),name:"Voice note • "+new Date().toLocaleString(),type:blob.type,data}));
      stream.getTracks().forEach(t=>t.stop());
    };
    mediaRecorder.start();els.recording.classList.remove("hidden");updateRecordingTime();
    recordingTimer=setInterval(updateRecordingTime,500);toast("Recording…");
  }catch(e){toast("Microphone permission was blocked")}
}
function updateRecordingTime(){
  const s=Math.floor((Date.now()-recordingStarted)/1000),m=String(Math.floor(s/60)).padStart(2,"0"),sec=String(s%60).padStart(2,"0");
  els.recordTime.textContent=`${m}:${sec}`;
}
function stopRecording(save){
  if(!mediaRecorder)return;
  if(mediaRecorder.state!=="inactive")mediaRecorder.stop();
  mediaRecorder=null;els.recording.classList.add("hidden");clearInterval(recordingTimer);els.recordTime.textContent="00:00";
}

$("darkToggle").onclick=()=>{
  document.body.classList.toggle("light");
  localStorage.setItem("notes-theme",document.body.classList.contains("light")?"light":"dark");
};
$("menuBtn").onclick=()=>$("sidebar").classList.toggle("open");
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="n"){e.preventDefault();createNote()}
  if(e.key==="Escape"&&!els.modal.classList.contains("hidden"))closeEditor();
});
window.addEventListener("beforeunload",saveCurrent);

(async()=>{
  try{
    await openDB();
    if(localStorage.getItem("notes-theme")==="light")document.body.classList.add("light");
    const all=await getAll();
    if(!all.length){
      const welcome=blankNote();
      welcome.title="Welcome to Notes";
      welcome.body="Your notes are saved automatically on this device.\\n\\nYou can write, record voice notes, attach files/images, favorite notes, archive them, and search everything.";
      await putNote(welcome);
    }
    await render();
  }catch(e){console.error(e);toast("Could not open local storage")}
})();
