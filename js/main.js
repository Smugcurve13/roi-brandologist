/* ==========================================================================
   Exhibition ROI Score — assessment engine, results, qualification, modal.

   Leads go to Neon Postgres via the /api routes: assessment leads to
   roi_leads (one row per person, updated in place by later steps) and book
   early-access leads to playbook_leads. If the API is unreachable or
   DATABASE_URL isn't set yet, each call falls back to the Apps Script sheet
   webhook so nothing is dropped. See SETUP.md.
   ========================================================================== */

const WHATSAPP_NUMBER = "919138998075";
// v2: the lead gate moved from after Q2 to after Q5, so old in-flight state would
// resume into the wrong phase (a v1 "capture" would submit a 2-answer score as COMPLETE).
const STORAGE_KEY = "roi_assessment_v2";
// Apps Script Web App URL for the "Exhibition ROI Score — Leads" sheet — set once deployed (see apps-script-webhook.gs).
const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwns4G0nxq1Kk7kxpVEBoW6ZVJwgu0maVZMKgkWC1QIYKF74-GbGWUCTDq0NLeLFzTs/exec";

const QUESTIONS = [
  {
    id: "q1",
    prompt: "Can management tell you right now the approximate ₹ value of all open opportunities generated from your last exhibition?",
    dimension: null,
    options: [
      { label: "Yes — fairly accurately", score: 10 },
      { label: "Approximately", score: 7 },
      { label: "It would take considerable effort to calculate", score: 3 },
      { label: "No", score: 0 },
    ],
  },
  {
    id: "q2",
    prompt: "For every serious exhibition opportunity, can management easily see ₹ potential value, lead owner, exact next action and next follow-up date?",
    dimension: "followUpOwnership",
    options: [
      { label: "Yes", score: 10 },
      { label: "For most serious leads", score: 7 },
      { label: "Only for some leads", score: 3 },
      { label: "No", score: 0 },
    ],
  },
  {
    id: "q3",
    prompt: "Within 48 hours after the exhibition, were all enquiries available in one central system?",
    dimension: "leadCapture",
    options: [
      { label: "Yes — virtually all", score: 10 },
      { label: "Most of them", score: 7 },
      { label: "Many were scattered across WhatsApp, visiting cards, Excel or team members", score: 3 },
      { label: "We don't really know", score: 0 },
    ],
  },
  {
    id: "q4",
    prompt: "Were your exhibition leads classified by business potential — Hot, Warm, Nurture, Low Priority?",
    dimension: "leadPrioritisation",
    options: [
      { label: "Yes — systematically", score: 10 },
      { label: "Partially", score: 7 },
      { label: "Mostly informally", score: 3 },
      { label: "No", score: 0 },
    ],
  },
  {
    id: "q10",
    prompt: "Do you calculate actual Exhibition ROI after every exhibition — total investment, opportunities generated, business converted, pipeline still open?",
    dimension: "roiMeasurement",
    options: [
      { label: "Yes — systematically", score: 10 },
      { label: "Sometimes", score: 7 },
      { label: "Informally", score: 3 },
      { label: "No", score: 0 },
    ],
  },
];

const MAX_SCORE = QUESTIONS.length * 10;
function pctScore(total) { return Math.round((total / MAX_SCORE) * 100); }

const DIMENSION_LABELS = {
  leadCapture: "Lead Capture",
  leadPrioritisation: "Lead Prioritisation",
  opportunityValueTracking: "Opportunity Value Tracking",
  followUpOwnership: "Follow-Up Ownership",
  quotationFollowUp: "Quotation Follow-Up",
  roiMeasurement: "ROI Measurement",
};

const LEAK_COPY = {
  followUpOwnership: "High-value opportunities may be receiving the same follow-up as ordinary enquiries.",
  opportunityValueTracking: "Your team may be following up — but management lacks visibility into the ₹ value of the pipeline.",
  leadPrioritisation: "Exhibition enquiries are being captured, but prioritisation appears weak.",
  quotationFollowUp: "Quotations are being sent without a clearly defined conversion rhythm.",
  leadCapture: "Enquiries may be scattered across visiting cards, WhatsApp and spreadsheets instead of one system management can see.",
  roiMeasurement: "You may be exhibiting again and again without ever measuring what the last exhibition actually returned.",
};

