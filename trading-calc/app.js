"use strict";

const fxGroups = [
  ["الأزواج الرئيسية", "EUR/USD GBP/USD USD/JPY USD/CHF AUD/USD NZD/USD USD/CAD"],
  ["الأزواج المتقاطعة", "EUR/GBP EUR/JPY EUR/CHF EUR/AUD EUR/NZD EUR/CAD GBP/JPY GBP/CHF GBP/AUD GBP/NZD GBP/CAD AUD/JPY AUD/CHF AUD/NZD AUD/CAD NZD/JPY NZD/CHF NZD/CAD CAD/JPY CAD/CHF CHF/JPY"],
  ["أزواج إضافية", "USD/SEK USD/NOK USD/MXN USD/ZAR USD/TRY USD/SGD USD/HKD USD/PLN USD/CNH USD/ILS EUR/SEK EUR/NOK EUR/PLN EUR/TRY EUR/HUF"]
];

const forex = Object.fromEntries(fxGroups.flatMap(([, symbols]) => symbols.split(" ").map((id) => {
  const [base, quote] = id.split("/");
  const pip = quote === "JPY" || quote === "HUF" ? "0.01" : "0.0001";
  return [id, { base, quote, pip, tickSize: pip === "0.01" ? "0.001" : "0.00001", contractSize: "100000", step: "0.01", min: "0.01" }];
})));

const metals = {
  "XAU/USD": { name: "الذهب", tickSize: "0.01", contractSize: "100", step: "0.01", min: "0.01" },
  "XAG/USD": { name: "الفضة", tickSize: "0.001", contractSize: "5000", step: "0.01", min: "0.01" },
  "XPT/USD": { name: "البلاتين", tickSize: "0.01", contractSize: "100", step: "0.01", min: "0.01" },
  "XPD/USD": { name: "البلاديوم", tickSize: "0.01", contractSize: "100", step: "0.01", min: "0.01" },
  "XCU/USD": { name: "النحاس", tickSize: "", contractSize: "", step: "", min: "" }
};
const crypto = {
  BTC: { name: "Bitcoin", tickSize: "0.01" },
  ETH: { name: "Ethereum", tickSize: "0.01" },
  BNB: { name: "BNB", tickSize: "0.01" },
  XRP: { name: "XRP", tickSize: "0.0001" },
  SOL: { name: "Solana", tickSize: "0.01" },
  TRX: { name: "TRON", tickSize: "0.0001" },
  HYPE: { name: "Hyperliquid", tickSize: "0.01" },
  ZEC: { name: "Zcash", tickSize: "0.01" },
  DOGE: { name: "Dogecoin", tickSize: "0.00001" },
  XMR: { name: "Monero", tickSize: "0.01" }
};
const other = {
  CUSTOM: { name: "أداة مخصصة" },
  US500: { name: "مؤشر S&P 500" },
  US100: { name: "مؤشر ناسداك 100" },
  US30: { name: "مؤشر داو جونز" },
  GER40: { name: "مؤشر داكس" },
  WTI: { name: "نفط خام أمريكي" },
  BRENT: { name: "نفط برنت" },
  NATGAS: { name: "غاز طبيعي" }
};
const catalogs = { forex, metals, crypto, other };
const quotes = "USD USDT USDC EUR GBP JPY CHF CAD AUD NZD SGD HKD SEK NOK MXN ZAR TRY PLN CNH ILS HUF AED SAR".split(" ");
const sizeLabels = { lot: "لوت", contract: "عقد", unit: "وحدة" };
const { decimal, evaluate } = RiskCalculator;

const byId = (id) => document.getElementById(id);
const form = byId("trade-form");
const controls = form.elements;
const specifications = ["tickSize", "contractSize", "tickValue", "step", "min", "unitLabel", "method", "quote"];
const tradeInputs = ["capital", "risk", "entry", "entryHigh", "stop", "target", "distance", "targetDistance", "conversion"];
const stateKey = "mizan-risk.v1";
const stateFields = ["market", "symbol", "customName", "mode", "side", "range", "cryptoQuote", "distanceUnit", ...tradeInputs];
const example = { market: "forex", symbol: "EUR/USD", mode: "prices", side: "buy", range: false, cryptoQuote: "USD", distanceUnit: "pip", capital: "1000", risk: "1", entry: "1.10000", stop: "1.09500", target: "1.11000" };
let memory = {};
let assetKey;
let copyValue = "";

