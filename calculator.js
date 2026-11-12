"use strict";

const RiskCalculator = (() => {
  function ratio(n, d = 1n) {
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n;
    let b = d;
    while (b) [a, b] = [b, a % b];
    return { n: n / a, d: d / a };
  }

  const zero = ratio(0n);
  const one = ratio(1n);
  const hundred = ratio(100n);
  const add = (a, b) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => ratio(a.n * b.n, a.d * b.d);
  const div = (a, b) => ratio(a.n * b.d, a.d * b.n);
  const compare = (a, b) => a.n * b.d - b.n * a.d;

  function parse(value) {
    let text = String(value ?? "").trim()
      .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
      .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
      .replaceAll("٫", ".").replaceAll("٬", ",");
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replaceAll(",", "");
    else if (/^\d+,\d+$/.test(text)) text = text.replace(",", ".");
    if (!/^(?:\d{1,15}(?:\.\d{0,12})?|\.\d{1,12})$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    return ratio(BigInt((whole || "0") + fraction), 10n ** BigInt(fraction.length));
  }

  function decimal(value, digits = 12, round = false) {
    const scale = 10n ** BigInt(digits);
    const scaled = value.n * scale;
    const whole = scaled / value.d + (round && (scaled % value.d) * 2n >= value.d ? 1n : 0n);
    if (!digits) return whole.toString();
    const text = whole.toString().padStart(digits + 1, "0");
    const fraction = text.slice(-digits).replace(/0+$/, "");
    return text.slice(0, -digits) + (fraction ? "." + fraction : "");
  }

  function evaluate(form, instrument) {
    const errors = {};
    const notes = [];
    function read(key, label, { optional = false, max = null } = {}) {
      const raw = String(form[key] ?? "");
      if (optional && !raw.trim()) return null;
      const value = parse(raw);
      if (!value || value.n <= 0n || (max && compare(value, max) > 0n)) {
        errors[key] = !raw.trim() ? "أدخل " + label + "." :
          (max ? "أدخل " + label + " بقيمة أكبر من صفر وحتى 100%." : "أدخل " + label + " كرقم أكبر من صفر.");
        return null;
      }
      return value;
    }

    const capital = read("capital", "رأس المال");
    const percent = read("risk", "نسبة المخاطرة", { max: hundred });
    const result = { errors, notes, budget: capital && percent ? div(mul(capital, percent), hundred) : null };
    const byPrices = form.mode === "prices";
    const isBuy = form.side === "buy";
    const byTickValue = instrument.market === "other" && form.method === "tickValue";
    const forex = instrument.market === "forex";
    const usePip = forex && (byPrices || form.distanceUnit === "pip");
    result.unit = usePip ? "Pip" : (forex ? "Point" : "Tick");
    const tick = usePip ? parse(instrument.pip) : read("tickSize", forex ? "حجم النقطة" : "حجم التيك");
    const size = instrument.market === "crypto" ? one : (!byTickValue && read("contractSize", "حجم العقد"));
    const tickValue = byTickValue && read("tickValue", "قيمة التيك لكل عقد بالدولار");
    const step = read("step", "خطوة تغيير الكمية", { optional: true });
    const min = read("min", "أقل حجم مسموح", { optional: true });
    let stop, entry, stopMove, target, targetMove;

    if (byPrices) {
      const low = read("entry", form.range ? "السعر الأدنى لمنطقة الدخول" : "سعر الدخول");
      const high = form.range ? read("entryHigh", "السعر الأعلى لمنطقة الدخول") : low;
      stop = read("stop", "سعر وقف الخسارة");
      target = read("target", "سعر جني الأرباح", { optional: true });
      if (low && high && (!form.range || compare(high, low) > 0n)) {
        entry = isBuy ? high : low;
        if (stop) {
          if ((isBuy && compare(stop, low) < 0n) || (!isBuy && compare(stop, high) > 0n)) {
            stopMove = isBuy ? sub(entry, stop) : sub(stop, entry);
          } else {
            errors.stop = form.range ? (isBuy ? "للشراء، لازم يكون الستوب تحت منطقة الدخول بالكامل." : "للبيع، لازم يكون الستوب فوق منطقة الدخول بالكامل.") :
              (isBuy ? "للشراء، لازم يكون الستوب أقل من سعر الدخول." : "للبيع، لازم يكون الستوب أعلى من سعر الدخول.");
          }
        }
        if (target) {
          if ((isBuy && compare(target, entry) > 0n) || (!isBuy && compare(target, entry) < 0n)) {
            targetMove = isBuy ? sub(target, entry) : sub(entry, target);
          } else {
            errors.target = isBuy ? "هدف الشراء لازم يكون أعلى من سعر الدخول المعتمد." : "هدف البيع لازم يكون أقل من سعر الدخول المعتمد.";
          }
        }
      } else if (low && high) {
        errors.entryHigh = "السعر الأعلى للمنطقة لازم يكون أكبر من السعر الأدنى.";
      }
    } else {
      const distance = read("distance", "مسافة وقف الخسارة");
      const targetDistance = read("targetDistance", "مسافة الهدف", { optional: true });
      if (tick && distance) stopMove = mul(tick, distance);
      if (tick && targetDistance) targetMove = mul(tick, targetDistance);
    }

    let stopRate = one;
    let targetRate = one;
    if (!byTickValue && instrument.quote !== "USD") {
      if (forex && instrument.base === "USD") {
        if (!byPrices) stop = read("conversion", "سعر الزوج عند الستوب");
        stopRate = stop && div(one, stop);
        if (!byPrices && stop && stopMove) {
          entry = isBuy ? add(stop, stopMove) : sub(stop, stopMove);
          if (compare(entry, zero) <= 0n) {
            errors.conversion = "سعر الزوج عند الستوب والمسافة يعطيان سعر دخول يساوي صفراً أو أقل.";
          }
          if (targetMove) target = isBuy ? add(entry, targetMove) : sub(entry, targetMove);
        }
        if (targetMove && target && compare(target, zero) <= 0n) {
          errors.targetDistance = "مسافة الهدف تعطي سعر هدف يساوي صفراً أو أقل.";
          targetMove = null;
        }
        targetRate = target && compare(target, zero) > 0n ? div(one, target) : null;
      } else {
        stopRate = read("conversion", "قيمة وحدة من " + instrument.quote + " بالدولار");
        targetRate = stopRate;
      }
    }

    result.entry = entry && compare(entry, zero) > 0n ? entry : null;
    result.distance = stopMove && tick ? div(stopMove, tick) : null;
    if (forex && stopMove) {
      const alternateTick = parse(usePip ? form.tickSize : instrument.pip);
      if (alternateTick?.n > 0n) result.alternateDistance = div(stopMove, alternateTick);
    }
    result.perTick = byTickValue ? tickValue : (tick && size && stopRate ? mul(mul(tick, size), stopRate) : null);
    const optionalErrorKeys = new Set(["target", "targetDistance"]);
    if (Object.keys(errors).some((key) => !optionalErrorKeys.has(key))) return result;
    if (!result.budget || !result.distance || !result.perTick) return result;

    const lossPerUnit = mul(result.distance, result.perTick);
    const raw = div(result.budget, lossPerUnit);
    const grid = step || parse("0.000000000001");
    const steps = div(raw, grid);
    const quantity = mul(ratio(steps.n / steps.d), grid);
    result.roundedToStep = Boolean(step);
    if (quantity.n === 0n || (min && compare(quantity, min) < 0n)) {
      notes.push(step || min ? "ميزانية المخاطرة لا تكفي لأصغر كمية ضمن مواصفات الوسيط." : "الكمية المحسوبة أصغر من دقة العرض المتاحة.");
      return result;
    }
    result.quantity = quantity;
    result.loss = mul(lossPerUnit, quantity);
    if (instrument.market === "crypto" && result.entry) {
      result.notional = mul(mul(result.entry, quantity), stopRate);
    }
    if (targetMove && targetRate && !errors.target && !errors.targetDistance) {
      const profitPerUnit = byTickValue ? mul(div(targetMove, tick), tickValue) : mul(mul(targetMove, size), targetRate);
      result.reward = mul(profitPerUnit, quantity);
      result.rewardRatio = div(profitPerUnit, lossPerUnit);
    }
    if (!step) notes.push("أدخل خطوة الكمية من منصتك لتقريب الحجم حسب الأوامر المتاحة.");
    return result;
  }

  return { parse, decimal, evaluate };
})();

if (typeof module !== "undefined") module.exports = RiskCalculator;