const LEAK_PRIORITY = ["followUpOwnership", "opportunityValueTracking", "leadPrioritisation", "quotationFollowUp", "leadCapture", "roiMeasurement"];

function categoryFor(score) {
  if (score <= 40) {
    return {
      key: "leak",
      label: "High Revenue Leakage",
      headline: "Your Exhibition Generates Opportunities — But Your Conversion System Has Significant Gaps.",
      desc: "Your exhibition process appears heavily dependent on individual follow-up rather than a management-visible revenue system.",
      priority: "Visibility + Ownership + Follow-Up Accountability",
    };
  }
  if (score <= 70) {
    return {
      key: "exists",
      label: "Opportunity Exists",
      headline: "Your Exhibition Is Generating Real Opportunities — But Some Are Still Slipping Through.",
      desc: "You are already doing several things correctly. However, valuable opportunities may still be leaking between Enquiry → Qualification → Quotation → Follow-Up.",
      priority: "Your biggest upside may come from stronger prioritisation and management visibility.",
    };
  }
  return {
    key: "scale",
    label: "Ready to Scale",
    headline: "Your Exhibition Conversion System Is Strong — Now It's Time to Scale It.",
    desc: "You already have many fundamentals in place.",
    priority: "Your next opportunity: pre-event targeting + better qualification + automation + account-based follow-up + nurturing + accurate ROI measurement.",
  };
}

/* ---------------- state ---------------- */

// question -> capture (score computed, still hidden) -> complete (score shown)
const VALID_PHASES = ["question", "capture", "complete"];

const state = loadState() || {
  phase: "question",
  currentQuestion: 1,
  answers: {},
  lead: null,
  leadId: null, // roi_leads row id, so later steps update instead of inserting again
  investment: null,
  confirmedBusiness: null,
  score: null,
  category: null,
  qualification: null,
  bookWaitlist: false,
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    // renderAssess() has no fallback branch, so an unrecognised phase would render a
    // permanently blank card with no way out. Start over instead.
    if (!s || !VALID_PHASES.includes(s.phase)) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable — assessment still works, just won't resume */
  }
}

/* ---------------- lead delivery (integration point) ---------------- */

function attribution() {
  const q = new URLSearchParams(location.search);
  return {
    utmSource: q.get("utm_source") || null,
    utmCampaign: q.get("utm_campaign") || null,
    landingPageSource: document.referrer || null,
  };
}

// Falls back to the Apps Script sheet only if the API is unreachable or the
// database isn't wired up yet, so a lead is never dropped mid-migration.
function sheetFallback(payload) {
  if (!SHEET_WEBHOOK_URL) return;
  // text/plain avoids a CORS preflight Apps Script doesn't handle; doPost still JSON.parses the body.
  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// One row per person: created here, then updated in place by the qualification
// step and the review request. state.leadId is the handle.
async function createRoiLead(payload) {
  try {
    const { id } = await postJson("/api/lead", { ...payload, ...attribution(), maxScore: MAX_SCORE });
    state.leadId = id;
    saveState();
  } catch (e) {
    sheetFallback({ ...payload, ...attribution() });
  }
}

async function updateRoiLead(patch) {
  if (!state.leadId) return sheetFallback({ ...(state.lead || {}), ...patch });
  try {
    const res = await fetch("/api/lead", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.leadId, ...patch }),
    });
    if (!res.ok) throw new Error(String(res.status));
  } catch (e) {
    sheetFallback({ ...(state.lead || {}), ...patch });
  }
}

async function createPlaybookLead(payload) {
  try {
    await postJson("/api/playbook", { ...payload, ...attribution() });
  } catch (e) {
    sheetFallback({ ...payload, ...attribution(), bookWaitlist: true });
  }
}

// Analytics gets counts and categories only. Never a name, number or email —
// Google's terms prohibit PII in GA4 and it is grounds for losing the property.
function trackEvent(name, data) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...data });
}

/* ---------------- helpers ---------------- */

function $(sel, root = document) { return root.querySelector(sel); }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- assessment rendering ---------------- */

const mount = $("#assessMount");

