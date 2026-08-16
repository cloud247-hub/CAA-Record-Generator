const $ = (id) => document.getElementById(id);
const domainEl = $("domain");
const customCaEl = $("customCa");
const wildcardEl = $("wildcard");
const blockWildcardEl = $("blockWildcard");
const iodefEl = $("iodef");
const recordsEl = $("records");
const zoneEl = $("zoneOutput");
const summaryEl = $("summary");
const toastEl = $("toast");
const scanStatusEl = $("scanStatus");
const analysisResultsEl = $("analysisResults");
const autoGenerateBtn = $("autoGenerateBtn");
const autoButtonText = $("autoButtonText");
let currentRecords = [];

const PRESETS = new Set(["letsencrypt.org", "digicert.com", "pki.goog", "sectigo.com", "globalsign.com", "amazon.com"]);
const FALLBACK_ISSUER_MAP = [
  [/let'?s encrypt/i, "letsencrypt.org"],
  [/digicert|geotrust|thawte/i, "digicert.com"],
  [/google trust|\bgts\b/i, "pki.goog"],
  [/sectigo|comodo|usertrust/i, "sectigo.com"],
  [/globalsign/i, "globalsign.com"],
  [/amazon/i, "amazon.com"]
];

function normalizeDomain(value) {
  let v = value.trim().toLowerCase();
  if (!v) return "";
  try {
    if (/^https?:\/\//i.test(v)) v = new URL(v).hostname;
  } catch {}
  v = v.replace(/^www\./, "").replace(/\.$/, "").split(/[/?#]/)[0];
  return v;
}

function validDomain(value) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function cleanCa(value) {
  return value.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/^\"|\"$/g, "").replace(/\/$/, "");
}

function customCas() {
  return [...new Set(customCaEl.value.split(/[\n,]+/).map(cleanCa).filter(Boolean))];
}

function selectedCas() {
  const values = [...document.querySelectorAll('#caOptions input:checked')].map(i => ({name:i.dataset.name, value:i.value}));
  customCas().forEach(custom => {
    if (!values.some(v => v.value === custom)) values.push({name:"Egendefinert CA", value:custom});
  });
  return values;
}

function buildRecords() {
  const domain = normalizeDomain(domainEl.value);
  if (!validDomain(domain)) throw new Error("Skriv inn et gyldig domene, for eksempel example.com.");
  const cas = selectedCas();
  if (!cas.length) throw new Error("Velg minst én sertifikatutsteder eller skriv inn en egendefinert CA.");
  const records = [];
  cas.forEach(ca => records.push({host:domain,type:"CAA",flags:0,tag:"issue",value:ca.value,label:ca.name}));
  if (wildcardEl.checked) {
    cas.forEach(ca => records.push({host:domain,type:"CAA",flags:0,tag:"issuewild",value:ca.value,label:`${ca.name} – wildcard`}));
  } else if (blockWildcardEl.checked) {
    records.push({host:domain,type:"CAA",flags:0,tag:"issuewild",value:";",label:"Blokker wildcard"});
  }
  const email = iodefEl.value.trim();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("IODEF-adressen ser ikke ut som en gyldig e-postadresse.");
    records.push({host:domain,type:"CAA",flags:0,tag:"iodef",value:`mailto:${email}`,label:"IODEF varsling"});
  }
  return {domain, cas, records};
}

function recordLine(r) {
  return `${r.host}. CAA ${r.flags} ${r.tag} "${r.value}"`;
}

function render() {
  try {
    const {domain, cas, records} = buildRecords();
    currentRecords = records;
    summaryEl.innerHTML = `<strong>${records.length} CAA-post${records.length === 1 ? "" : "er"} for ${escapeHtml(domain)}</strong><span>${cas.map(c => escapeHtml(c.name)).join(", ")} er autorisert for vanlige sertifikater${wildcardEl.checked ? " og wildcard-sertifikater" : ". Wildcard er ikke autorisert"}.</span>`;
    recordsEl.innerHTML = records.map((r, idx) => `
      <div class="record">
        <div class="record-main">
          <div class="record-title"><strong>${escapeHtml(r.label)}</strong><span class="badge">${r.tag}</span></div>
          <div class="record-value">${escapeHtml(recordLine(r))}</div>
        </div>
        <button class="copy-record" data-copy="${idx}" type="button">Kopier</button>
      </div>`).join("");
    zoneEl.textContent = records.map(recordLine).join("\n");
    document.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", () => copyText(recordLine(records[Number(btn.dataset.copy)]), "CAA-posten er kopiert")));
  } catch (err) {
    currentRecords = [];
    recordsEl.innerHTML = `<div class="notice"><strong>Kan ikke generere ennå</strong><p>${escapeHtml(err.message)}</p></div>`;
    zoneEl.textContent = "";
    summaryEl.innerHTML = `<strong>Kontroller innstillingene</strong><span>${escapeHtml(err.message)}</span>`;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function queryExistingCaa(domain) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=CAA&do=true`;
  const response = await fetchWithTimeout(url, {headers:{Accept:"application/dns-json"}}, 10000);
  const data = await response.json();
  const answers = Array.isArray(data.Answer) ? data.Answer.filter(a => a.type === 257) : [];
  return {
    dnssec: data.AD === true,
    status: data.Status,
    records: answers.map(a => parseCaaData(a.data)).filter(Boolean)
  };
}

function parseCaaData(data) {
  const match = String(data).match(/^(\d+)\s+([A-Za-z0-9-]+)\s+"([^"]*)"/);
  if (!match) return {raw:String(data)};
  return {flags:Number(match[1]), tag:match[2].toLowerCase(), value:match[3], raw:String(data)};
}

async function queryCertSpotter(domain) {
  const base = new URL("https://api.certspotter.com/v1/issuances");
  base.searchParams.set("domain", domain);
  base.searchParams.set("include_subdomains", "true");
  base.searchParams.set("match_wildcards", "true");
  base.searchParams.append("expand", "dns_names");
  base.searchParams.append("expand", "issuer");
  base.searchParams.append("expand", "issuer.caa_domains");

  const results = [];
  let after = "";
  let truncated = false;
  for (let page = 0; page < 8; page++) {
    const url = new URL(base);
    if (after) url.searchParams.set("after", after);
    const response = await fetchWithTimeout(url.toString(), {}, 15000);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Uventet svar fra sertifikattjenesten.");
    if (!batch.length) break;
    results.push(...batch);
    after = batch[batch.length - 1]?.id || "";
    if (!after) break;
    if (page === 7) truncated = true;
  }
  return {source:"Cert Spotter", issuances:results, truncated};
}

async function queryCrtSh(domain) {
  const query = `%.${domain}`;
  const url = `https://crt.sh/?q=${encodeURIComponent(query)}&output=json`;
  const response = await fetchWithTimeout(url, {}, 18000);
  const rows = await response.json();
  const normalized = (Array.isArray(rows) ? rows : []).map(row => {
    const issuerName = row.issuer_name || "Ukjent utsteder";
    const caa = fallbackCaaDomain(issuerName);
    return {
      id:String(row.id || row.min_cert_id || ""),
      dns_names:String(row.name_value || row.common_name || "").split(/\n+/).filter(Boolean),
      issuer:{friendly_name:issuerName, caa_domains:caa ? [caa] : null},
      not_before:row.not_before,
      not_after:row.not_after,
      revoked:false
    };
  });
  return {source:"crt.sh (reserve)", issuances:normalized, truncated:false};
}

function fallbackCaaDomain(name) {
  for (const [pattern, value] of FALLBACK_ISSUER_MAP) if (pattern.test(name || "")) return value;
  return null;
}

function chooseCaaDomain(issuer) {
  const domains = Array.isArray(issuer?.caa_domains) ? issuer.caa_domains.map(cleanCa).filter(Boolean) : [];
  const preferred = domains.find(d => PRESETS.has(d));
  return preferred || domains[0] || fallbackCaaDomain(issuer?.friendly_name || issuer?.name || "");
}

function normalizeIssuances(raw) {
  const now = Date.now();
  const seen = new Set();
  return raw.filter(cert => {
    const key = cert.id || cert.cert_sha256 || `${cert.not_after}|${cert.issuer?.friendly_name}|${(cert.dns_names || []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const expiry = cert.not_after ? Date.parse(cert.not_after) : NaN;
    return cert.revoked !== true && (!Number.isFinite(expiry) || expiry > now);
  });
}

function buildIssuerAnalysis(issuances) {
  const map = new Map();
  issuances.forEach(cert => {
    const name = cert.issuer?.friendly_name || cert.issuer?.name || "Ukjent utsteder";
    const caa = chooseCaaDomain(cert.issuer);
    const key = `${name}|${caa || ""}`;
    if (!map.has(key)) map.set(key, {name, caa, count:0, latestExpiry:null});
    const item = map.get(key);
    item.count++;
    const expiry = cert.not_after ? Date.parse(cert.not_after) : NaN;
    if (Number.isFinite(expiry) && (!item.latestExpiry || expiry > item.latestExpiry)) item.latestExpiry = expiry;
  });
  return [...map.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
}

function applyAutoPolicy(issuers, wildcardObserved) {
  const caaDomains = [...new Set(issuers.map(i => i.caa).filter(Boolean))];
  document.querySelectorAll('#caOptions input').forEach(input => {
    input.checked = caaDomains.includes(input.value);
  });
  const custom = caaDomains.filter(d => !PRESETS.has(d));
  customCaEl.value = custom.join("\n");
  wildcardEl.checked = wildcardObserved;
  blockWildcardEl.checked = !wildcardObserved;
  updateWildcardUi();
  render();
  return caaDomains;
}

async function autoAnalyze() {
  const domain = normalizeDomain(domainEl.value);
  if (!validDomain(domain)) {
    toast("Skriv inn et gyldig domene først");
    domainEl.focus();
    return;
  }
  domainEl.value = domain;
  setAutoLoading(true);
  analysisResultsEl.hidden = true;
  scanStatusEl.hidden = false;
  scanStatusEl.className = "scan-status scanning";
  scanStatusEl.innerHTML = `<span class="spinner" aria-hidden="true"></span><div><strong>Analyserer ${escapeHtml(domain)}</strong><span>Sjekker DNS og Certificate Transparency…</span></div>`;

  let dns = {records:[], dnssec:false, error:null};
  let certData = null;
  let certError = null;

  try { dns = await queryExistingCaa(domain); }
  catch (err) { dns = {records:[], dnssec:false, error:err.message}; }

  try {
    certData = await queryCertSpotter(domain);
  } catch (primaryError) {
    try { certData = await queryCrtSh(domain); }
    catch (fallbackError) { certError = `${primaryError.message}; reservekilde: ${fallbackError.message}`; }
  }

  if (!certData) {
    setAutoLoading(false);
    scanStatusEl.className = "scan-status error";
    scanStatusEl.innerHTML = `<div><strong>Kunne ikke hente sertifikatdata</strong><span>${escapeHtml(certError || "Ukjent feil")}. Du kan fortsatt bygge policyen manuelt.</span></div>`;
    renderDnsOnlyAnalysis(domain, dns);
    return;
  }

  const issuances = normalizeIssuances(certData.issuances);
  const issuers = buildIssuerAnalysis(issuances);
  const wildcardObserved = issuances.some(cert => (cert.dns_names || []).some(name => String(name).startsWith("*.")));
  const mappedIssuers = issuers.filter(i => i.caa);
  const unmappedIssuers = issuers.filter(i => !i.caa);
  let applied = [];
  if (mappedIssuers.length) applied = applyAutoPolicy(mappedIssuers, wildcardObserved);

  setAutoLoading(false);
  scanStatusEl.hidden = true;
  renderAnalysis({domain, dns, certData, issuances, issuers, mappedIssuers, unmappedIssuers, wildcardObserved, applied});
  analysisResultsEl.scrollIntoView({behavior:"smooth", block:"nearest"});
}

function renderDnsOnlyAnalysis(domain, dns) {
  analysisResultsEl.hidden = false;
  analysisResultsEl.innerHTML = `
    <div class="analysis-grid">
      ${metric("Eksisterende CAA", dns.records.length, dns.records.length ? "DNS-poster funnet" : "Ingen poster funnet")}
      ${metric("DNSSEC", dns.error ? "?" : (dns.dnssec ? "Ja" : "Nei"), dns.error ? "DNS-sjekk feilet" : "AD-validering")}
    </div>`;
}

function renderAnalysis(ctx) {
  const {domain, dns, certData, issuances, issuers, unmappedIssuers, wildcardObserved, applied} = ctx;
  const existingAuth = dns.records.filter(r => r.tag === "issue" || r.tag === "issuewild");
  const missingExisting = existingAuth.filter(r => r.value && r.value !== ";" && !applied.includes(cleanCa(r.value)));
  const issuerRows = issuers.length ? issuers.map(item => `
    <div class="issuer-row">
      <div><strong>${escapeHtml(item.name)}</strong><span>${item.count} u-utløpt${item.count === 1 ? "" : "e"} utstedelse${item.count === 1 ? "" : "r"}</span></div>
      <div class="issuer-caa">${item.caa ? `<code>${escapeHtml(item.caa)}</code>` : `<span class="unresolved">CAA-ID ikke funnet</span>`}</div>
    </div>`).join("") : `<p class="empty-analysis">Ingen u-utløpte sertifikatutstedelser ble funnet for ${escapeHtml(domain)}.</p>`;

  const existingRows = dns.records.length ? dns.records.map(r => `<code class="dns-pill">${escapeHtml(r.raw)}</code>`).join("") : `<span class="muted-text">Ingen CAA-poster funnet på det eksakte domenenavnet.</span>`;

  const warnings = [];
  if (certData.truncated) warnings.push("Domenet har mange sertifikater. Analysen stoppet etter åtte API-sider og kan være ufullstendig.");
  if (unmappedIssuers.length) warnings.push(`${unmappedIssuers.length} utsteder${unmappedIssuers.length === 1 ? "" : "e"} mangler kjent CAA-identifikator og ble ikke lagt til automatisk.`);
  if (missingExisting.length) warnings.push(`${missingExisting.length} eksisterende CAA-autorisasjon${missingExisting.length === 1 ? "" : "er"} ble ikke observert blant u-utløpte sertifikater og er ikke med i auto-forslaget.`);
  if (!issuances.length) warnings.push("Ingen u-utløpte CT-sertifikater ble funnet. Eksisterende manuelle valg er derfor ikke overskrevet.");
  if (dns.error) warnings.push("Eksisterende CAA kunne ikke leses fra DNS i denne analysen.");

  analysisResultsEl.hidden = false;
  analysisResultsEl.innerHTML = `
    <div class="analysis-header">
      <div>
        <p class="kicker">ANALYSE FULLFØRT</p>
        <h3>Forslag for ${escapeHtml(domain)}</h3>
      </div>
      <span class="source-badge">${escapeHtml(certData.source)}</span>
    </div>
    <div class="analysis-grid">
      ${metric("Sertifikater", issuances.length, "u-utløpte CT-utstedelser")}
      ${metric("Utstedere", issuers.length, `${applied.length} CAA-ID${applied.length === 1 ? "" : "er"} valgt`)}
      ${metric("Wildcard", wildcardObserved ? "Ja" : "Nei", wildcardObserved ? "observert i sertifikater" : "ikke observert")}
      ${metric("Eksisterende CAA", dns.records.length, dns.error ? "DNS-sjekk feilet" : (dns.dnssec ? "DNSSEC-validert svar" : "DNS-svar"))}
    </div>
    <div class="analysis-columns">
      <div class="analysis-box">
        <h4>Observerte sertifikatutstedere</h4>
        ${issuerRows}
      </div>
      <div class="analysis-box">
        <h4>CAA i DNS nå</h4>
        <div class="dns-pills">${existingRows}</div>
      </div>
    </div>
    ${warnings.length ? `<div class="analysis-warning"><strong>Kontroller før publisering</strong><ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>` : ""}
    <p class="analysis-footnote">Auto-forslaget er konservativt og analyserer også underdomener. Certificate Transparency viser sertifikater som er utstedt og fortsatt gyldige, ikke nødvendigvis sertifikatet som serveres aktivt akkurat nå.</p>`;
}

function metric(label, value, detail) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function setAutoLoading(loading) {
  autoGenerateBtn.disabled = loading;
  autoGenerateBtn.classList.toggle("loading", loading);
  autoButtonText.textContent = loading ? "Analyserer…" : "Analyser og auto-generer";
}

function updateWildcardUi() {
  blockWildcardEl.closest(".switch-row").style.opacity = wildcardEl.checked ? ".45" : "1";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

async function copyText(text, message) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast(message);
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

$("autoGenerateBtn").addEventListener("click", autoAnalyze);
$("generateBtn").addEventListener("click", render);
$("copyAll").addEventListener("click", () => copyText(currentRecords.map(recordLine).join("\n"), "Alle CAA-poster er kopiert"));
$("copyZone").addEventListener("click", () => copyText(zoneEl.textContent, "Zone file-format er kopiert"));
wildcardEl.addEventListener("change", () => { updateWildcardUi(); render(); });
[domainEl, customCaEl, iodefEl].forEach(el => el.addEventListener("change", render));
document.querySelectorAll('#caOptions input').forEach(el => el.addEventListener("change", render));
blockWildcardEl.addEventListener("change", render);
$("year").textContent = new Date().getFullYear();
updateWildcardUi();
render();
