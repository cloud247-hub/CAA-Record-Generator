(function () {
  "use strict";

  const converter = window.EntraSidConverter;
  const EXAMPLE_OBJECT_ID = "73d664e4-0886-4a73-9731-8146e010541d";
  const EXAMPLE_SID = "S-1-12-1-1943430372-1249052806-1182871959-492048608";

  let mode = "object-to-sid";
  let lastResult = "";
  let batchResults = [];
  let toastTimer;

  const elements = {
    form: document.getElementById("converter-form"),
    directionButtons: [...document.querySelectorAll(".direction-button")],
    sourceInput: document.getElementById("source-input"),
    sourceLabel: document.getElementById("source-label"),
    sourceHelp: document.getElementById("source-help"),
    sourceError: document.getElementById("source-error"),
    resultPanel: document.getElementById("result-panel"),
    resultLabel: document.getElementById("result-label"),
    resultStatus: document.getElementById("result-status"),
    resultOutput: document.getElementById("result-output"),
    resultNote: document.getElementById("result-note"),
    copyResultButton: document.getElementById("copy-result-button"),
    exampleButton: document.getElementById("example-button"),
    swapButton: document.getElementById("swap-button"),
    clearButton: document.getElementById("clear-button"),
    batchInput: document.getElementById("batch-input"),
    batchConvertButton: document.getElementById("batch-convert-button"),
    batchCopyButton: document.getElementById("batch-copy-button"),
    batchDownloadButton: document.getElementById("batch-download-button"),
    batchMessage: document.getElementById("batch-message"),
    batchTableWrap: document.getElementById("batch-table-wrap"),
    batchTableBody: document.getElementById("batch-table-body"),
    year: document.getElementById("year"),
    toast: document.getElementById("toast")
  };

  function setMode(nextMode, options = {}) {
    mode = nextMode;
    elements.directionButtons.forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    const objectToSid = mode === "object-to-sid";
    elements.sourceLabel.textContent = objectToSid ? "Microsoft Entra Object ID" : "Windows SID";
    elements.sourceInput.placeholder = objectToSid ? EXAMPLE_OBJECT_ID : EXAMPLE_SID;
    elements.sourceHelp.textContent = objectToSid
      ? "Et GUID med 32 heksadesimale tegn. Bindestreker og klammeparenteser er valgfrie."
      : "Formatet må være S-1-12-1 etterfulgt av fire usignerte 32-bits heltall.";
    elements.resultLabel.textContent = objectToSid ? "Windows SID" : "Microsoft Entra Object ID";
    elements.resultNote.innerHTML = objectToSid
      ? "Resultatet bruker Windows-formatet <code>S-1-12-1</code>. Konverteringen validerer ikke objektet mot Microsoft Entra."
      : "Kun SID-er med prefikset <code>S-1-12-1</code> og fire 32-bits delverdier kan konverteres tilbake til et Object ID.";

    clearValidation();
    resetResult();
    clearBatchResults();

    if (options.focus !== false) elements.sourceInput.focus();
  }

  function clearValidation() {
    elements.sourceError.textContent = "";
    elements.sourceInput.removeAttribute("aria-invalid");
  }

  function showValidation(message) {
    elements.sourceError.textContent = message;
    elements.sourceInput.setAttribute("aria-invalid", "true");
  }

  function resetResult() {
    lastResult = "";
    elements.resultPanel.dataset.state = "empty";
    elements.resultStatus.textContent = "Venter på verdi";
    elements.resultOutput.textContent = "Resultatet vises her";
    elements.copyResultButton.disabled = true;
  }

  function renderSuccess(value) {
    lastResult = value;
    elements.resultPanel.dataset.state = "success";
    elements.resultStatus.textContent = "Konvertert";
    elements.resultOutput.textContent = value;
    elements.copyResultButton.disabled = false;
  }

  function renderError(message) {
    lastResult = "";
    elements.resultPanel.dataset.state = "error";
    elements.resultStatus.textContent = "Ugyldig verdi";
    elements.resultOutput.textContent = message;
    elements.copyResultButton.disabled = true;
  }

  function runConversion() {
    clearValidation();
    const value = elements.sourceInput.value.trim();
    if (!value) {
      const message = mode === "object-to-sid" ? "Skriv inn et Object ID." : "Skriv inn en SID.";
      showValidation(message);
      renderError(message);
      elements.sourceInput.focus();
      return;
    }

    try {
      const result = converter.convert(value, mode);
      elements.sourceInput.value = mode === "object-to-sid"
        ? converter.normalizeObjectId(value)
        : converter.normalizeSid(value);
      renderSuccess(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verdien kunne ikke konverteres.";
      showValidation(message);
      renderError(message);
    }
  }

  async function copyText(text, successMessage) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(successMessage);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
  }

  function swapDirection() {
    const hadResult = Boolean(lastResult);
    const valueToCarry = lastResult || elements.sourceInput.value.trim();
    setMode(mode === "object-to-sid" ? "sid-to-object" : "object-to-sid", { focus: false });
    elements.sourceInput.value = valueToCarry;
    elements.sourceInput.focus();
    if (hadResult) runConversion();
  }

  function clearAll() {
    elements.sourceInput.value = "";
    clearValidation();
    resetResult();
    elements.sourceInput.focus();
  }

  function clearBatchResults() {
    batchResults = [];
    elements.batchTableBody.replaceChildren();
    elements.batchTableWrap.hidden = true;
    elements.batchCopyButton.disabled = true;
    elements.batchDownloadButton.disabled = true;
    elements.batchMessage.textContent = "";
  }

  function convertBatch() {
    clearBatchResults();
    const lines = elements.batchInput.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      elements.batchMessage.textContent = "Lim inn minst én verdi.";
      return;
    }
    if (lines.length > 250) {
      elements.batchMessage.textContent = "Maksimalt 250 verdier kan konverteres om gangen.";
      return;
    }

    batchResults = lines.map((input, index) => {
      try {
        return { index: index + 1, input, result: converter.convert(input, mode), ok: true, error: "" };
      } catch (error) {
        return { index: index + 1, input, result: "", ok: false, error: error instanceof Error ? error.message : "Feil" };
      }
    });

    const fragment = document.createDocumentFragment();
    batchResults.forEach((item) => {
      const row = document.createElement("tr");
      const values = [item.index, item.input, item.ok ? item.result : item.error, item.ok ? "OK" : "Feil"];
      values.forEach((value, cellIndex) => {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        if (cellIndex === 3) cell.className = item.ok ? "status-ok" : "status-error";
        row.appendChild(cell);
      });
      fragment.appendChild(row);
    });
    elements.batchTableBody.appendChild(fragment);
    elements.batchTableWrap.hidden = false;

    const successful = batchResults.filter((item) => item.ok).length;
    const failed = batchResults.length - successful;
    elements.batchMessage.textContent = `${successful} konvertert${failed ? `, ${failed} med feil` : ""}.`;
    elements.batchCopyButton.disabled = successful === 0;
    elements.batchDownloadButton.disabled = false;
  }

  function batchAsText() {
    return batchResults
      .filter((item) => item.ok)
      .map((item) => `${item.input}\t${item.result}`)
      .join("\n");
  }

  function csvEscape(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function downloadBatchCsv() {
    if (!batchResults.length) return;
    const rows = [
      ["Number", "Direction", "Input", "Result", "Status", "Error"],
      ...batchResults.map((item) => [
        item.index,
        mode,
        item.input,
        item.result,
        item.ok ? "OK" : "Error",
        item.error
      ])
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `entra-objectid-sid-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("CSV-filen er lastet ned");
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runConversion();
  });

  elements.directionButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  elements.sourceInput.addEventListener("input", () => {
    clearValidation();
    if (elements.resultPanel.dataset.state !== "empty") resetResult();
  });

  elements.sourceInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runConversion();
  });

  elements.exampleButton.addEventListener("click", () => {
    elements.sourceInput.value = mode === "object-to-sid" ? EXAMPLE_OBJECT_ID : EXAMPLE_SID;
    clearValidation();
    runConversion();
  });
  elements.swapButton.addEventListener("click", swapDirection);
  elements.clearButton.addEventListener("click", clearAll);
  elements.copyResultButton.addEventListener("click", () => copyText(lastResult, "Resultatet er kopiert"));
  elements.batchConvertButton.addEventListener("click", convertBatch);
  elements.batchCopyButton.addEventListener("click", () => copyText(batchAsText(), "Resultatene er kopiert"));
  elements.batchDownloadButton.addEventListener("click", downloadBatchCsv);

  elements.year.textContent = String(new Date().getFullYear());
  setMode(mode, { focus: false });
})();