function renderAssess() {
  const heightBefore = mount.offsetHeight;
  mount.innerHTML = "";
  if (state.phase === "question") renderQuestion();
  else if (state.phase === "capture") renderCapture();
  else if (state.phase === "complete") renderComplete();
  // mount shrinking (e.g. the Q1 intro blurb disappearing on Q2) pulls everything below it up the page —
  // pull scrollY up by the same amount so the viewport doesn't appear to jump down.
  // Question-to-question only: the capture -> complete swap shrinks by ~400px and we
  // deliberately scroll to the results instead of compensating.
  if (state.phase === "question") {
    const shrink = heightBefore - mount.offsetHeight;
    if (shrink > 0) window.scrollBy({ top: -shrink, behavior: "instant" });
  }
}

function renderIntroBlurb() {
  const wrap = el("div", "assess__intro");
  wrap.style.marginBottom = "48px";
  wrap.innerHTML = `
    <p class="eyebrow eyebrow--light">Exhibition ROI Assessment</p>
    <h2>Let's see how strong your exhibition revenue system really is.</h2>
    <p>Answer based on your most recent exhibition. Don't answer based on what your team should be doing — answer based on what actually happened.</p>
  `;
  return wrap;
}

function renderProgress(container, qNum) {
  const bar = el("div", "progress");
  const fill = el("div", "progress__bar");
  fill.style.width = `${(qNum / QUESTIONS.length) * 100}%`;
  bar.appendChild(fill);
  container.appendChild(bar);
  container.appendChild(el("p", "progress__label", `Question ${qNum} of ${QUESTIONS.length}`));
}

function renderQuestion() {
  const q = QUESTIONS[state.currentQuestion - 1];
  if (state.currentQuestion === 1) mount.appendChild(renderIntroBlurb());
  const card = el("div", "q-card");
  renderProgress(card, state.currentQuestion);
  card.appendChild(el("p", "q-card__prompt", q.prompt));

  const optsWrap = el("div", "q-card__options");
  q.options.forEach((opt) => {
    const btn = el("button", "opt", opt.label);
    btn.addEventListener("click", () => answerQuestion(q, opt));
    optsWrap.appendChild(btn);
  });
  card.appendChild(optsWrap);
  mount.appendChild(card);
}

function answerQuestion(q, opt) {
  if (q.id === "q1") {
    const invEl = document.getElementById("rc-invest");
    const bizEl = document.getElementById("rc-business");
    state.investment = invEl && invEl.value ? Number(invEl.value) : null;
    state.confirmedBusiness = bizEl && bizEl.value ? Number(bizEl.value) : null;
    trackEvent("assessment_started", {});
  }
  state.answers[q.id] = { label: opt.label, score: opt.score, dimension: q.dimension };
  trackEvent(`${q.id}_completed`, { answer: opt.label });
  saveState();
  advanceAfterQuestion();
}

function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

// Iterates QUESTIONS rather than state.answers so a stale key from an older
// schema can't push the total past MAX_SCORE (and pctScore past 100).
function computeScore() {
  let total = 0;
  const dims = {};
  QUESTIONS.forEach((q) => {
    const a = state.answers[q.id];
    if (!a) return;
    total += a.score;
    if (a.dimension) dims[a.dimension] = a.score;
  });
  return { total, dims };
}

function advanceAfterQuestion() {
  if (state.currentQuestion === QUESTIONS.length) {
    // Score is computed here but stays hidden until the lead form is submitted.
    const { total } = computeScore();
    state.score = total;
    state.category = categoryFor(pctScore(total)).key;
    state.phase = "capture";
    trackEvent("assessment_completed", { score: total });
    saveState();
    return renderAssess();
  }
  state.currentQuestion += 1;
  saveState();
  renderAssess();
}

// Reveals an already-computed score. Called after the gate is passed, and on
// reload for visitors who had already passed it.
function revealResults() {
  const { total, dims } = computeScore();
  renderResults(total, dims);
  document.getElementById("results").hidden = false;
  document.getElementById("qualifySection").hidden = false;
  renderQualify();
  refreshPrimaryCtas();
  syncStickyCta();
}

