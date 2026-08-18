/**
 * Exhibition ROI Score — lead webhook.
 * Standalone script (not container-bound) — opens the sheet by ID directly,
 * since the Extensions > Apps Script container-bound flow can hit a stale
 * Google redirect bug across multi-account browser profiles.
 * Setup: script.google.com -> New project -> paste this, replacing any existing code ->
 * Deploy > New deployment > type "Web app" ->
 * Execute as: Me | Who has access: Anyone -> Deploy -> authorize when prompted.
 * Copy the resulting Web App URL and send it back so it can be wired into the site.
 */
var SHEET_ID = "1lu3CwWG3J6bou7HGt8yreokRh4Id0H1jCljCfUc-KRM";

function doPost(e) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var data = JSON.parse(e.postData.contents);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyMap = {
    timestamp: new Date(),
    name: data.name || "",
    company: data.company || "",
    whatsapp: data.whatsapp || "",
    q1: (data.answers && data.answers.q1) || data.q1 || "",
    q2: (data.answers && data.answers.q2) || data.q2 || "",
    q3: (data.answers && data.answers.q3) || "",
    q4: (data.answers && data.answers.q4) || "",
    q5: (data.answers && data.answers.q5) || "",
    q6: (data.answers && data.answers.q6) || "",
    q7: (data.answers && data.answers.q7) || "",
    q8: (data.answers && data.answers.q8) || "",
    q9: (data.answers && data.answers.q9) || "",
    q10: (data.answers && data.answers.q10) || "",
    investment: data.investment || "",
    confirmed_business: data.confirmedBusiness || "",
    total_score: data.totalScore || "",
    result_category: data.resultCategory || "",
    assessment_status: data.assessmentStatus || "",
    last_question_completed: data.lastQuestionCompleted || "",
    business_type: (data.qualification && data.qualification.businessType) || "",
    turnover_band: (data.qualification && data.qualification.turnover) || "",
    last_exhibition: (data.qualification && data.qualification.lastExhibition) || "",
    next_exhibition: (data.qualification && data.qualification.nextExhibition) || "",
    open_leads: (data.qualification && data.qualification.openLeads) || "",
    help_required: data.helpRequired || "",
    book_waitlist: data.bookWaitlist || "",
    book_phone: data.bookPhone || "",
    book_email: data.bookEmail || "",
    roi_review_requested: data.roiReviewRequested || "",
    utm_source: data.utmSource || "",
    utm_campaign: data.utmCampaign || "",
    landing_page_source: data.landingPageSource || "",
  };
  var row = headers.map(function (h) {
    return keyMap[h] !== undefined ? keyMap[h] : "";
  });
  sheet.appendRow(row);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON
  );
}