function setText(id, text) {
  byId(id).textContent = text;
}

function visible(id, show) {
  byId(id).hidden = !show;
}

function readState() {
  try { return JSON.parse(localStorage.getItem(stateKey)) || {}; }
  catch { return {}; }
}

function saveState() {
  const state = Object.fromEntries(stateFields.map((name) => [name, name === "range" ? controls[name].checked : controls[name].value]));
  memory[assetKey] = Object.fromEntries(specifications.map((name) => [name, controls[name].value]));
  try { localStorage.setItem(stateKey, JSON.stringify({ state, specifications: memory })); }
  catch { /* The calculator also works with browser storage unavailable. */ }
}

function addOptions(select, items) {
  for (const [value, label] of items) select.append(new Option(label, value));
}

function refreshSymbols(symbol) {
  const market = controls.market.value;
  controls.symbol.replaceChildren();
  if (market === "forex") {
    for (const [label, symbols] of fxGroups) {
      const group = document.createElement("optgroup");
      group.label = label;
      addOptions(group, symbols.split(" ").map((id) => [id, id]));
      controls.symbol.append(group);
    }
  } else {
    addOptions(controls.symbol, Object.entries(catalogs[market]).map(([id, item]) => [id, id === "CUSTOM" ? item.name : id + "  ·  " + item.name]));
  }
  if (Object.hasOwn(catalogs[market], symbol)) controls.symbol.value = symbol;
}

function refreshSpecifications(useSaved = true) {
  const market = controls.market.value;
  const symbol = controls.symbol.value;
  const instrument = catalogs[market][symbol];
  assetKey = market + ":" + symbol + (market === "crypto" ? ":" + controls.cryptoQuote.value : "");
  const defaults = { tickSize: "", contractSize: "", tickValue: "", step: "", min: "", unitLabel: "lot", method: "size", quote: "USD", ...instrument };
  const saved = useSaved && memory[assetKey];
  for (const name of specifications) {
    controls[name].value = typeof saved?.[name] === "string" ? saved[name] : defaults[name];
  }
  byId("specs").open = market === "other" || (market === "metals" && !controls.contractSize.value);
}

function applyState(state, useSaved = true) {
  const validMarket = Object.hasOwn(catalogs, state.market) ? state.market : example.market;
  controls.market.value = validMarket;
  refreshSymbols(state.symbol || example.symbol);
  controls.mode.value = state.mode === "distance" ? "distance" : "prices";
  controls.side.value = state.side === "sell" ? "sell" : "buy";
  controls.range.checked = Boolean(state.range);
  controls.distanceUnit.value = state.distanceUnit === "point" ? "point" : "pip";
  controls.cryptoQuote.value = ["USD", "USDT", "USDC"].includes(state.cryptoQuote) ? state.cryptoQuote : "USD";
  for (const name of [...tradeInputs, "customName"]) controls[name].value = typeof state[name] === "string" ? state[name] : "";
  refreshSpecifications(useSaved);
}

function currentInstrument() {
  const market = controls.market.value;
  const symbol = controls.symbol.value;
  const preset = catalogs[market][symbol];
  return {
    ...preset,
    market,
    symbol: market === "crypto" ? symbol + "/" + controls.cryptoQuote.value : (symbol === "CUSTOM" ? (controls.customName.value.trim() || "أداة مخصصة") : symbol),
    quote: market === "crypto" ? controls.cryptoQuote.value : (market === "other" ? controls.quote.value : (preset.quote || "USD")),
    sizeLabel: market === "crypto" ? "وحدة" : (market === "other" ? sizeLabels[controls.unitLabel.value] : "لوت")
  };
}