function renderCapture() {
  trackEvent("gate_shown", { score: state.score });
  const card = el("div", "capture-card");
  // Full progress bar: the gate should read as "you're done, claim it" rather than
  // as one more question.
  renderProgress(card, QUESTIONS.length);
  card.insertAdjacentHTML("beforeend", `
    <h3>Your Exhibition ROI Score is ready.</h3>
    <p>All ${QUESTIONS.length} answers are in. Tell us where to send your score and we'll unlock your full diagnostic — your scorecard, your biggest revenue leak, and what to fix first.</p>
  `);
  const form = el("form", "capture-form");
  form.innerHTML = `
    <div class="field">
      <label for="lead-name">Your Name*</label>
      <input id="lead-name" type="text" placeholder="e.g. Rajesh Sharma" required>
    </div>
    <div class="field">
      <label for="lead-company">Company Name*</label>
      <input id="lead-company" type="text" placeholder="e.g. ABC Industries" required>
    </div>
    <div class="field">
      <label for="lead-whatsapp">WhatsApp Number*</label>
      <input id="lead-whatsapp" type="tel" placeholder="+91 98765 43210" required>
    </div>
    <p class="capture-error" id="captureError"></p>
    <button type="submit" class="btn btn--red btn--block">Show My Exhibition ROI Score →</button>
    <p class="consent">By continuing, you agree to receive your Exhibition ROI result and relevant follow-up on WhatsApp.</p>
  `;
  // Set values rather than interpolating into innerHTML — state.lead comes from
  // localStorage and would otherwise be an injection vector into our own page.
  if (state.lead) {
    $("#lead-name", form).value = state.lead.name || "";
    $("#lead-company", form).value = state.lead.company || "";
    $("#lead-whatsapp", form).value = state.lead.whatsapp || "";
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#lead-name", form).value.trim();
    const company = $("#lead-company", form).value.trim();
    const whatsapp = $("#lead-whatsapp", form).value.trim();
    if (!name || !company || whatsapp.replace(/\D/g, "").length < 8) {
      $("#captureError", form).textContent = "Please fill in all fields with a valid WhatsApp number.";
      return;
    }
    // Late fallback: these live in the hero and are normally harvested at Q1, but the
    // visitor may have filled them in afterwards.
    if (state.investment === null) {
      const invEl = document.getElementById("rc-invest");
      state.investment = invEl && invEl.value ? Number(invEl.value) : null;
    }
    if (state.confirmedBusiness === null) {
      const bizEl = document.getElementById("rc-business");
      state.confirmedBusiness = bizEl && bizEl.value ? Number(bizEl.value) : null;
    }
    state.lead = { name, company, whatsapp };
    trackEvent("lead_captured", { score: state.score, resultCategory: state.category });
    createRoiLead({
      ...state.lead,
      answers: Object.fromEntries(Object.entries(state.answers).map(([k, v]) => [k, v.label])),
      investment: state.investment,
      confirmedBusiness: state.confirmedBusiness,
      totalScore: state.score,
      resultCategory: state.category,
      assessmentStatus: "COMPLETE",
      lastQuestionCompleted: QUESTIONS.length,
    });
    state.phase = "complete";
    saveState();
    renderAssess();
    revealResults();
    trackEvent("score_viewed", { score: state.score });
    requestAnimationFrame(() => {
      document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  card.appendChild(form);
  mount.appendChild(card);
}

function renderComplete() {
  const wrap = el("div", "assess__intro");
  wrap.innerHTML = `
    <p class="eyebrow eyebrow--light">Assessment Complete</p>
    <h2>Your Exhibition ROI Score is ready.</h2>
    <p>Scroll down to see your score, diagnostic scorecard and where you're leaking business.</p>
  `;
  const btn = el("a", "btn btn--red", "See My Score ↓");
  btn.href = "#results";
  wrap.appendChild(btn);
  mount.appendChild(wrap);
}

/* ---------------- results ---------------- */

function renderResults(total, dims) {
  const pct = pctScore(total);
  const cat = categoryFor(pct);
  const root = $("#resultsMount");
  root.innerHTML = "";

  const hero = el("div", "score-hero");
  hero.innerHTML = `
    <p class="eyebrow">Your Exhibition ROI Score</p>
    <div class="score-gauge" style="--pct:${pct}">
      <div class="score-gauge__num">${total}<span>/ ${MAX_SCORE}</span></div>
    </div>
    <span class="score-hero__cat">${cat.label}</span>
    <p class="score-hero__line">${cat.headline}</p>
    <p class="score-hero__desc">${cat.desc}</p>
    <p class="score-hero__priority">${cat.priority}</p>
  `;
  root.appendChild(hero);

  const cardList = el("dl", "scorecard");
  Object.entries(DIMENSION_LABELS).forEach(([key, label]) => {
    const score = dims[key];
    if (score === undefined) return;
    let tagClass = "tag-gap", tagLabel = "🔴 Major Gap";
    if (score >= 10) { tagClass = "tag-strong"; tagLabel = "🟢 Strong"; }
    else if (score === 7) { tagClass = "tag-mid"; tagLabel = "🟠 Needs Improvement"; }
    const row = el("div", "scorecard__row");
    row.innerHTML = `<dt>${label}</dt><dd class="${tagClass}">${tagLabel}</dd>`;
    cardList.appendChild(row);
  });
  root.appendChild(cardList);

  let weakestKey = LEAK_PRIORITY.find((k) => dims[k] !== undefined);
  let weakestScore = dims[weakestKey] ?? 10;
  LEAK_PRIORITY.forEach((k) => {
    if (dims[k] !== undefined && dims[k] < weakestScore) {
      weakestScore = dims[k];
      weakestKey = k;
    }
  });

  const leak = el("div", "leak-card");
  leak.innerHTML = `
    <p class="leak-card__label">Your Biggest Potential Revenue Leak</p>
    <p>${LEAK_COPY[weakestKey] || "Your exhibition follow-up system has room to become more structured."}</p>
    <div class="leak-fix">
      <p class="leak-fix__label">What To Fix First</p>
      <p style="color:rgba(255,255,255,.8); font-family:inherit; font-weight:400; margin-top:8px;">For your highest-potential exhibition opportunities, record these four things immediately:</p>
      <ul>
        <li>₹ Opportunity Value</li>
        <li>Owner</li>
        <li>Exact Next Action</li>
        <li>Next Follow-up Date</li>
      </ul>
    </div>
  `;
  root.appendChild(leak);

  const actions = el("div", "results__actions");
  const reviewBtn = el("button", "btn btn--red js-open-review", "Request My Exhibition ROI Review →");
  actions.appendChild(reviewBtn);

  const shareWrap = el("div", "");
  shareWrap.style.marginTop = "18px";
  const waShareUrl = `https://wa.me/?text=${encodeURIComponent(`I just checked my Exhibition ROI Score — ${total}/${MAX_SCORE}. Worth checking yours too: ${location.href}`)}`;
  shareWrap.innerHTML = `<p style="font-size:13.5px; color:var(--ink-soft);">Know another exhibitor who should check this? <a href="${waShareUrl}" target="_blank" rel="noopener" style="color:var(--red); font-weight:700;">Share on WhatsApp</a></p>`;
  actions.appendChild(shareWrap);

  root.appendChild(actions);
}

/* ---------------- second-stage qualification ---------------- */

function renderQualify() {
  const root = $("#qualifyMount");
  root.innerHTML = `
    <div class="field">
      <label>Business Type</label>
      <div class="radio-row">
        ${["Manufacturing", "Services", "Trading", "Other"].map((v) => `<label><input type="radio" name="btype" value="${v}"> ${v}</label>`).join("")}
      </div>
    </div>
    <div class="field" style="margin-top:22px;">
      <label for="turnover">Approximate Annual Turnover</label>
      <select id="turnover">
        <option value="">Select</option>
        ${["Below ₹5 Cr", "₹5–10 Cr", "₹10–25 Cr", "₹25–50 Cr", "₹50–100 Cr", "₹100–200 Cr", "₹200 Cr+"].map((v) => `<option>${v}</option>`).join("")}
      </select>
    </div>
    <div class="field" style="margin-top:22px;">
      <label for="lastExpo">Which exhibition did you participate in most recently?</label>
      <input id="lastExpo" type="text" placeholder="e.g. Bharatiya Vyapar Mahotsav 2026">
    </div>
    <div class="field" style="margin-top:22px;">
      <label>Do you have another exhibition planned?</label>
      <div class="radio-row">
        ${["Yes", "No", "Considering"].map((v) => `<label><input type="radio" name="nextexpo" value="${v}"> ${v}</label>`).join("")}
      </div>
    </div>
    <div class="field" style="margin-top:22px;">
      <label for="openLeads">Approximate number of open exhibition leads / quotations</label>
      <select id="openLeads">
        <option value="">Select</option>
        ${["0–10", "11–25", "26–50", "51–100", "100+", "Not Sure"].map((v) => `<option>${v}</option>`).join("")}
      </select>
    </div>
    <div class="qualify__actions">
      <button class="btn btn--red" id="qualifySubmit">Personalise My Recommendation →</button>
      <button class="btn btn--link" id="qualifySkip">Skip for now</button>
    </div>
  `;

  const finish = (data) => {
    state.qualification = data;
    updateRoiLead({ qualification: data });
    trackEvent("qualification_completed", data || { skipped: true });
    saveState();
    document.getElementById("book").scrollIntoView({ behavior: "smooth" });
  };

  $("#qualifySubmit", root).addEventListener("click", () => {
    const data = {
      businessType: (root.querySelector('input[name="btype"]:checked') || {}).value || null,
      turnover: $("#turnover", root).value || null,
      lastExhibition: $("#lastExpo", root).value || null,
      nextExhibition: (root.querySelector('input[name="nextexpo"]:checked') || {}).value || null,
      openLeads: $("#openLeads", root).value || null,
    };
    finish(data);
  });
  $("#qualifySkip", root).addEventListener("click", () => finish(null));
}

/* ---------------- ROI review modal ---------------- */

const reviewModal = $("#reviewModal");
const reviewModalBody = $("#reviewModalBody");

function openReviewModal() {
  // Phase, not score: a legitimate score of 0 is falsy, and during "capture" the score
  // exists but has not been unlocked yet.
  if (state.phase !== "complete") {
    const atGate = state.phase === "capture";
    reviewModalBody.innerHTML = `
      <h3 id="reviewModalTitle">${atGate ? "You're one step away" : "Finish your Exhibition ROI Score first"}</h3>
      <p>${atGate
        ? "Your answers are in — enter your details to unlock your score, then request your review."
        : "We review actual scores, not blind requests. It takes about 2 minutes."}</p>
      <a class="btn btn--red btn--block" href="#assessment" id="reviewGoToAssessment">${atGate ? "Unlock My Score →" : "Continue My Assessment →"}</a>
    `;
    $("#reviewGoToAssessment", reviewModalBody).addEventListener("click", () => closeReviewModal());
  } else {
    reviewModalBody.innerHTML = `
      <h3 id="reviewModalTitle">Request My Exhibition ROI Review</h3>
      <p>Your score: <strong>${state.score}/${MAX_SCORE} — ${categoryFor(pctScore(state.score)).label}</strong></p>
      <div class="field">
        <label>What would you most like help with?</label>
        <div class="radio-row" id="helpOptions">
          ${["Lead Follow-Up", "Quotation Conversion", "CRM / Lead Management", "Upcoming Exhibition Planning", "Complete Exhibition ROI System", "Not Sure"].map((v) => `<label><input type="radio" name="help" value="${v}"> ${v}</label>`).join("")}
        </div>
      </div>
      <button class="btn btn--red btn--block" id="reviewSubmit">Request My Review →</button>
    `;
    $("#reviewSubmit", reviewModalBody).addEventListener("click", () => {
      const help = (reviewModalBody.querySelector('input[name="help"]:checked') || {}).value || null;
      updateRoiLead({ helpRequired: help, roiReviewRequested: true });
      trackEvent("roi_review_requested", { help });
      const waMsg = `Hi, I just completed the Exhibition ROI Score at roi.brandologist.in. My score is ${state.score}/${MAX_SCORE} and I'd like to discuss my Exhibition ROI Review.`;
      reviewModalBody.innerHTML = `
        <h3 id="reviewModalTitle">Request Received ✓</h3>
        <p>We've saved your Exhibition ROI Score and request. Our team can review the information you've shared before contacting you.</p>
        <a class="btn btn--ink btn--block" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waMsg)}" target="_blank" rel="noopener">Continue on WhatsApp →</a>
      `;
    });
  }
  reviewModal.hidden = false;
  trackEvent("roi_review_clicked", {});
}
function closeReviewModal() { reviewModal.hidden = true; }

document.addEventListener("click", (e) => {
  if (e.target.closest(".js-open-review")) openReviewModal();
});
$("#reviewModalClose").addEventListener("click", closeReviewModal);
reviewModal.addEventListener("click", (e) => { if (e.target === reviewModal) closeReviewModal(); });

/* ---------------- playbook early-access form ---------------- */

// #playbook is the shareable deep link for the book lead magnet — it can be sent
// on its own, so someone may land here having never seen the assessment. Record
// how they arrived so those leads are distinguishable in the table.
const PLAYBOOK_HASHES = ["#playbook", "#book", "#early-access"];
const arrivedViaPlaybookLink = PLAYBOOK_HASHES.includes(location.hash.toLowerCase());
function playbookSource() {
  if (arrivedViaPlaybookLink) return "playbook-direct-link";
  return state.score !== null ? "after-assessment" : "page-scroll";
}

if (arrivedViaPlaybookLink) {
  // Stop the browser restoring a previous scroll position after load — it fires
  // after our own positioning and silently undoes it, dumping deep-link visitors
  // back at the top of the page.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  // Re-anchor after load: the form sits ~8000px down a page full of lazy images,
  // so the browser's initial hash jump lands in the wrong place once those images
  // settle. Instant, not smooth — a deep link should arrive, not travel, and an
  // 8000px smooth scroll is both slow and easily interrupted.
  window.addEventListener("load", () => {
    const wrap = document.getElementById("playbookFormWrap");
    if (!wrap) return;
    const land = () => {
      // html{scroll-behavior:smooth} otherwise wins over behavior:"auto" in some
      // engines and the jump silently does nothing. Suspend it for the landing.
      const root = document.documentElement;
      const prev = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      const top = wrap.getBoundingClientRect().top + window.scrollY
        - Math.max(0, (window.innerHeight - wrap.offsetHeight) / 2);
      window.scrollTo(0, Math.max(0, top));
      root.style.scrollBehavior = prev;

      wrap.classList.add("is-highlighted");
      setTimeout(() => wrap.classList.remove("is-highlighted"), 2400);
      const input = document.getElementById("pb-contact");
      if (input && window.matchMedia("(min-width: 760px)").matches) input.focus({ preventScroll: true });
    };
    land();
    // one more pass on the next frame in case a late image shifted the layout
    requestAnimationFrame(land);
    trackEvent("playbook_link_landed", {});
  });
}

const playbookForm = document.getElementById("playbookForm");
const PB_MODES = {
  phone: { label: "WhatsApp number", placeholder: "e.g. +91 98765 43210", type: "tel", inputmode: "tel", autocomplete: "tel" },
  email: { label: "Email address", placeholder: "e.g. you@company.com", type: "email", inputmode: "email", autocomplete: "email" },
};
let pbMode = "phone";

function pbShowSuccess() {
  const wrap = document.getElementById("playbookFormWrap");
  if (wrap) {
    wrap.innerHTML = `<p class="playbook-form__success">You're on the early-access list. We'll be in touch the moment The Exhibition ROI Playbook is ready.</p>`;
  }
}

if (playbookForm) {
  const input = document.getElementById("pb-contact");
  const labelEl = document.getElementById("pbContactLabel");

  // One labelled input rather than two bare boxes — it was never visually obvious
  // that only one of the old two fields was needed.
  playbookForm.querySelectorAll(".pb-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pbMode = btn.dataset.mode;
      const cfg = PB_MODES[pbMode];
      playbookForm.querySelectorAll(".pb-toggle__btn").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      input.type = cfg.type;
      input.placeholder = cfg.placeholder;
      input.inputMode = cfg.inputmode;
      input.autocomplete = cfg.autocomplete;
      labelEl.textContent = cfg.label;
      input.value = "";
      document.getElementById("pbFormError").textContent = "";
      input.focus();
    });
  });

  playbookForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    const errorEl = document.getElementById("pbFormError");
    if (!value) {
      // not lowercased — "WhatsApp" is a brand name and must keep its casing
      errorEl.textContent = `Enter your ${PB_MODES[pbMode].label}.`;
      return;
    }
    if (pbMode === "phone" && value.replace(/\D/g, "").length < 8) {
      errorEl.textContent = "That doesn't look like a valid phone number.";
      return;
    }
    if (pbMode === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errorEl.textContent = "That doesn't look like a valid email address.";
      return;
    }
    errorEl.textContent = "";
    const phone = pbMode === "phone" ? value : null;
    const email = pbMode === "email" ? value : null;
    state.bookWaitlist = true;
    saveState();
    trackEvent("book_early_access_requested", { mode: pbMode });
    createPlaybookLead({
      contactMode: pbMode,
      phone,
      email,
      // carried through only if they already completed the assessment
      name: (state.lead && state.lead.name) || null,
      company: (state.lead && state.lead.company) || null,
      source: playbookSource(),
    });
    pbShowSuccess();
  });

  // state.bookWaitlist was persisted but never read back, so a returning visitor
  // saw an empty form as though they'd never asked.
  if (state.bookWaitlist) pbShowSuccess();
}

