
const roadmap = [
  ['Pre-operative patient for anesthetic assessment','Core','Observed','Repeated'],
  ['Hypotension (peri-operative / ICU)','Core','Observed','Repeated'],
  ['Hypoxia / respiratory distress','Core','Observed','Repeated'],
  ['Altered level of consciousness','Core','Observed','Repeated'],
  ['Post-operative pain','Core','Observed','Repeated'],
  ['Post-operative nausea / vomiting','Core','Observed','Repeated'],
  ['Fever / suspected sepsis in an inpatient','Core','Observed','Repeated'],
  ['Oliguria / low urine output','Core','Observed','Repeated'],
  ['Arrhythmia / abnormal ECG','Expanded','Observed','Single'],
  ['Hypertensive crisis','Expanded','Observed','Single'],
  ['Electrolyte disturbance','Expanded','Observed','Single'],
  ['Seizure','Expanded','Observed','Single'],
  ['Anaphylaxis','Expanded','Observed','Single'],
  ['In-hospital cardiac arrest','Expanded','Observed','Single'],
  ['Failed / difficult airway','Advanced','Discussion','Single'],
  ['Malignant hyperthermia','Advanced','Discussion','Single'],
  ['Local anesthetic systemic toxicity','Advanced','Discussion','Single'],
  ['ASA physical status classification','Core','Observed','Repeated'],
  ['Fasting guidelines','Core','Observed','Repeated'],
  ['Cardiac risk and functional capacity (METs)','Core','Observed','Repeated'],
  ['Hypertension and diabetes optimization','Core','Observed','Repeated'],
  ['Peri-operative anticoagulant / antiplatelet plan','Expanded','Discussion','Single'],
  ['Respiratory risk (COPD, asthma, smoking)','Expanded','Observed','Single'],
  ['Obstructive sleep apnea risk','Expanded','Discussion','Single'],
  ['Pregnancy-related anesthetic considerations','Expanded','Discussion','Single'],
  ['Pediatric anesthesia considerations','Advanced','Discussion','Single'],
  ['Frailty and geriatric anesthesia','Advanced','Discussion','Single'],
  ['Severe cardiac disease for non-cardiac surgery','Advanced','Discussion','Single'],
  ['General anesthesia: induction, maintenance, emergence','Core','Observed','Repeated'],
  ['Spinal anesthesia','Core','Observed','Repeated'],
  ['Local anesthetic infiltration','Core','Observed','Repeated'],
  ['Procedural sedation / monitored anesthesia care','Expanded','Observed','Single'],
  ['Rapid sequence induction','Expanded','Observed','Single'],
  ['Epidural analgesia','Expanded','Observed','Single'],
  ['Peripheral nerve blocks','Expanded','Observed','Single'],
  ['Combined spinal-epidural','Advanced','Discussion','Single'],
  ['Awake fiberoptic intubation','Advanced','Discussion','Single'],
  ['One-lung ventilation','Advanced','Discussion','Single'],
  ['Airway positioning and simple adjuncts (OPA / NPA)','Core','Observed','Repeated'],
  ['Endotracheal intubation','Core','Observed','Repeated'],
  ['Laryngeal mask airway','Core','Observed','Repeated'],
  ['Videolaryngoscopy','Expanded','Observed','Single'],
  ['Extubation criteria and technique','Expanded','Observed','Single'],
  ['Tracheostomy care','Expanded','Observed','Single'],
  ['Difficult airway algorithm','Advanced','Discussion','Single'],
  ['Surgical airway (cricothyroidotomy)','Advanced','Discussion','Single'],
  ['Standard monitoring (ECG, SpO2, NIBP, capnography, temperature)','Core','Performed under supervision','Repeated'],
  ['Capnography interpretation','Core','Observed','Repeated'],
  ['Intra-operative fluid management','Core','Observed','Repeated'],
  ['Anesthesia machine pre-use check','Core','Observed','Single'],
  ['Invasive arterial pressure monitoring','Expanded','Observed','Single'],
  ['Central venous pressure monitoring','Expanded','Observed','Single'],
  ['Temperature management and warming','Expanded','Observed','Single'],
  ['Depth-of-anesthesia monitoring','Expanded','Discussion','Single'],
  ['Cardiac output monitoring','Advanced','Discussion','Single'],
  ['Transesophageal echocardiography','Advanced','Discussion','Single'],
  ['Induction agents (propofol, ketamine, etomidate)','Core','Discussion','Repeated'],
  ['Opioids and their side effects','Core','Discussion','Repeated'],
  ['Neuromuscular blockers and reversal','Core','Discussion','Repeated'],
  ['Local anesthetics and maximum doses','Core','Discussion','Repeated'],
  ['Vasopressors and inotropes','Core','Observed','Repeated'],
  ['Volatile agents','Expanded','Discussion','Single'],
  ['PONV prophylaxis','Expanded','Observed','Single'],
  ['Sugammadex versus neostigmine','Expanded','Discussion','Single'],
  ['Dexmedetomidine and adjuncts','Advanced','Discussion','Single'],
  ['Total intravenous anesthesia (TIVA)','Advanced','Discussion','Single'],
  ['PACU handover and monitoring','Core','Observed','Repeated'],
  ['Multimodal analgesia','Core','Observed','Repeated'],
  ['Pain scoring','Core','Performed under supervision','Repeated'],
  ['Recognition of emergence complications (laryngospasm, obstruction)','Core','Observed','Single'],
  ['Patient-controlled analgesia','Expanded','Observed','Single'],
  ['Regional analgesia follow-up','Expanded','Observed','Single'],
  ['Emergence delirium / agitation','Expanded','Observed','Single'],
  ['Chronic pain referral','Advanced','Discussion','Single'],
  ['Recognition of shock','Core','Observed','Repeated'],
  ['Sepsis recognition and first-hour bundle','Core','Observed','Repeated'],
  ['Fluid resuscitation principles','Core','Observed','Repeated'],
  ['ACLS algorithm','Expanded','Observed','Single'],
  ['Septic shock and vasopressor titration','Expanded','Observed','Single'],
  ['Cardiogenic shock','Expanded','Observed','Single'],
  ['Anaphylaxis management','Expanded','Observed','Single'],
  ['Blood product transfusion','Expanded','Observed','Single'],
  ['Post-cardiac-arrest care','Advanced','Discussion','Single'],
  ['Massive transfusion protocol','Advanced','Discussion','Single'],
  ['ECMO concepts','Advanced','Discussion','Single'],
  ['Oxygen therapy and escalation','Core','Observed','Repeated'],
  ['Type 1 versus type 2 respiratory failure','Core','Observed','Repeated'],
  ['Invasive mechanical ventilation basics','Core','Observed','Repeated'],
  ['Non-invasive ventilation (CPAP / BiPAP)','Expanded','Observed','Single'],
  ['ARDS','Expanded','Observed','Single'],
  ['Ventilator weaning and extubation readiness','Expanded','Observed','Single'],
  ['Prone positioning','Advanced','Discussion','Single'],
  ['Advanced ventilator modes','Advanced','Discussion','Single'],
  ['Maintenance and resuscitation fluids','Core','Observed','Repeated'],
  ['Potassium disorders','Core','Observed','Repeated'],
  ['Acid-base disorders','Core','Discussion','Repeated'],
  ['Acute kidney injury recognition','Core','Observed','Repeated'],
  ['Sodium disorders','Expanded','Observed','Single'],
  ['Diabetic ketoacidosis in ICU','Expanded','Observed','Single'],
  ['Renal replacement therapy indications','Expanded','Observed','Single'],
  ['Rhabdomyolysis','Expanded','Discussion','Single'],
  ['CRRT prescription','Advanced','Discussion','Single'],
  ['Glasgow Coma Scale assessment','Core','Performed under supervision','Repeated'],
  ['Sedation scoring (RASS)','Core','Observed','Repeated'],
  ['ICU delirium screening (CAM-ICU)','Expanded','Observed','Single'],
  ['Status epilepticus','Expanded','Observed','Single'],
  ['Raised intracranial pressure recognition','Expanded','Observed','Single'],
  ['Brain-stem death testing','Expanded','Discussion','Single'],
  ['ICP monitoring','Advanced','Discussion','Single'],
  ['Targeted temperature management','Advanced','Discussion','Single'],
  ['Structured ICU daily round (FAST-HUGS-BID)','Core','Observed','Repeated'],
  ['Hand hygiene and infection control','Core','Performed under supervision','Repeated'],
  ['Ventilator and line-infection prevention bundles','Expanded','Observed','Single'],
  ['Enteral and parenteral nutrition','Expanded','Observed','Single'],
  ['Central line care','Expanded','Observed','Single'],
  ['Family communication and goals of care','Expanded','Observed','Single'],
  ['End-of-life care and withdrawal of treatment','Advanced','Discussion','Single'],
  ['Focused anesthetic / critical care history (AMPLE)','Core','Performed under supervision','Repeated'],
  ['Medication and allergy history','Core','Performed under supervision','Repeated'],
  ['Previous anesthetic and family history','Core','Performed under supervision','Repeated'],
  ['Functional capacity assessment','Core','Performed under supervision','Repeated'],
  ['Fasting status and comorbidities','Core','Performed under supervision','Repeated'],
  ['Airway examination (Mallampati, mouth opening, neck movement)','Core','Performed under supervision','Repeated'],
  ['Cardiovascular examination','Core','Performed under supervision','Repeated'],
  ['Respiratory examination and chest auscultation','Core','Performed under supervision','Repeated'],
  ['Neurological screen (GCS, pupils)','Core','Performed under supervision','Repeated'],
  ['Peripheral IV cannulation','Core','Performed under supervision','Repeated'],
  ['Bag-mask ventilation','Core','Performed under supervision','Repeated'],
  ['Basic life support (CPR)','Core','Performed under supervision','Repeated'],
  ['Structured handover (SBAR)','Core','Performed under supervision','Repeated'],
  ['Arterial blood gas sampling','Core','Observed','Repeated'],
  ['Urinary catheterization','Expanded','Observed','Single'],
  ['Arterial line insertion','Expanded','Observed','Single'],
  ['Central venous catheter insertion','Expanded','Observed','Single'],
  ['Arterial blood gas','Core','Observed','Repeated'],
  ['Lactate','Core','Observed','Repeated'],
  ['Electrolytes and renal function','Core','Observed','Repeated'],
  ['CBC','Core','Observed','Repeated'],
  ['Blood glucose','Core','Observed','Repeated'],
  ['Coagulation profile','Core','Observed','Repeated'],
  ['Blood cultures','Core','Observed','Single'],
  ['Troponin','Expanded','Observed','Single'],
  ['CRP / procalcitonin','Expanded','Observed','Single'],
  ['Liver function tests','Expanded','Observed','Single'],
  ['Viscoelastic testing (TEG / ROTEM)','Advanced','Discussion','Single'],
  ['Chest X-ray','Core','Observed','Repeated'],
  ['Point-of-care lung ultrasound','Expanded','Observed','Single'],
  ['Focused cardiac ultrasound','Expanded','Observed','Single'],
  ['CT head','Expanded','Observed','Single'],
  ['CT chest / pulmonary angiography','Expanded','Observed','Single'],
  ['Formal echocardiography','Expanded','Observed','Single'],
  ['IVC assessment for volume status','Advanced','Discussion','Single'],
  ['ECG interpretation','Core','Observed','Repeated'],
  ['Pulse oximetry and capnography waveforms','Core','Observed','Repeated'],
  ['Arterial line waveform','Expanded','Observed','Single'],
  ['Ventilator waveforms and alarms','Expanded','Observed','Single'],
  ['Hemodynamic trends and early-warning scores','Expanded','Observed','Single']
];
const emergencyData = {
  'Cardiac Arrest': {redFlags:['Unresponsive, not breathing normally','No pulse / shockable rhythm on monitor','Reversible cause suspected (Hs and Ts)','Arrest witnessed or monitored'],ddx:['Ventricular fibrillation / pulseless VT','Asystole / PEA','Hypoxia','Hypovolemia','Tension pneumothorax','Electrolyte disturbance (K+)','Pulmonary embolism']},
  'Septic Shock': {redFlags:['Hypotension not responding to fluids','Lactate above 2 mmol/L','Altered mental state','Mottled skin / prolonged capillary refill'],ddx:['Pneumonia','Intra-abdominal source','Urinary source','Line or wound infection','Meningitis / CNS']},
  'Acute Respiratory Failure': {redFlags:['Severe hypoxia or rising work of breathing','Drowsiness or confusion (CO2 retention)','Silent chest / exhaustion','Hemodynamic instability'],ddx:['Pneumonia','COPD / asthma exacerbation','Pulmonary edema','Pulmonary embolism','Pneumothorax','ARDS']},
  'Difficult / Failed Airway': {redFlags:['Cannot intubate','Cannot ventilate by mask or LMA','Falling SpO2 despite oxygenation attempts','Anticipated difficulty (Mallampati, neck, mouth opening)'],ddx:['Anatomical (small mouth, large tongue, short neck)','Pathological (mass, infection, trauma)','Obesity / OSA','Previous airway surgery or radiotherapy']},
  'Anaphylaxis': {redFlags:['Hypotension / circulatory collapse','Bronchospasm / airway swelling','Rapid onset rash, flushing, angioedema','Trigger drug or latex just given'],ddx:['Drug (antibiotic, neuromuscular blocker)','Latex','Contrast / colloid','Food or insect sting','Other cause of shock']}
};
const emergencyInvestigations={
  'Cardiac Arrest':['Rhythm check','ABG','Potassium and electrolytes','Glucose','Bedside echo (if available)'],
  'Septic Shock':['Blood cultures before antibiotics','Lactate','CBC and CRP / procalcitonin','Renal and liver function','Source imaging (chest X-ray / CT)'],
  'Acute Respiratory Failure':['ABG','Chest X-ray','ECG','CBC and electrolytes','Lung ultrasound (if available)'],
  'Difficult / Failed Airway':['SpO2 and capnography','ABG (if prolonged)','Airway examination findings'],
  'Anaphylaxis':['Serum tryptase','ABG (if severe)','Allergy referral record']
};
const groupDefs=[
 {id:'presentations',label:'Clinical Presentations',start:'Pre-operative patient for anesthetic assessment',end:'ASA physical status classification'},
 {id:'preop',label:'Pre-operative Evaluation & Optimization',start:'ASA physical status classification',end:'General anesthesia: induction, maintenance, emergence'},
 {id:'techniques',label:'Anesthetic Techniques',start:'General anesthesia: induction, maintenance, emergence',end:'Airway positioning and simple adjuncts (OPA / NPA)'},
 {id:'airway',label:'Airway Management',start:'Airway positioning and simple adjuncts (OPA / NPA)',end:'Standard monitoring (ECG, SpO2, NIBP, capnography, temperature)'},
 {id:'monitoring',label:'Intra-operative Monitoring & Physiology',start:'Standard monitoring (ECG, SpO2, NIBP, capnography, temperature)',end:'Induction agents (propofol, ketamine, etomidate)'},
 {id:'pharm',label:'Anesthetic Pharmacology',start:'Induction agents (propofol, ketamine, etomidate)',end:'PACU handover and monitoring'},
 {id:'recovery',label:'Recovery & Pain Management',start:'PACU handover and monitoring',end:'Recognition of shock'},
 {id:'shock',label:'Shock, Sepsis & Resuscitation',start:'Recognition of shock',end:'Oxygen therapy and escalation'},
 {id:'resp',label:'Respiratory Failure & Ventilation',start:'Oxygen therapy and escalation',end:'Maintenance and resuscitation fluids'},
 {id:'renal',label:'Fluids, Electrolytes, Acid-Base & Renal',start:'Maintenance and resuscitation fluids',end:'Glasgow Coma Scale assessment'},
 {id:'neuro',label:'Neuro-critical Care & Sedation',start:'Glasgow Coma Scale assessment',end:'Structured ICU daily round (FAST-HUGS-BID)'},
 {id:'icucare',label:'ICU Care, Safety & Communication',start:'Structured ICU daily round (FAST-HUGS-BID)',end:'Focused anesthetic / critical care history (AMPLE)'},
 {id:'history',label:'History Taking',start:'Focused anesthetic / critical care history (AMPLE)',end:'Airway examination (Mallampati, mouth opening, neck movement)'},
 {id:'exam',label:'Examination & Procedural Skills',start:'Airway examination (Mallampati, mouth opening, neck movement)',end:'Arterial blood gas'},
 {id:'labs',label:'Laboratory Investigations',start:'Arterial blood gas',end:'Chest X-ray'},
 {id:'imaging',label:'Imaging & Point-of-care Ultrasound',start:'Chest X-ray',end:'ECG interpretation'},
 {id:'monix',label:'ECG, Waveforms & Monitoring Interpretation',start:'ECG interpretation',end:null}
];
const journeyItems=['Pre-operative anesthetic assessment','Consent and fasting check','Induction and airway management','Intra-operative monitoring','Emergence and extubation','PACU handover','ICU admission and daily review','Weaning and step-down','Handover to ward / discharge'];
const interpretationItems=['Correlating clinical findings with investigation results','Recognizing when a result changes management vs. is confirmatory/incidental','Understanding indications/contraindications for common investigations','Recognizing when further investigation is needed vs. proceeding to intervention','Understanding the limits of a single test'];
const groupExtras={ patientJourney:{id:'patientJourney',label:'Perioperative & ICU Journey',items:journeyItems.map((item,i)=>({id:'journey_'+i,item,tier:'—',depth:'—',freq:'—'}))}, interpretation:{id:'interpretation',label:'Clinical Interpretation & Decision-making',items:interpretationItems.map((item,i)=>({id:'interp_'+i,item,tier:'—',depth:'—',freq:'—'}))} };
function makeRoadmapItems(){
  const out=[];
  groupDefs.forEach(g=>{
    const start=roadmap.findIndex(r=>r[0]===g.start); const end=g.end?roadmap.findIndex(r=>r[0]===g.end):roadmap.length;
    for(let i=start;i<(end<0?roadmap.length:end);i++){const r=roadmap[i]; out.push({id:'r_'+i,legacyIndex:i,group:g.id,groupLabel:g.label,item:r[0],tier:r[1],depth:r[2],freq:r[3]});}
    if(g.id==='icucare'){ groupExtras.patientJourney.items.forEach(x=>out.push({...x,group:'patientJourney',groupLabel:groupExtras.patientJourney.label})); }
  });
  groupExtras.interpretation.items.forEach(x=>out.push({...x,group:'interpretation',groupLabel:groupExtras.interpretation.label}));
  return out;
}
const roadmapItems=makeRoadmapItems();