function refreshInterface(instrument, values) {
  const { market, quote, base, symbol } = instrument;
  const prices = values.mode === "prices";
  const fx = market === "forex";
  const isOther = market === "other";
  const tickValue = isOther && values.method === "tickValue";
  const usdBase = fx && base === "USD";
  const usePip = fx && (prices || values.distanceUnit === "pip");
  const movement = usePip ? "Pip" : (fx ? "Point" : "Tick");
  visible("quote-field", market === "crypto");
  visible("custom-name-field", isOther && controls.symbol.value === "CUSTOM");
  visible("price-fields", prices);
  visible("distance-fields", !prices);
  visible("range-field", prices);
  visible("range-high-field", prices && values.range);
  visible("unit-field", !prices && fx);
  visible("exchange-field", !tickValue && quote !== "USD" && (!usdBase || !prices));
  visible("custom-unit-field", isOther);
  visible("method-field", isOther);
  visible("custom-quote-field", isOther && !tickValue);
  visible("tick-value-field", tickValue);
  visible("contract-size-field", market !== "crypto" && !tickValue);
  setText("entry-label", values.range ? "السعر الأدنى للمنطقة" : "سعر الدخول");
  setText("distance-suffix", movement);
  setText("target-suffix", movement);
  setText("tick-size-label", fx ? "حجم الـ Point في المنصة" : "حجم التيك في المنصة");
  setText("contract-size-label", isOther ? "عدد الوحدات لكل حجم تداول" : "عدد الوحدات في اللوت");
  setText("exchange-label", usdBase ? "سعر " + symbol + " عند الستوب" : "قيمة 1 " + quote + " بالدولار");
  setText("exchange-suffix", usdBase ? quote : "USD");
  setText("exchange-hint", usdBase ? "اكتب سعر وقف الخسارة للزوج ليُحوَّل المبلغ إلى الدولار." : "أدخل سعر التحويل يدوياً. يُستخدم السعر نفسه لحساب الوقف والهدف.");
  setText("result-symbol", symbol);
  setText("per-tick-label", "قيمة حركة " + movement + " لكل " + instrument.sizeLabel);
  const specNotes = {
    forex: "حجم الـ Pip لهذا الزوج " + (instrument.pip || "") + ". عدّل حجم الـ Point وحجم اللوت وخطوة الكمية حسب مواصفات وسيطك.",
    metals: "راجع حجم اللوت، حجم التيك وخطوة الكمية عند وسيطك. القيم المعبّأة أمثلة قابلة للتعديل.",
    crypto: "النتيجة بالكمية. أدخل حجم حركة السعر، خطوة الكمية والحد الأدنى من منصتك. يمكنك استخدام «أسواق أخرى» للعقود الخطية ذات المضاعف.",
    other: "انسخ المواصفات من منصتك. أدخل حجم العقد أو قيمة التيك بالدولار لكل عقد، وحدّد خطوة الكمية والحد الأدنى."
  };
  setText("spec-note", specNotes[market]);
  for (const button of document.querySelectorAll("[data-risk]")) {
    const active = Number(values.risk) === Number(button.dataset.risk);
    button.setAttribute("aria-pressed", String(active));
  }
}

const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function money(value) {
  if (!value) return "—";
  if (value.n > 0n && value.n * 100n < value.d) return "< $0.01";
  return moneyFormat.format(Number(decimal(value, 2, true)));
}

function shortNumber(value) {
  if (!value) return "—";
  const text = decimal(value, 8, true);
  return value.n > 0n && text === "0" ? "< 0.00000001" : text;
}