/* ---------------- CTA relabeling ---------------- */

function refreshPrimaryCtas() {
  const isDone = state.phase === "complete";
  document.querySelectorAll(".js-cta-primary").forEach((node) => {
    if (isDone) {
      // Keep the full/short label pair rather than setting textContent — a flat string
      // destroys the spans the header button relies on and the long label then
      // overflows the viewport on small screens.
      node.innerHTML =
        '<span class="cta-text-full">Request My Exhibition ROI Review →</span>' +
        '<span class="cta-text-short">Request My Review →</span>';
      node.classList.remove("js-cta-primary");
      node.classList.add("js-open-review");
      if (node.tagName === "A") node.removeAttribute("href");
    }
  });
}

document.querySelectorAll(".js-cta-primary").forEach((node) => {
  node.addEventListener("click", () => trackEvent("hero_cta_clicked", {}));
});

/* ---------------- proof gallery lightbox ---------------- */

const lightbox = $("#lightbox");
const lightboxImg = $("#lightboxImg");
$$("#proofGallery button").forEach((btn) => {
  btn.addEventListener("click", () => {
    lightboxImg.src = btn.dataset.full;
    lightboxImg.alt = btn.querySelector("img").alt;
    lightbox.hidden = false;
  });
});
function closeLightbox() { lightbox.hidden = true; lightboxImg.src = ""; }
$("#lightboxClose").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeLightbox(); closeReviewModal(); }
});

