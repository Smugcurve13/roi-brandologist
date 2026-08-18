/* ==========================================================================
   Exhibition ROI Score — assessment engine, results, qualification, modal.
   No backend is connected yet: submitLead() is the single integration point —
   swap its body for a fetch('/api/lead', ...) once Supabase/Neon/a sheet is wired up.
   ========================================================================== */

const WHATSAPP_NUMBER = "919138998075";
const STORAGE_KEY = "roi_assessment_v1";
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
    id: "q5",
    prompt: "For serious opportunities, was the approximate ₹ potential business value recorded?",
    dimension: "opportunityValueTracking",
    options: [
      { label: "Yes — for almost every serious opportunity", score: 10 },
      { label: "For some opportunities", score: 7 },
      { label: "Rarely", score: 3 },
      { label: "No", score: 0 },
    ],
  },
  {
    id: "q6",
    prompt: "How quickly did meaningful follow-up begin after the exhibition?",
    dimension: null,
    options: [
      { label: "Within 24–48 hours", score: 10 },
      { label: "Within 3–5 days", score: 7 },
      { label: "After approximately one week", score: 3 },
      { label: "Follow-up was inconsistent", score: 0 },
    ],
  },
  {
    id: "q7",
    prompt: "Once a quotation was sent, was there a defined follow-up process until the opportunity was Won, Lost or Deferred?",
    dimension: "quotationFollowUp",
    options: [
      { label: "Yes", score: 10 },
      { label: "Usually", score: 7 },
      { label: "Depends on the salesperson", score: 3 },
      { label: "No structured process", score: 0 },
    ],
  },
  {
    id: "q8",
    prompt: "Are your highest-value exhibition prospects receiving different follow-up from general enquiries?",
    dimension: null,
    options: [
      { label: "Yes — clearly", score: 10 },
      { label: "Sometimes", score: 7 },
      { label: "Very little differentiation", score: 3 },
      { label: "Everyone receives roughly the same follow-up", score: 0 },
    ],
  },
  {
    id: "q9",
    prompt: "Do you currently have exhibition enquiries or quotations that haven't converted yet?",
    dimension: null,
    qualification: true,
    options: [
      { label: "Yes — quite a few", score: 5 },
      { label: "A few", score: 7 },
      { label: "I'm not sure", score: 2 },
      { label: "No", score: 10 },
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

const state = loadState() || {
  phase: "question", // question | capture | saved | complete
  currentQuestion: 1,
  answers: {},
  lead: null,
  investment: null,
  confirmedBusiness: null,
  score: null,
  category: null,
  qualification: null,
  bookWaitlist: false,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
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

function submitLead(payload) {
  trackEvent("lead_saved", payload);
  try {
    const existing = JSON.parse(localStorage.getItem("roi_leads") || "[]");
    existing.push({ ...payload, savedAt: new Date().toISOString() });
    localStorage.setItem("roi_leads", JSON.stringify(existing));
  } catch (e) {}
  // ponytail: silently no-ops until SHEET_WEBHOOK_URL is set (see apps-script-webhook.gs).
  if (SHEET_WEBHOOK_URL) {
    // text/plain avoids a CORS preflight Apps Script doesn't handle; doPost still JSON.parses the body.
    fetch(SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
}

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
  mount.innerHTML = "";
  if (state.phase === "question") return renderQuestion();
  if (state.phase === "capture") return renderCapture();
  if (state.phase === "saved") return renderSaved();
  if (state.phase === "complete") return renderComplete();
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
  fill.style.width = `${(qNum / 10) * 100}%`;
  bar.appendChild(fill);
  container.appendChild(bar);
  container.appendChild(el("p", "progress__label", `Question ${qNum} of 10`));
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

  if (q.qualification) {
    const note = el("div", "q-note");
    note.hidden = true;
    note.innerHTML = `<strong>You may not need more leads yet.</strong> You may first need a stronger conversion system for the opportunities you already have.`;
    card.appendChild(note);
    card.dataset.qualNote = "1";
  }

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

  if (q.id === "q9" && opt.score !== 10) {
    const note = $(`.q-card[data-qual-note] .q-note`) || $(".q-note", mount);
    if (note) {
      note.hidden = false;
      $$(".opt", mount).forEach((b) => b.disabled = true);
      const evtLabel = state.answers.q9.label;
      const matched = $$(".opt", mount).find((b) => b.textContent === evtLabel);
      if (matched) matched.classList.add("opt--selected");
      setTimeout(advanceAfterQuestion, 1400);
      return;
    }
  }
  advanceAfterQuestion();
}

function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function advanceAfterQuestion() {
  if (state.currentQuestion === 2) {
    state.phase = "capture";
    saveState();
    return renderAssess();
  }
  if (state.currentQuestion === 10) {
    finishAssessment();
    return;
  }
  state.currentQuestion += 1;
  saveState();
  renderAssess();
}

function renderCapture() {
  const card = el("div", "capture-card");
  card.innerHTML = `
    <h3>Good. We're already seeing a pattern.</h3>
    <p>Let's calculate your complete Exhibition ROI Score. Enter your details so we can save your assessment and show your complete score and recommendations.</p>
  `;
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
    <button type="submit" class="btn btn--red btn--block">Continue My ROI Score →</button>
    <p class="hero__micro" style="color:rgba(255,255,255,.55); text-align:center;">Your assessment will continue from Question 3.</p>
    <p class="consent">By continuing, you agree to receive your Exhibition ROI result and relevant follow-up on WhatsApp.</p>
  `;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#lead-name", form).value.trim();
    const company = $("#lead-company", form).value.trim();
    const whatsapp = $("#lead-whatsapp", form).value.trim();
    if (!name || !company || whatsapp.replace(/\D/g, "").length < 8) {
      $("#captureError", form).textContent = "Please fill in all fields with a valid WhatsApp number.";
      return;
    }
    state.lead = { name, company, whatsapp };
    trackEvent("lead_captured", state.lead);
    submitLead({
      ...state.lead,
      q1: state.answers.q1?.label,
      q2: state.answers.q2?.label,
      investment: state.investment,
      confirmedBusiness: state.confirmedBusiness,
      assessmentStatus: "INCOMPLETE",
      lastQuestionCompleted: 2,
      utmSource: new URLSearchParams(location.search).get("utm_source") || null,
      utmCampaign: new URLSearchParams(location.search).get("utm_campaign") || null,
      landingPageSource: document.referrer || null,
    });
    state.phase = "saved";
    saveState();
    renderAssess();
    setTimeout(() => {
      state.phase = "question";
      state.currentQuestion = 3;
      saveState();
      renderAssess();
    }, 1100);
  });
  card.appendChild(form);
  mount.appendChild(card);
}

function renderSaved() {
  const wrap = el("div", "saved-flash");
  wrap.innerHTML = `
    <div class="saved-flash__check">✓</div>
    <h3>Assessment Saved</h3>
    <p style="color:rgba(255,255,255,.7); margin-top:8px;">You're only a few questions away from your complete Exhibition ROI Score.</p>
  `;
  mount.appendChild(wrap);
}

function finishAssessment() {
  let total = 0;
  const dims = {};
  Object.entries(state.answers).forEach(([id, a]) => {
    total += a.score;
    if (a.dimension) dims[a.dimension] = a.score;
  });
  state.score = total;
  state.category = categoryFor(total).key;
  state.phase = "complete";

  submitLead({
    ...state.lead,
    answers: Object.fromEntries(Object.entries(state.answers).map(([k, v]) => [k, v.label])),
    investment: state.investment,
    confirmedBusiness: state.confirmedBusiness,
    totalScore: total,
    resultCategory: state.category,
    assessmentStatus: "COMPLETE",
  });
  trackEvent("assessment_completed", { score: total });
  trackEvent("score_viewed", { score: total });

  saveState();
  renderAssess();
  renderResults(total, dims);
  document.getElementById("results").hidden = false;
  document.getElementById("qualifySection").hidden = false;
  renderQualify();
  refreshPrimaryCtas();
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
  const cat = categoryFor(total);
  const root = $("#resultsMount");
  root.innerHTML = "";

  const hero = el("div", "score-hero");
  hero.innerHTML = `
    <p class="eyebrow">Your Exhibition ROI Score</p>
    <div class="score-gauge" style="--pct:${total}">
      <div class="score-gauge__num">${total}<span>/ 100</span></div>
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
  const waShareUrl = `https://wa.me/?text=${encodeURIComponent(`I just checked my Exhibition ROI Score — ${total}/100. Worth checking yours too: ${location.href}`)}`;
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
    submitLead({ ...(state.lead || {}), qualification: data, totalScore: state.score });
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
  if (!state.score) {
    reviewModalBody.innerHTML = `
      <h3 id="reviewModalTitle">Finish your Exhibition ROI Score first</h3>
      <p>We review actual scores, not blind requests. It takes about 3 minutes and your first two answers are already saved.</p>
      <a class="btn btn--red btn--block" href="#assessment" id="reviewGoToAssessment">Continue My Assessment →</a>
    `;
    $("#reviewGoToAssessment", reviewModalBody).addEventListener("click", () => closeReviewModal());
  } else {
    reviewModalBody.innerHTML = `
      <h3 id="reviewModalTitle">Request My Exhibition ROI Review</h3>
      <p>Your score: <strong>${state.score}/100 — ${categoryFor(state.score).label}</strong></p>
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
      submitLead({ ...(state.lead || {}), totalScore: state.score, helpRequired: help, roiReviewRequested: true });
      trackEvent("roi_review_requested", { help });
      const waMsg = `Hi, I just completed the Exhibition ROI Score at roi.brandologist.in. My score is ${state.score}/100 and I'd like to discuss my Exhibition ROI Review.`;
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

/* ---------------- book waitlist ---------------- */

const bookWaitlistEl = document.getElementById("bookWaitlist");
if (bookWaitlistEl) {
  bookWaitlistEl.addEventListener("change", () => {
    state.bookWaitlist = bookWaitlistEl.checked;
    saveState();
    if (bookWaitlistEl.checked) {
      trackEvent("book_waitlist_joined", {});
      submitLead({ ...(state.lead || {}), bookWaitlist: true });
    }
  });
}

/* ---------------- CTA relabeling ---------------- */

function refreshPrimaryCtas() {
  const isDone = !!state.score;
  document.querySelectorAll(".js-cta-primary").forEach((node) => {
    if (isDone) {
      node.textContent = "Request My Exhibition ROI Review →";
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
const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.target === hero) {
      stickyCta.classList.toggle("is-visible", !entry.isIntersecting && state.phase !== "question" && state.phase !== "capture");
    }
  });
}, { threshold: 0 });
io.observe(hero);
new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) stickyCta.classList.remove("is-visible");
  });
}, { threshold: 0.2 }).observe(assessSection);

/* ---------------- init ---------------- */

trackEvent("landing_page_view", {});
renderAssess();
if (state.score) {
  const dims = {};
  Object.values(state.answers).forEach((a) => { if (a.dimension) dims[a.dimension] = a.score; });
  document.getElementById("results").hidden = false;
  document.getElementById("qualifySection").hidden = false;
  renderResults(state.score, dims);
  renderQualify();
  refreshPrimaryCtas();
}