function render() {
  const values = Object.fromEntries(new FormData(form));
  values.range = controls.range.checked;
  const instrument = currentInstrument();
  refreshInterface(instrument, values);
  const result = evaluate(values, instrument);
  for (const input of form.querySelectorAll("input[inputmode='decimal']")) {
    if (result.errors[input.name] && input.value.trim()) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  const quantity = result.quantity ? decimal(result.quantity) : "";
  copyValue = quantity;
  byId("copy").disabled = !copyValue;
  setText("result-qty", quantity || "—");
  byId("result-number-line").classList.toggle("compact", quantity.length > 9);
  setText("result-unit", instrument.sizeLabel);
  const resultMessage = result.quantity ? (result.roundedToStep ? "مقرّب للأسفل حسب خطوة الوسيط" : "حجم محسوب حسب مسافة الستوب") : "يظهر الحجم بعد اكتمال المدخلات";
  setText("result-note", resultMessage);
  setText("risk-budget", money(result.budget));
  setText("stop-loss", money(result.loss));
  setText("stop-distance", result.distance ? shortNumber(result.distance) + " " + result.unit : "—");
  visible("stop-distance-alternate", Boolean(result.alternateDistance));
  setText("stop-distance-alternate", result.alternateDistance ? shortNumber(result.alternateDistance) + " " + (result.unit === "Pip" ? "Point" : "Pip") : "");
  setText("reward-ratio", result.rewardRatio ? shortNumber(result.rewardRatio) + " : 1" : "—");
  setText("per-tick", money(result.perTick));
  visible("entry-result-row", Boolean(result.entry));
  setText("entry-result", result.entry ? decimal(result.entry) : "—");
  visible("notional-row", Boolean(result.notional));
  setText("notional", money(result.notional));
  visible("reward-row", Boolean(result.reward));
  setText("reward", money(result.reward));
  const error = Object.values(result.errors)[0];
  setText("notice", error || result.notes[0] || "");
  byId("notice").classList.toggle("error", Boolean(error));
  visible("notice", Boolean(error || result.notes.length));
}

function update() {
  render();
  saveState();
}

for (const name of ["capital", "risk", "entry", "entryHigh", "stop", "target", "distance", "targetDistance", "conversion", "tickSize", "contractSize", "tickValue", "step", "min"]) {
  controls[name].maxLength = 30;
}
addOptions(controls.quote, quotes.map((quote) => [quote, quote]));
const saved = readState();
if (saved.specifications && typeof saved.specifications === "object") memory = saved.specifications;
applyState(saved.state || { ...example, target: "" });
render();

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("input", (event) => {
  if (event.target.type === "text") update();
});
form.addEventListener("change", (event) => {
  const name = event.target.name;
  if (name === "market" || name === "symbol" || name === "cryptoQuote" || name === "quote") {
    controls.conversion.value = "";
  }
  if (name === "market" || name === "symbol") {
    for (const key of ["entry", "entryHigh", "stop", "target", "distance", "targetDistance"]) controls[key].value = "";
    controls.range.checked = false;
    controls.customName.value = "";
    if (name === "market") {
      controls.cryptoQuote.value = "USD";
      refreshSymbols();
    }
  }
  if (name === "market" || name === "symbol" || name === "cryptoQuote") refreshSpecifications();
  if (event.target.type !== "text") update();
});
for (const button of document.querySelectorAll("[data-risk]")) {
  button.addEventListener("click", () => {
    controls.risk.value = button.dataset.risk;
    update();
  });
}

byId("example").addEventListener("click", () => {
  applyState(example, false);
  update();
});
byId("clear").addEventListener("click", () => {
  for (const name of tradeInputs) controls[name].value = "";
  update();
  controls.capital.focus();
});
byId("show-guide").addEventListener("click", () => byId("guide").showModal());
byId("copy").addEventListener("click", async () => {
  const quantity = copyValue;
  if (!quantity) return;
  try {
    await navigator.clipboard.writeText(quantity);
  } catch {
    const node = byId("result-qty");
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("copy")) {
      setText("announcement", "الكمية محدّدة ويمكنك نسخها.");
      return;
    }
    selection.removeAllRanges();
  }
  byId("copy").title = "تم النسخ";
  setText("announcement", "تم نسخ حجم الصفقة.");
  window.clearTimeout(byId("copy").copyFeedback);
  byId("copy").classList.add("copied");
  byId("copy").copyFeedback = window.setTimeout(() => {
    byId("copy").classList.remove("copied");
    byId("copy").title = "نسخ حجم الصفقة";
  }, 1400);
});