/* ---------------- sticky mobile CTA ---------------- */

const stickyCta = $("#stickyCta");
const hero = $(".hero");
const assessSection = $("#assessment");
// Tracked as state rather than read inside the observer: the phase now flips far down
// the page, long after .hero last intersected, so an observer-only check would leave
// the mobile CTA hidden until the visitor scrolled back to the top.
let heroOffScreen = false;
let assessOnScreen = false;

function syncStickyCta() {
  const wantsCta = state.phase !== "question" && state.phase !== "capture";
  stickyCta.classList.toggle("is-visible", heroOffScreen && !assessOnScreen && wantsCta);
}

new IntersectionObserver((entries) => {
  entries.forEach((entry) => { heroOffScreen = !entry.isIntersecting; });
  syncStickyCta();
}, { threshold: 0 }).observe(hero);

new IntersectionObserver((entries) => {
  entries.forEach((entry) => { assessOnScreen = entry.isIntersecting; });
  syncStickyCta();
}, { threshold: 0.2 }).observe(assessSection);


/* ---------------- shared exhibition and logo carousels ---------------- */

const CAROUSEL_SPEED = 4472;

if (window.Swiper) {
  new Swiper(".exhibition-swiper", {
    loop: true,
    slidesPerView: "auto",
    spaceBetween: 16,
    speed: CAROUSEL_SPEED,
    allowTouchMove: true,
    freeMode: { enabled: true, momentum: false },
    autoplay: { delay: 0, disableOnInteraction: false, pauseOnMouseEnter: false, reverseDirection: true },
    breakpoints: {
      0: { slidesPerView: 1.35, spaceBetween: 12 },
      801: { slidesPerView: 3.25, spaceBetween: 16 },
      1200: { slidesPerView: 4, spaceBetween: 16 },
      1600: { slidesPerView: 4.5, spaceBetween: 16 },
    },
  });

  new Swiper(".logo-swiper", {
    loop: true,
    slidesPerView: "auto",
    spaceBetween: 20,
    speed: CAROUSEL_SPEED,
    allowTouchMove: true,
    freeMode: { enabled: true, momentum: false },
    autoplay: { delay: 0, disableOnInteraction: false, pauseOnMouseEnter: false, reverseDirection: true },
  });
}

/* ---------------- init ---------------- */

trackEvent("landing_page_view", {});
renderAssess();
// Phase, not score: during "capture" a score exists but has not been unlocked, so
// keying this off state.score would let a page reload walk straight past the gate.
if (state.phase === "complete") revealResults();
