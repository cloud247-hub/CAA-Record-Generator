(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.EntraSidConverter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_UINT32 = 4294967295;
  const SID_PREFIX = ["S", "1", "12", "1"];

  function normalizeObjectId(value) {
    if (typeof value !== "string") {
      throw new TypeError("Object ID må være tekst.");
    }

    let cleaned = value.trim();
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      cleaned = cleaned.slice(1, -1);
    }
    cleaned = cleaned.replace(/\s+/g, "");

    if (/^[0-9a-fA-F]{32}$/.test(cleaned)) {
      cleaned = [
        cleaned.slice(0, 8),
        cleaned.slice(8, 12),
        cleaned.slice(12, 16),
        cleaned.slice(16, 20),
        cleaned.slice(20)
      ].join("-");
    }

    const guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!guidPattern.test(cleaned)) {
      throw new Error("Ugyldig Object ID. Bruk et GUID med 32 heksadesimale tegn.");
    }

    return cleaned.toLowerCase();
  }

  function normalizeSid(value) {
    if (typeof value !== "string") {
      throw new TypeError("SID må være tekst.");
    }

    const cleaned = value.trim().replace(/\s+/g, "");
    const parts = cleaned.split("-");

    if (parts.length !== 8 || parts.slice(0, 4).map((part) => part.toUpperCase()).join("-") !== SID_PREFIX.join("-")) {
      throw new Error("Ugyldig SID. Forventet format er S-1-12-1-x-x-x-x.");
    }

    const numbers = parts.slice(4).map((part) => {
      if (!/^\d+$/.test(part)) {
        throw new Error("SID-delverdiene må være positive heltall.");
      }
      const number = Number(part);
      if (!Number.isInteger(number) || number < 0 || number > MAX_UINT32) {
        throw new Error("Hver SID-delverdi må være mellom 0 og 4294967295.");
      }
      return number;
    });

    return `S-1-12-1-${numbers.join("-")}`;
  }

  function objectIdToSid(value) {
    const guid = normalizeObjectId(value);
    const textualBytes = guid.replace(/-/g, "").match(/.{2}/g).map((hex) => Number.parseInt(hex, 16));

    const dotNetBytes = new Uint8Array([
      textualBytes[3], textualBytes[2], textualBytes[1], textualBytes[0],
      textualBytes[5], textualBytes[4],
      textualBytes[7], textualBytes[6],
      ...textualBytes.slice(8)
    ]);

    const view = new DataView(dotNetBytes.buffer);
    const values = [0, 4, 8, 12].map((offset) => view.getUint32(offset, true));
    return `S-1-12-1-${values.join("-")}`;
  }

  function sidToObjectId(value) {
    const sid = normalizeSid(value);
    const values = sid.split("-").slice(4).map(Number);
    const dotNetBytes = new Uint8Array(16);
    const view = new DataView(dotNetBytes.buffer);

    values.forEach((number, index) => view.setUint32(index * 4, number, true));

    const textualBytes = [
      dotNetBytes[3], dotNetBytes[2], dotNetBytes[1], dotNetBytes[0],
      dotNetBytes[5], dotNetBytes[4],
      dotNetBytes[7], dotNetBytes[6],
      ...dotNetBytes.slice(8)
    ];

    const hex = textualBytes.map((byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join("")
    ].join("-");
  }

  function convert(value, mode) {
    if (mode === "object-to-sid") return objectIdToSid(value);
    if (mode === "sid-to-object") return sidToObjectId(value);
    throw new Error("Ukjent konverteringsretning.");
  }

  return Object.freeze({
    MAX_UINT32,
    normalizeObjectId,
    normalizeSid,
    objectIdToSid,
    sidToObjectId,
    convert
  });
});