const pageParams = new URLSearchParams(window.location.search);
const requestedInstance = pageParams.get('instance') || '';
const instanceId = /^[0-9a-f-]{36}$/i.test(requestedInstance) ? requestedInstance : '';
const previewMode = !instanceId || !window.opener || pageParams.get('mode') === 'preview';
let readOnlyMode = pageParams.get('readonly') === '1';
let cloudReady = previewMode;
let cloudDirty = false;
let saveTimer = null;
let mentorReviews = [];
const reviewMessages = Object.create(null);
const reviewPending = new Set();
const storagePrefix = 'mentoro_anesthesia_preview_';
const store={get:(k,f='')=>{try{return localStorage.getItem(storagePrefix+k)??f}catch(e){return f}},set:(k,v)=>{try{localStorage.setItem(storagePrefix+k,v)}catch(e){}}};
function emptyState(){return {sessions:[],cases:[],procedures:[],roadmap:{},emergency:[],reflection:{}};}
function makeId(){return window.crypto&&typeof window.crypto.randomUUID==='function'?window.crypto.randomUUID():'anesthesia-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);}
function normalizeState(value){
 const raw=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const state={
  sessions:Array.isArray(raw.sessions)?raw.sessions:[],
  cases:Array.isArray(raw.cases)?raw.cases:[],
  procedures:Array.isArray(raw.procedures)?raw.procedures:[],
  roadmap:raw.roadmap&&typeof raw.roadmap==='object'&&!Array.isArray(raw.roadmap)?raw.roadmap:{},
  emergency:Array.isArray(raw.emergency)?raw.emergency:[],
  reflection:raw.reflection&&typeof raw.reflection==='object'&&!Array.isArray(raw.reflection)?raw.reflection:{}
 };
 let changed=false;const seen=new Set();
 ['sessions','cases','procedures','emergency'].forEach(key=>{
  state[key]=state[key].map(item=>{
   const row=item&&typeof item==='object'&&!Array.isArray(item)?{...item}:{};
   if(typeof row.id!=='string'||!row.id||seen.has(row.id)){row.id=makeId();changed=true;}
   seen.add(row.id);
   ['mentorVerified','mentorDate','mentor_verified','mentor_date'].forEach(field=>{
    if(Object.prototype.hasOwnProperty.call(row,field)){delete row[field];changed=true;}
   });
   return row;
  });
 });
 return {state,changed};
}
let cachedSnapshot=null;
if(previewMode){try{const raw=store.get('state','');if(raw)cachedSnapshot=normalizeState(JSON.parse(raw));}catch(_){cachedSnapshot=null;}}
var data=previewMode?(cachedSnapshot?.state||emptyState()):emptyState();
function currentCloudState(){return {sessions:data.sessions,cases:data.cases,procedures:data.procedures,roadmap:data.roadmap,emergency:data.emergency,reflection:data.reflection};}
function syncStatus(message,isError=false){const el=document.getElementById('syncStatus');if(!el)return;el.textContent=message;el.classList.toggle('error',Boolean(isError));}
function setCloudLoading(loading){const el=document.querySelector('main.content');if(el){el.inert=Boolean(loading);if(loading)el.setAttribute('aria-busy','true');else el.removeAttribute('aria-busy');}}
function postCloudState(flushNow=false){
 if(!instanceId||previewMode||!window.opener||!cloudReady||readOnlyMode)return;
 try{window.opener.postMessage({type:'MENTORO_LOGBOOK_STATE_CHANGED',instanceId,state:currentCloudState(),flushNow:flushNow===true},window.location.origin);cloudDirty=true;syncStatus('Saving to MENTORO cloud…');}
 catch(_){syncStatus('Cloud connection unavailable',true);}
}
function save(options={}){
 if(readOnlyMode)return;
 if(previewMode){store.set('state',JSON.stringify(currentCloudState()));syncStatus('Saved in standalone preview');return;}
 if(!cloudReady){syncStatus('Waiting for the MENTORO cloud state to load. No changes were saved.',true);return;}
 if(saveTimer)clearTimeout(saveTimer);
 if(options.flushNow)postCloudState(true);else saveTimer=setTimeout(()=>postCloudState(false),500);
}
function allReviewableEntries(){
 const rows=[];
 data.sessions.forEach(item=>rows.push({type:'session',item}));
 data.cases.forEach(item=>rows.push({type:'case',item}));
 data.procedures.forEach(item=>rows.push({type:item.kind==='discussion'||item.topic?'discussion':'procedure',item}));
 data.emergency.forEach(item=>rows.push({type:'emergency',item}));
 return rows.filter(row=>row.item&&typeof row.item.id==='string');
}
function reviewTitle(type,item){return item.focus||item.presentation||item.dx||item.procedure||item.topic||item.template||item.complaint||({session:'Clinical session',case:'Clinical case',procedure:'Procedure',discussion:'Teaching discussion',emergency:'Emergency exposure'}[type]||'Logbook entry');}
function renderMentorReviewPanel(){
 const panel=document.getElementById('mentorReviewPanel');if(!panel)return;
 if(!readOnlyMode||!instanceId||previewMode){panel.hidden=true;panel.innerHTML='';return;}
 panel.hidden=false;
 const latest=new Map();mentorReviews.forEach(review=>latest.set(String(review.item_type)+'::'+String(review.item_id),review));
 const rows=allReviewableEntries();
 panel.innerHTML='<div class="section-head"><div><h2>Mentor review</h2><p>Review the trainee record. The logbook itself remains read-only.</p></div></div>'+(reviewMessages._global?'<p class="review-note">'+esc(reviewMessages._global)+'</p>':'')+(rows.length?'<div class="mentor-review-grid">'+rows.map(row=>{
  const key=row.type+'::'+row.item.id;const previous=latest.get(key);const current=previous&&previous.is_current===true;const pending=reviewPending.has(key);
  const history=previous?'<div class="review-prior"><strong>'+(current?'Latest decision: ':'Previous decision — not current: ')+esc(previous.decision)+'</strong>'+(previous.feedback?'<p>'+esc(previous.feedback)+'</p>':'')+'</div>':'<p>No mentor decision recorded.</p>';
  return '<article class="mentor-review-card" data-review-card><h3>'+esc(reviewTitle(row.type,row.item))+'</h3><small>'+esc(row.type)+' · '+esc(row.item.date||'—')+'</small>'+history+'<label>Decision<select data-review-decision><option value="">Choose decision</option><option value="VERIFIED">Verified</option><option value="FEEDBACK">Feedback</option><option value="NEEDS_REVISION">Needs revision</option></select></label><label>Feedback / next steps<textarea data-review-feedback maxlength="2000" placeholder="Required for feedback or revision (5–2,000 characters)."></textarea></label><button class="btn primary" type="button" data-review-submit data-review-id="'+esc(row.item.id)+'" data-review-type="'+row.type+'" '+(pending?'disabled':'')+'>'+(pending?'Saving…':'Record mentor review')+'</button><p data-review-status role="status">'+esc(reviewMessages[key]||'')+'</p></article>';
 }).join('')+'</div>':'<p>No saved entries are available for review yet.</p>');
}
function applyReadOnlyMode(){
 if(!readOnlyMode)return;
 document.body.classList.add('html-logbook-readonly');
 const banner=document.getElementById('readonlyBanner');if(banner)banner.hidden=false;
 document.querySelectorAll('button').forEach(button=>{
  if(button.hasAttribute('data-view')||button.id==='themeToggle'||button.classList.contains('phase-tab')||button.classList.contains('filter')||button.classList.contains('status-filter')||button.id==='procTabFull'||button.id==='procTabDiscussion'||button.hasAttribute('data-review-submit')||button.getAttribute('onclick')?.includes("go('")||button.getAttribute('onclick')?.includes('window.print()'))return;
  button.disabled=true;button.setAttribute('aria-disabled','true');button.title='Read-only logbook';
 });
 document.querySelectorAll('input,textarea,select').forEach(control=>{
  if(['roadSearch','roadGroupSelect','sessionSearch','caseSearch','procSearch','discussionSearch','emergencySearch'].includes(control.id))return;
  if(control.closest('#mentorReviewPanel'))return;
  control.disabled=true;
 });
 document.querySelectorAll('#mentorReviewPanel button').forEach(button=>{if(button.hasAttribute('data-review-submit'))button.disabled=false;});
}
function receiveParentMessage(event){
 if(event.origin!==window.location.origin||!window.opener||event.source!==window.opener||!event.data||event.data.instanceId!==instanceId)return;
 const message=event.data;
 if(message.type==='MENTORO_LOGBOOK_LOAD_REVIEWS'){mentorReviews=Array.isArray(message.reviews)?message.reviews:[];if(message.error)reviewMessages._global=message.error;else delete reviewMessages._global;renderMentorReviewPanel();return;}
 if(message.type==='MENTORO_LOGBOOK_MENTOR_REVIEW_RESULT'){
  const key=String(message.itemType||'')+'::'+String(message.itemId||'');reviewPending.delete(key);
  if(message.ok&&message.review){mentorReviews=mentorReviews.filter(review=>String(review.item_type)+'::'+String(review.item_id)!==key);mentorReviews.push(message.review);reviewMessages[key]='Mentor review saved successfully.';}
  else reviewMessages[key]=String(message.error||'Could not save this review.');renderMentorReviewPanel();return;
 }
 if(message.type==='MENTORO_LOGBOOK_SET_READ_ONLY'){readOnlyMode=true;render();syncStatus('Read-only mentor review mode');return;}
 if(message.type==='MENTORO_LOGBOOK_LOAD_STATE'){
  readOnlyMode=readOnlyMode||message.readOnly===true;let normalized={state:emptyState(),changed:false};
  if(message.hasCloudState&&message.state&&typeof message.state==='object')normalized=normalizeState(message.state);
  data=normalized.state;cloudReady=true;cloudDirty=false;setCloudLoading(false);
  render();syncStatus(readOnlyMode?'Read-only mentor review mode':'Connected · cloud state loaded');
  if(normalized.changed&&!readOnlyMode)postCloudState(true);
  return;
 }
 if(message.type==='MENTORO_LOGBOOK_SAVE_RESULT'){
  if(message.ok){cloudDirty=false;syncStatus('Saved to MENTORO cloud');}
  else syncStatus(message.error||'Cloud save failed',true);return;
 }
 if(message.type==='MENTORO_LOGBOOK_LOAD_ERROR'){setCloudLoading(false);cloudReady=false;syncStatus(message.error||'Could not load cloud logbook',true);return;}
}
function startCloudBridge(){
 if(previewMode){cloudReady=true;syncStatus('Standalone preview · changes stay in this browser');return;}
 setCloudLoading(true);syncStatus('Connecting to assigned Anesthesia & Critical Care logbook…');
 window.addEventListener('message',receiveParentMessage);
 window.opener.postMessage({type:'MENTORO_LOGBOOK_READY',instanceId},window.location.origin);
 window.addEventListener('pagehide',()=>{if(cloudDirty)postCloudState(true);});
}
document.getElementById('mentorReviewPanel')?.addEventListener('click',event=>{
 const button=event.target.closest('[data-review-submit]');if(!button||!readOnlyMode)return;
 const card=button.closest('[data-review-card]');const decision=card.querySelector('[data-review-decision]').value;const feedback=card.querySelector('[data-review-feedback]').value.trim();const id=button.dataset.reviewId;const type=button.dataset.reviewType;const key=type+'::'+id;const status=card.querySelector('[data-review-status]');
 if(!decision){status.textContent='Choose a decision first.';return;}if(decision!=='VERIFIED'&&feedback.length<5){status.textContent='Add at least 5 characters of feedback.';return;}if(feedback.length>2000){status.textContent='Feedback must be 2,000 characters or fewer.';return;}if(reviewPending.has(key)||!window.opener)return;
 reviewPending.add(key);button.disabled=true;status.textContent='Saving review securely…';window.opener.postMessage({type:'MENTORO_LOGBOOK_MENTOR_REVIEW',instanceId,itemId:id,itemType:type,decision,feedback},window.location.origin);
});
var activeGroup='presentations',activeTier='',activeStatus='',procTab='full',activePhase='04';
var sessionQuery='',caseQuery='',procQuery='',discQuery='',emergencyQuery='';
const phaseDefs=[{id:'04',label:'Clinical Roadmap',groups:['presentations','preop','techniques','airway','monitoring','pharm','recovery','shock','resp','renal','neuro','icucare','patientJourney']},{id:'05',label:'Clinical Skills',groups:['history','exam']},{id:'06',label:'Investigations',groups:['labs','imaging','monix','interpretation']}];
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function applyThemeButton(){const b=document.getElementById('themeToggle');if(!b)return;const dark=document.documentElement.getAttribute('data-theme')==='dark';b.textContent=dark?'☀️':'🌙';b.title=dark?'Switch to light mode':'Switch to dark mode';}
function toggleTheme(){const cur=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';const next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('mentoro_anesthesia_theme',next)}catch(e){}applyThemeButton();}
applyThemeButton();


function labelView(v){return v==='dashboard'?'Overview':v==='cases'?'Clinical Cases':v==='emergency'?'Emergency':v==='progress'?'Progress':v.charAt(0).toUpperCase()+v.slice(1)}
function closeQuickAdd(){const m=document.getElementById('quickMenu');if(m)m.classList.remove('open');const b=document.querySelector('.quick-add > button');if(b)b.setAttribute('aria-expanded','false')}
function toggleQuickAdd(){const m=document.getElementById('quickMenu');if(!m)return;const open=m.classList.toggle('open');const b=document.querySelector('.quick-add > button');if(b)b.setAttribute('aria-expanded',open?'true':'false')}
function quickOpen(kind){closeQuickAdd();openModal(kind)}
function go(v){closeQuickAdd();document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.getElementById(v).classList.add('active');document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===v));document.getElementById('crumb').textContent=labelView(v);window.scrollTo({top:0,behavior:'instant'});render();}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
function roadStatus(id){return data.roadmap[id]||''}
function toggleRoad(id){if(readOnlyMode||(!previewMode&&!cloudReady))return;const st=roadStatus(id); if(st==='done') delete data.roadmap[id]; else data.roadmap[id]='done'; save(); render();}
function renderRoadPhase(){const el=document.getElementById('roadPhases');if(!el)return;el.innerHTML=phaseDefs.map(p=>`<button class="phase-tab ${activePhase===p.id?'active':''}" onclick="setRoadPhase('${p.id}')">${esc(p.label)}</button>`).join('');}
function renderRoadGroups(){const el=document.getElementById('roadGroupSelect');if(!el)return;const defs=[...groupDefs.map(g=>({id:g.id,label:g.label})),groupExtras.patientJourney,groupExtras.interpretation].filter(g=>{const p=phaseDefs.find(p=>p.id===activePhase);return p?.groups.includes(g.id)});el.innerHTML=defs.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');el.value=defs.some(g=>g.id===activeGroup)?activeGroup:(defs[0]?.id||'');}
function getActiveItems(){return roadmapItems.filter(r=>r.group===activeGroup)}
function renderRoad(){
 const items=getActiveItems(); const q=(document.getElementById('roadSearch')?.value||'').toLowerCase().trim();
 const rows=items.filter(r=>(!q||`${r.item} ${r.tier} ${r.depth} ${r.freq}`.toLowerCase().includes(q))&&(!activeTier||r.tier===activeTier)&&(!activeStatus||(activeStatus==='todo'?!roadStatus(r.id):roadStatus(r.id)===activeStatus)));
 const g=roadmapItems.find(r=>r.group===activeGroup);document.getElementById('roadGroupTitle').textContent=g?.groupLabel||'';document.getElementById('roadGroupMeta').textContent=`${rows.length} shown · ${items.length} total`;
 renderRoadPhase(); renderRoadGroups();
 const groupSelect=document.getElementById('roadGroupSelect'); if(groupSelect)groupSelect.value=activeGroup;
 document.getElementById('roadRows').innerHTML=rows.map(r=>{const st=roadStatus(r.id);const cls=r.tier==='Core'?'core':r.tier==='Expanded'?'expanded':r.tier==='Advanced'?'advanced':'';return `<tr><td><span class="item-title">${esc(r.item)}</span></td><td>${r.tier==='—'?'—':`<span class="tag ${cls}">${esc(r.tier)}</span>`}</td><td>${esc(r.depth)}</td><td>${esc(r.freq)}</td><td><div class="coverage"><button class="checkbtn ${st==='done'?'done':''}" aria-label="${st==='done'?'Logged':'Not logged'}: ${esc(r.item)}" title="Click to toggle status" onclick="toggleRoad('${esc(r.id)}')">${st==='done'?'✓':'○'}</button><span class="${st?'':'muted'}">${st==='done'?'Logged':'Not logged'}</span></div></td></tr>`}).join('')||`<tr><td colspan="5" class="empty">No items match this filter.</td></tr>`;
}
function setRoadPhase(id){activePhase=id;const p=phaseDefs.find(x=>x.id===id);activeGroup=p?.groups[0]||'presentations';activeTier='';activeStatus='';resetRoadFilters();renderRoad();}
function setRoadGroup(id){activeGroup=id;activePhase=phaseDefs.find(p=>p.groups.includes(id))?.id||activePhase;activeTier='';activeStatus='';resetRoadFilters();renderRoad();}
function resetRoadFilters(){document.querySelectorAll('#tierFilters .filter').forEach(x=>x.classList.toggle('active',x.dataset.tier===''));document.querySelectorAll('#statusFilters .status-filter').forEach(x=>x.classList.toggle('active',x.dataset.status===''));const q=document.getElementById('roadSearch');if(q)q.value='';}
function renderRows(){
 const fs=sessionQuery; const fc=caseQuery; const fp=procQuery; const fd=discQuery; const fe=emergencyQuery;
 const sessions=data.sessions.map((x,i)=>({x,i})).filter(({x})=>!fs||JSON.stringify(x).toLowerCase().includes(fs));
 document.getElementById('sessionCount').textContent=`${sessions.length} of ${data.sessions.length} session${data.sessions.length===1?'':'s'}`;
 document.getElementById('sessionRows').innerHTML=sessions.map(({x,i})=>`<tr><td>${i+1}</td><td>${esc(x.date)}</td><td>${esc(x.duration)}</td><td>${esc((x.types||[]).join(', ')||x.type||'—')}</td><td>${esc(x.focus)}</td><td>${esc(x.confidence||'—')}</td><td>${esc(x.initials||'—')}</td><td><div class="table-actions"><button class="mini-btn" onclick="openModal('session',${i})">Edit</button><button class="mini-btn danger" onclick="removeItem('sessions',${i})">Remove</button></div></td></tr>`).join('')||`<tr><td colspan="8"><div class="empty-cta"><strong>${data.sessions.length?'No sessions match your search.':'No sessions logged yet.'}</strong>${data.sessions.length?'':'<span>Start with a brief record of today’s session.</span><button class="btn primary" onclick=\"openModal(\'session\')\">+ Add session</button>'}</div></td></tr>`;
 const cases=data.cases.map((x,i)=>({x,i})).filter(({x})=>!fc||JSON.stringify(x).toLowerCase().includes(fc));
 document.getElementById('caseCount').textContent=`${cases.length} of ${data.cases.length} case${cases.length===1?'':'s'}`;
 document.getElementById('caseRows').innerHTML=cases.map(({x,i})=>`<tr><td>${i+1}</td><td>${esc(x.date)}</td><td>${esc(x.setting)}</td><td>${esc(x.presentation)}</td><td>${esc(x.dx)}</td><td>${esc(x.decision)}</td><td>${esc(x.mentor||'—')}</td><td><div class="table-actions"><button