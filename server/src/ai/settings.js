// Yapay zekâ ayarları: ortam değişkenleri (deploy/.env.example) + panelden değiştirilebilen birkaç değer (site-settings).
// OPENAI_API_KEY yalnızca sunucu sürecinde okunur; hiçbir yanıta, log satırına ya da dosyaya yazılmaz.
const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] != null ? v : def;
};

// Panelden değiştirilebilen değerler (site-settings) ortam değişkenlerinin üzerine yazar; boşsa ortam değeri geçerlidir.
function settings() {
  const ss = require("../site-settings").all();
  return {
    // Genel anahtar (ortam + API anahtarı); asistanlar ayrıca panelden tek tek açılıp kapatılır.
    enabled: process.env.AI_ENABLED !== "false" && !!process.env.OPENAI_API_KEY,
    assistants: { akaid: ss.ai_enabled !== false, hanefi: process.env.AI_HANEFI_ENABLED !== "false" && ss.ai_hanefi_enabled !== false },
    keyConfigured: !!process.env.OPENAI_API_KEY,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || "gpt-6-luna",
    timeoutMs: num("AI_TIMEOUT_MS", 45000),
    // Fiyatlar (USD / 1M token). Varsayılanlar gpt-6-luna için yayımlanan değerlerdir; OpenAI fiyat sayfasından doğrulayın.
    price: {
      input: num("AI_PRICE_INPUT_PER_1M", 0.10),
      cachedInput: num("AI_PRICE_CACHED_INPUT_PER_1M", 0.01),
      output: num("AI_PRICE_OUTPUT_PER_1M", 0.50),
    },
    limits: {
      dailyRequestsPerUser: ss.ai_daily_requests ?? num("AI_DAILY_REQUESTS_PER_USER", 40),
      dailyTokensPerUser: num("AI_DAILY_TOKENS_PER_USER", 120000),
      ratePerMinute: num("AI_RATE_PER_MINUTE", 6),
      maxInputChars: num("AI_MAX_INPUT_CHARS", 1500),
      maxHistoryTurns: num("AI_MAX_HISTORY_TURNS", 6),
      maxConcurrent: num("AI_MAX_CONCURRENT", 4),
      maxConcurrentPerUser: num("AI_MAX_CONCURRENT_PER_USER", 1),
      monthlyBudgetUsd: ss.ai_monthly_budget ?? num("AI_MONTHLY_BUDGET_USD", 20),
      totalBudgetUsd: num("AI_TOTAL_BUDGET_USD", 0), // 0 = sınırsız
    },
    // Görev profilleri: basit işler düşünmeden (none), açıklama/kıyas gerektirenler düşük düşünmeyle (low).
    tasks: {
      kisa: { effort: process.env.AI_EFFORT_SIMPLE || "none", maxOutput: num("AI_MAX_OUTPUT_SIMPLE", 400), contextChars: 5000, sources: 4 },
      soru: { effort: process.env.AI_EFFORT_REASONED || "low", maxOutput: num("AI_MAX_OUTPUT_REASONED", 1200), contextChars: 9000, sources: 6 },
      // Hanefî asistanı: Türkçe soruyu Arapça arama terimlerine çeviren kısa ön çağrı (yanıtla aynı kayda yazılır).
      terimler: { effort: "none", maxOutput: num("AI_MAX_OUTPUT_TERMS", 200) },
    },
  };
}

module.exports = { settings };
