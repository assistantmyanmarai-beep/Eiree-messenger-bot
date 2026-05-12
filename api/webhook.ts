import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT VARIABLES
// ═══════════════════════════════════════════════════════════════
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const FACEBOOK_WEBHOOK_VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// System errors (code crash) → developer ဆီ
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Business notifications (order, follow-up) → owner/client ဆီ
const OWNER_TELEGRAM_BOT_TOKEN = process.env.OWNER_TELEGRAM_BOT_TOKEN;
const OWNER_TELEGRAM_CHAT_ID = process.env.OWNER_TELEGRAM_CHAT_ID;

// ═══════════════════════════════════════════════════════════════
// OUTPUT SANITIZER
// AI reply ထဲမှာ internal command တွေ ရောနေရင် ဖယ်ထုတ်မယ်
// Customer ဆီ သန့်ရှင်းတဲ့ text သက်သက်ပဲ ရောက်ရမယ်
// ═══════════════════════════════════════════════════════════════
function sanitizeReply(text: string): string {
  if (!text) return "";

  // Internal commands တွေ ဖယ်ထုတ်
  const internalPatterns = [
    /NEED_FOLLOW_UP:\[.*?\]/gs,
    /NEED_FOLLOW_UP:[^\n]*/g,
    /PRICE_UNCERTAIN:[^\n]*/g,
    /PRICE_UNCERTAIN/g,
    /NEED_HUMAN_SUPPORT:\[.*?\]/gs,
    /NEED_HUMAN_SUPPORT:[^\n]*/g,
    /ORDER_INTENT_DETECTED:[^\n]*/g,
    /\[.*?internal.*?\]/gi,
    /\[.*?command.*?\]/gi,
  ];

  let cleaned = text;
  for (const pattern of internalPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  // ပိုနေတဲ့ blank lines ရှင်းပြီး trim
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned || "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
}

// ═══════════════════════════════════════════════════════════════
// SITUATION DETECTOR — Code ဘက်ကပဲ situation စစ်မယ်
// AI ကို command မတောင်းတော့ဘဲ AI က text ပဲပြောပါစေ
// ═══════════════════════════════════════════════════════════════
interface SituationResult {
  type: "normal" | "price_query" | "followup_needed" | "order_intent";
  detectedProduct?: string;
}

function detectSituation(messageText: string, aiReply: string, hasActiveOrder: boolean): SituationResult {
  const msg = messageText.toLowerCase();
  const reply = aiReply.toLowerCase();

  // Order intent — customer message ကိုကြည့်
  const orderIntentWords = [
    "မှာမယ်", "မှာချင်တယ်", "မှာပါမယ်",
    "ဝယ်မယ်", "ဝယ်ချင်တယ်",
    "ယူမယ်", "ယူချင်တယ်",
    "အော်ဒါတင်", "order တင်",
    "ပေးလိုက်တော့", "ပို့ပေးပါ",
  ];
  const serviceQueryWords = [
    "ဘာဝန်ဆောင်မှု", "ဝန်ဆောင်မှုတွေ",
    "ဘာတွေပေး", "ဘာပေး", "ဘာများပေး",
    "ဘယ်လိုဝန်ဆောင်", "service",
  ];
  const isServiceQuery = serviceQueryWords.some(w => msg.includes(w));
  const hasOrderIntent = !isServiceQuery && orderIntentWords.some(w => msg.includes(w));

  // Price query — ဈေးနှုန်းမသေချာမှုကိုစစ်
  const priceUncertainWords = ["ဘယ်လောက်လဲ", "ဈေးနှုန်း", "ဘယ်ဈေး", "စျေးနှုန်း"];
  const hasPriceQuery = priceUncertainWords.some(w => msg.includes(w));

  // Follow-up — order ပြီးနောက် ဆက်မေးတာ
  const followupWords = ["ဘယ်ရက်", "ဘယ်တော့", "လာတပ်", "ပို့မလဲ", "ဆက်သွယ်", "တပ်ဆင်", "COD", "cash", "delivery", "အာမခံ", "warranty"];
  const hasFollowup = hasActiveOrder && followupWords.some(w => msg.includes(w));

  if (hasFollowup) return { type: "followup_needed" };
  if (hasOrderIntent) return { type: "order_intent" };
  if (hasPriceQuery && (reply.includes("မသိ") || reply.includes("မသေချာ") || reply.includes("ဆက်သွယ်"))) {
    return { type: "price_query" };
  }

  return { type: "normal" };
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPER
// ═══════════════════════════════════════════════════════════════
async function supabaseQuery(table: string, method: string, body?: any, query?: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const headers: any = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  try {
    if (method === "GET") return (await axios.get(url, { headers })).data;
    if (method === "POST") return (await axios.post(url, body, { headers })).data;
    if (method === "PATCH") return (await axios.patch(url, body, { headers })).data;
    if (method === "DELETE") return (await axios.delete(url, { headers })).data;
  } catch (error: any) {
    console.error(`Supabase ${method} ${table} error:`, error?.response?.data || error.message);
    await notifySystemError(`Supabase Error (${method} ${table}): ${JSON.stringify(error?.response?.data || error.message)}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

// Developer ဆီ — system/code error တွေ
async function notifySystemError(msg: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🔴 *System Error*\n\n${msg}`,
      parse_mode: "Markdown",
    });
  } catch (e: any) { console.error("System Telegram error:", e.message); }
}

// Owner/Client ဆီ — business events (order, follow-up)
async function notifyOwnerTelegram(msg: string) {
  if (!OWNER_TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${OWNER_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: "Markdown",
    });
  } catch (e: any) { console.error("Owner Telegram error:", e.message); }
}

// Dashboard notification
async function notifyOwnerDashboard(customerId: number, type: string, title: string, content: string, orderId: number | null = null) {
  if (!customerId) return;
  try {
    await supabaseQuery("owner_notifications", "POST", {
      notification_type: type,
      customer_id: customerId,
      order_id: orderId,
      title,
      content,
    });
  } catch (e: any) { console.error("Dashboard notify error:", e); }
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════
async function isMessageProcessed(messageId: string): Promise<boolean> {
  try {
    const result = await supabaseQuery("processed_messages", "GET", null, `message_id=eq.${messageId}&select=message_id`);
    return result && result.length > 0;
  } catch { return false; }
}

async function markMessageProcessed(messageId: string) {
  try {
    await supabaseQuery("processed_messages", "POST", { message_id: messageId });
  } catch (e: any) { console.error("Mark processed error:", e); }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER
// ═══════════════════════════════════════════════════════════════
async function getOrCreateCustomer(psid: string) {
  try {
    const existing = await supabaseQuery("customers", "GET", null, `psid=eq.${psid}&select=*`);
    if (existing && existing.length > 0) return existing[0];
    const created = await supabaseQuery("customers", "POST", { psid });
    return created ? created[0] : { id: null, psid, bot_paused: false };
  } catch (e: any) {
    console.error("getOrCreateCustomer error:", e);
    return { id: null, psid, bot_paused: false };
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION
// ═══════════════════════════════════════════════════════════════
async function getConversationHistory(customerId: number, limit = 15) {
  if (!customerId) return [];
  try {
    return (await supabaseQuery("conversations", "GET", null,
      `customer_id=eq.${customerId}&select=*&order=created_at.desc&limit=${limit}`)) || [];
  } catch { return []; }
}

async function saveConversation(customerId: number, messageType: string, messageText: string) {
  if (!customerId) return;
  try {
    await supabaseQuery("conversations", "POST", {
      customer_id: customerId,
      message_type: messageType,
      message_text: messageText,
      metadata: {},
    });
  } catch (e: any) { console.error("saveConversation error:", e); }
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTS — stock ရှိ/မရှိ သာပြော၊ အရေအတွက် မပြော
// ═══════════════════════════════════════════════════════════════
async function getProducts() {
  try {
    return (await supabaseQuery("products", "GET", null, "is_active=eq.true&select=*")) || [];
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════
// STOCK DEDUCT
// ═══════════════════════════════════════════════════════════════
async function deductStock(productId: number, quantity: number) {
  try {
    const product = await supabaseQuery("products", "GET", null, `id=eq.${productId}&select=stock_quantity,name`);
    if (!product || product.length === 0) return;
    const newStock = Math.max(0, (product[0].stock_quantity || 0) - quantity);
    await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
    console.log(`Stock deducted: ${product[0].name} → ${newStock}`);
  } catch (e: any) { console.error("deductStock error:", e); }
}

// ═══════════════════════════════════════════════════════════════
// ORDER
// ═══════════════════════════════════════════════════════════════
async function saveOrder(orderData: any) {
  try {
    return await supabaseQuery("orders", "POST", orderData);
  } catch (e: any) {
    console.error("saveOrder error:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════
async function getContext(customerId: number) {
  if (!customerId) return null;
  try {
    const result = await supabaseQuery("conversation_context", "GET", null, `customer_id=eq.${customerId}&select=*`);
    return result && result.length > 0 ? result[0] : null;
  } catch { return null; }
}

async function updateContext(customerId: number, data: any) {
  if (!customerId) return;
  try {
    const existing = await getContext(customerId);
    if (existing) {
      await supabaseQuery("conversation_context", "PATCH",
        { ...data, updated_at: new Date().toISOString() },
        `customer_id=eq.${customerId}`
      );
    } else {
      await supabaseQuery("conversation_context", "POST", {
        customer_id: customerId, ...data,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (e: any) { console.error("updateContext error:", e); }
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT PARSER — preferences column ထဲကနေ data ထုတ်
// ═══════════════════════════════════════════════════════════════
function parsePreferences(preferences: any) {
  const defaults = {
    address: "",
    order_state: null as string | null,
    pending_product: null as string | null,
    pending_order: null as any,
    is_preorder: false,
    has_active_order: false,
  };

  if (!preferences) return defaults;

  try {
    const p = typeof preferences === "string" && preferences.startsWith("{")
      ? JSON.parse(preferences)
      : typeof preferences === "object" ? preferences : null;

    if (!p) {
      // Plain string (e.g. "အကို") — address အဖြစ်သုံး
      if (typeof preferences === "string" && preferences !== "pending") {
        return { ...defaults, address: preferences };
      }
      return defaults;
    }

    return {
      address: p.address ?? "",
      order_state: p.order_state || null,
      pending_product: p.pending_product || null,
      pending_order: p.pending_order || null,
      is_preorder: p.is_preorder || false,
      has_active_order: p.has_active_order || false,
    };
  } catch { return defaults; }
}

// ═══════════════════════════════════════════════════════════════
// GENDER DETECTION
// ═══════════════════════════════════════════════════════════════
async function detectGenderFromName(name: string): Promise<string> {
  if (!name || name.length < 2) return "";
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: `နာမည် "${name}" က ယောကျ်ားလေးလား မိန်းကလေးလား? JSON format နဲ့သာ:\n{"gender":"male"} or {"gender":"female"} or {"gender":"unknown"}`,
        }],
        max_tokens: 20,
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 5000 }
    );
    const raw = response.data.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (parsed.gender === "male") return "အကို";
    if (parsed.gender === "female") return "အမ";
    return "";
  } catch { return ""; }
}

// ═══════════════════════════════════════════════════════════════
// AI TRAINING CONFIG — Dashboard ကနေ prompt ပြောင်းလို့ရ
// ═══════════════════════════════════════════════════════════════
async function getSystemPromptFromDB(): Promise<string | null> {
  try {
    const result = await supabaseQuery("ai_training_config", "GET", null,
      "is_active=eq.true&select=*&order=updated_at.desc&limit=1");
    if (result && result.length > 0) {
      return result[0].system_prompt || result[0].prompt_content || result[0].content || null;
    }
    return null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// FACEBOOK SEND
// ═══════════════════════════════════════════════════════════════
async function sendMessage(recipientId: string, text: string) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN }, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Send message error:", error?.response?.data || error.message);
    await notifySystemError(`Facebook Send Error: ${error?.response?.data?.error?.message || error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CORE AI CALL — clean text သာ return လုပ်မယ်
// Internal commands ထွက်မလာအောင် prompt မှာ မတောင်းတော့ဘဲ
// Code ဘက်ကပဲ situation detect လုပ်မယ်
// ═══════════════════════════════════════════════════════════════
async function callAI(systemPrompt: string, historyMessages: any[], userMessage: string): Promise<string> {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    const raw = response.data.choices[0]?.message?.content || "";
    // Sanitize — internal command တွေ ဖယ်ထုတ်မယ်
    return sanitizeReply(raw);
  } catch (error: any) {
    console.error("AI call error:", error.response?.data || error.message);
    await notifySystemError(`AI Error: ${JSON.stringify(error.response?.data || error.message)}`);
    return "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER DETAILS PARSE — AI နဲ့ နာမည်/ဖုန်း/လိပ်စာ ထုတ်ယူ
// ═══════════════════════════════════════════════════════════════
async function parseOrderDetails(messageText: string): Promise<{ name: string | null; phone: string | null; address: string | null; quantity: number }> {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: `Customer message: "${messageText}"\n\nExtract ONLY with valid JSON, no markdown, no other text:\n{"name":null,"phone":null,"address":null,"quantity":1}`,
        }],
        max_tokens: 150,
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 10000 }
    );
    const raw = response.data.choices[0]?.message?.content || "{}";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("parseOrderDetails error:", e);
    return { name: null, phone: null, address: null, quantity: 1 };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AI RESPONSE
// ═══════════════════════════════════════════════════════════════
async function generateAIResponse(psid: string, messageText: string): Promise<string> {
  const fallback = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";

  try {
    const customer = await getOrCreateCustomer(psid);
    if (!customer?.id) return fallback;

    const [history, products, context] = await Promise.all([
      getConversationHistory(customer.id, 15),
      getProducts(),
      getContext(customer.id),
    ]);

    const prefs = parsePreferences(context?.preferences);

    // ── Order flow states ──
    if (prefs.order_state === "awaiting_details") {
      return await handleOrderDetails(customer, messageText, prefs, products, context);
    }
    if (prefs.order_state === "awaiting_confirm") {
      return await handleOrderConfirm(customer, messageText, prefs, context);
    }

    // ── Post-order conversation — has_active_order=true ──
    if (prefs.has_active_order) {
      return await handlePostOrder(customer, messageText, prefs, history);
    }

    // ── First message ever ──
    if (!context?.preferences && history.length === 0) {
      await updateContext(customer.id, { preferences: { address: "", order_state: null, has_active_order: false } });
      const greeting = "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nအိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", greeting);
      return greeting;
    }

    // ── Normal conversation ──
    // Product list — stock ရှိ/မရှိ သာပြော
    const productList = products.map((p: any) => {
      const stockStatus = p.stock_quantity > 0 ? "Stock ရှိပါတယ်" : "Stock မရှိ (Pre-order ရနိုင်)";
      return `• ${p.name} — ${Number(p.price_mmk).toLocaleString()} MMK — ${stockStatus}\n  ${p.description || ""}`;
    }).join("\n\n");

    const historyMessages = [...history].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    const addressRule = prefs.address
      ? `ဖောက်သည်ကို "${prefs.address}" ဟုသာ ခေါ်ပါ။`
      : `ဖောက်သည်ကို နာမ်စားဖြင့် မခေါ်ပါနဲ့။ ယဉ်ကျေးစွာ ဆက်သွယ်ပါ။`;

    const dbPrompt = await getSystemPromptFromDB();
    const defaultPrompt = `သင်သည် EIREE MYANMAR ၏ Professional အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။

━━━ စကားပြောပုံစံ ━━━
• ${addressRule} "ရှင့်" မသုံးနဲ့။
• မိမိကို "ခင်ဗျာ" သုံးပါ။
• သဘာဝကျကျ၊ နွေးထွေးစွာ ပြောပါ။ စာကြောင်း ၃ ကြောင်းထက်မပိုပါနဲ့။
• Bullet point၊ စာရှည်ကြီး ရှောင်ပါ။

━━━ အရောင်းဗျူဟာ ━━━
• ပစ္စည်းမေးရင် အကျဉ်းချုပ်ပြောပြပြီး စိတ်ဝင်စားမှ အသေးစိတ်ဆက်ပြော။
• ပစ္စည်းကောင်းကွက်ကို ထင်ရှားပြောပြီး ဝယ်ချင်အောင် လုပ်ပါ။
• Conversation history ကိုကြည့်ပြီး context နဲ့ နားလည်ပါ။
• Stock မရှိရင် Pre-order ရနိုင်ကြောင်း ပြောပြီး order ဆက်ကောက်ပါ။
• Stock အရေအတွက် ဘယ်တော့မှ မဖော်ပြနဲ့။

━━━ ဝယ်ယူလိုသော သဘောထား ━━━
Customer က ဝယ်ချင်တဲ့ သဘောထားပြသရင် —
"နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး တစ်ခါတည်းပြောပေးပါနော်ခင်ဗျာ 😊" ဟုသာ မေးပါ။

━━━ ဈေးနှုန်း STRICT RULE ━━━
⚠️ Product list ထဲကဟာကိုသာ ပြောပါ။ မသေချာရင် "ကျွန်တော်တို့ team ကနေ အတိအကျ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ" ဟုသာ ဖြေပါ။

━━━ မဖြေနိုင်တဲ့ မေးခွန်းများ ━━━
တပ်ဆင်ချိန်၊ ဘယ်ရက်ပို့မလဲ၊ COD ရလား၊ အာမခံ — "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏" ဟုသာ ဖြေပါ။

━━━ ပစ္စည်းများ ━━━
${productList}`;

    const systemPrompt = dbPrompt
      ? dbPrompt.replace(/\{addressTerm\}|\$\{addressTerm\}/g, prefs.address).replace(/\{productList\}|\$\{productList\}/g, productList)
      : defaultPrompt;

    const aiReply = await callAI(systemPrompt, historyMessages, messageText);

    // Code ဘက်ကပဲ order intent detect လုပ်မယ်
    const situation = detectSituation(messageText, aiReply, prefs.has_active_order);

    if (situation.type === "order_intent") {
      // Product ရှာ
      const matchedProduct = products.find((p: any) =>
        messageText.toLowerCase().includes(p.name.toLowerCase()) ||
        history.slice(0, 5).some((h: any) => h.message_text?.toLowerCase().includes(p.name.toLowerCase()))
      );
      const isPreorder = matchedProduct && matchedProduct.stock_quantity <= 0;

      await updateContext(customer.id, {
        preferences: {
          address: prefs.address,
          order_state: "awaiting_details",
          pending_product: matchedProduct?.name || null,
          is_preorder: isPreorder || false,
          has_active_order: false,
        },
      });

      const sal = prefs.address ? `${prefs.address}၊ ` : "";
      const askDetails = isPreorder
        ? `${sal}${matchedProduct.name} က လက်ရှိ Stock မရှိသေးပါဘူးခင်ဗျာ။ Pre-order အနေနဲ့ ၇-၁၀ ရက်အတွင်း ပို့ပေးနိုင်ပါတယ် 😊\n\nနာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး ပြောပေးပါနော်ခင်ဗျာ။`
        : `${sal}အော်ဒါတင်ပေးပါမယ်ခင်ဗျာ 😊 နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး တစ်ခါတည်း ပြောပေးပါနော်ခင်ဗျာ။`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", askDetails);
      return askDetails;
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", aiReply);
    return aiReply;

  } catch (error: any) {
    console.error("generateAIResponse error:", error);
    await notifySystemError(`generateAIResponse: ${error.message}`);
    return fallback;
  }
}

// ═══════════════════════════════════════════════════════════════
// POST-ORDER CONVERSATION
// Order ပြီးနောက် customer ဆက်မေးလာရင် — AI ဖြေပြီး owner notify
// ═══════════════════════════════════════════════════════════════
async function handlePostOrder(customer: any, messageText: string, prefs: any, history: any[]): Promise<string> {
  const followupKeywords = ["ဘယ်ရက်", "ဘယ်တော့", "လာတပ်", "ပို့မလဲ", "ဆက်သွယ်", "တပ်ဆင်", "COD", "cash on delivery", "delivery", "အာမခံ", "warranty", "မဆက်သွယ်", "မလာသေး", "ဘာမှမဆက်"];
  const needsFollowup = followupKeywords.some(w => messageText.toLowerCase().includes(w));

  const sal = prefs.address ? `${prefs.address}၊ ` : "";

  if (needsFollowup) {
    const reply = `${sal}ကျွန်တော်တို့ team ကနေ အကို့ဆီ မကြာမီ ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏`;

    // Owner ကို တိတိကျကျ notify
    await notifyOwnerDashboard(customer.id, "order_followup", "📞 Follow-up လိုအပ်", `Customer မေးတာ: ${messageText}`);
    await notifyOwnerTelegram(
      `📞 *Order ပြီးနောက် Follow-up လိုအပ်ပါတယ်*\n\n` +
      `Customer မေးတာ: *${messageText}*\n\n` +
      `👉 ဖောက်သည်ကို တိုက်ရိုက် ဆက်သွယ်ပေးပါ`
    );

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", reply);
    return reply;
  }

  // Follow-up မဟုတ်ရင် AI ကပဲ သဘာဝကျကျ ဖြေပါစေ
  const historyMessages = [...history].reverse().map((h: any) => ({
    role: h.message_type === "customer" ? "user" : "assistant",
    content: h.message_text,
  }));

  const postOrderPrompt = `သင်သည် EIREE MYANMAR ၏ အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။
Customer သည် အော်ဒါ တင်ပြီးနောက် ထပ်မေးနေပါသည်။
${prefs.address ? `ဖောက်သည်ကို "${prefs.address}" ဟုခေါ်ပါ။` : "နာမ်စားမသုံးဘဲ ယဉ်ကျေးစွာ ပြောပါ။"}
Order data ထပ်မတောင်းရ။ Order ဆိုင်ရာမဟုတ်သော မေးခွန်းများကိုသာ သဘာဝကျကျ ဖြေပါ။
စာကြောင်း ၂-၃ ကြောင်းသာ ရေးပါ။`;

  const aiReply = await callAI(postOrderPrompt, historyMessages, messageText);

  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", aiReply);
  return aiReply;
}

// ═══════════════════════════════════════════════════════════════
// ORDER DETAILS COLLECTION
// ═══════════════════════════════════════════════════════════════
async function handleOrderDetails(customer: any, messageText: string, prefs: any, products: any[], context: any): Promise<string> {
  const { name, phone, address, quantity } = await parseOrderDetails(messageText);

  const missing: string[] = [];
  if (!name) missing.push("နာမည်");
  if (!phone) missing.push("ဖုန်းနံပါတ်");
  if (!address) missing.push("လိပ်စာ");

  if (missing.length > 0) {
    const reply = `${missing.join("၊ ")} လေး ထပ်ပြောပေးပါနော်ခင်ဗျာ 😊`;
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", reply);
    return reply;
  }

  const product = prefs.pending_product
    ? products.find((p: any) =>
        p.name.toLowerCase().includes(prefs.pending_product.toLowerCase()) ||
        prefs.pending_product.toLowerCase().includes(p.name.toLowerCase()))
    : products[0];

  const isPreorder = product && product.stock_quantity <= 0;
  const totalPrice = product ? Number(product.price_mmk) * (quantity || 1) : 0;
  const detectedGender = await detectGenderFromName(name);
  const finalAddress = detectedGender || prefs.address;

  await updateContext(customer.id, {
    preferences: {
      address: finalAddress,
      order_state: "awaiting_confirm",
      pending_product: product?.name || prefs.pending_product,
      is_preorder: isPreorder,
      has_active_order: false,
      pending_order: {
        customer_name: name,
        phone_number: phone,
        delivery_address: address,
        quantity: quantity || 1,
        product_id: product?.id || null,
        product_name: product?.name || prefs.pending_product,
        total_price_mmk: totalPrice,
        is_preorder: isPreorder,
      },
    },
  });

  const preorderNote = isPreorder ? `\n⏳ Pre-order — ၇-၁၀ ရက်အတွင်း ပို့ပေးပါမယ်` : "";
  const confirmMsg =
    `အော်ဒါလေးအတည်ပြုပေးပါအုန်းခင်ဗျာ 😊\n\n` +
    `👤 ${name}\n📞 ${phone}\n📍 ${address}\n` +
    `📦 ${product?.name || prefs.pending_product} x${quantity || 1}\n` +
    `💰 ${totalPrice > 0 ? totalPrice.toLocaleString() + " MMK" : ""}` +
    preorderNote;

  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", confirmMsg);
  return confirmMsg;
}

// ═══════════════════════════════════════════════════════════════
// ORDER CONFIRMATION
// ═══════════════════════════════════════════════════════════════
async function handleOrderConfirm(customer: any, messageText: string, prefs: any, context: any): Promise<string> {
  const confirmWords = ["ဟုတ်ကဲ့", "အင်း", "yes", "ok", "ဟုတ်", "မှာမယ်", "ကောင်းပြီ", "ပြီးပြီ", "တင်ပေး", "ဆက်လုပ်", "ပေးပါ", "confirm"];
  const cancelWords = ["မမှာတော့", "cancel", "ပယ်ဖျက်", "မလုပ်တော့", "နေပါတော့", "မလို"];

  const lower = messageText.toLowerCase();
  const isConfirm = confirmWords.some(w => lower.includes(w));
  const isCancel = cancelWords.some(w => lower.includes(w));
  const pendingOrder = prefs.pending_order;

  if (isCancel) {
    await updateContext(customer.id, {
      preferences: { address: prefs.address, order_state: null, pending_order: null, pending_product: null, has_active_order: false },
    });
    const msg = "အဆင်ပြေပါတယ်ခင်ဗျာ 😊 နောက်တစ်ခါ လိုအပ်ရင် ပြန်မေးပါနော်။";
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", msg);
    return msg;
  }

  if (isConfirm && pendingOrder) {
    const orderStatus = pendingOrder.is_preorder ? "preorder" : "pending";

    const order = await saveOrder({
      customer_id: customer.id,
      product_id: pendingOrder.product_id,
      full_name: pendingOrder.customer_name,
      phone_number: pendingOrder.phone_number,
      delivery_address: pendingOrder.delivery_address,
      quantity: pendingOrder.quantity,
      total_price_mmk: pendingOrder.total_price_mmk,
      status: orderStatus,
    });

    if (pendingOrder.product_id && pendingOrder.quantity) {
      await deductStock(pendingOrder.product_id, pendingOrder.quantity);
    }

    // has_active_order=true — post-order conversation track လုပ်ဖို့
    await updateContext(customer.id, {
      preferences: {
        address: prefs.address,
        order_state: null,
        pending_order: null,
        pending_product: null,
        has_active_order: true,
      },
    });

    if (order) {
      const sal = prefs.address ? ` ${prefs.address}` : "";
      const orderLabel = orderStatus === "preorder" ? "(Pre-order)" : "";

      await notifyOwnerDashboard(
        customer.id, "new_order",
        `🛒 အော်ဒါအသစ် ${orderLabel}`,
        `👤 ${pendingOrder.customer_name} | 📞 ${pendingOrder.phone_number} | 📍 ${pendingOrder.delivery_address} | 📦 ${pendingOrder.product_name} x${pendingOrder.quantity} | 💰 ${pendingOrder.total_price_mmk?.toLocaleString()} MMK`
      );

      await notifyOwnerTelegram(
        `🛒 *အော်ဒါအသစ် ဝင်လာပါပြီ* ${orderLabel}\n\n` +
        `👤 *${pendingOrder.customer_name}*\n` +
        `📞 ${pendingOrder.phone_number}\n` +
        `📍 ${pendingOrder.delivery_address}\n` +
        `📦 ${pendingOrder.product_name} x${pendingOrder.quantity}\n` +
        `💰 *${pendingOrder.total_price_mmk?.toLocaleString()} MMK*\n\n` +
        `👉 Dashboard မှာ confirm လုပ်ပေးပါ`
      );

      const successMsg = pendingOrder.is_preorder
        ? `Pre-order တင်ပြီးပါပြီ${sal} ✅\n\nမကြာမီ ဖုန်းဆက်ပြီး အသေးစိတ် ရှင်းပြပေးပါမယ်ခင်ဗျာ 🙏`
        : `အော်ဒါတင်ပြီးပါပြီ${sal} ✅\n\nမကြာမီ ဖုန်းဆက်ပြီး အတည်ပြုပေးပါမယ်ခင်ဗျာ 🙏`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", successMsg);
      return successMsg;
    }
  }

  // Confirm/Cancel မဟုတ်သေးရင်
  const reask = "အော်ဒါတင်ပေးရမလားခင်ဗျာ? 😊";
  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", reask);
  return reask;
}

// ═══════════════════════════════════════════════════════════════
// MAIN WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET — Facebook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // POST — Incoming messages
  if (req.method === "POST") {
    const body = req.body;
    if (body.object === "page") {
      try {
        const tasks: Promise<void>[] = [];

        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            const messageId = event.message?.mid;
            if (!senderId) continue;

            tasks.push((async () => {
              try {
                // Duplicate check
                if (messageId) {
                  if (await isMessageProcessed(messageId)) {
                    console.log(`Skipping duplicate: ${messageId}`);
                    return;
                  }
                  await markMessageProcessed(messageId);
                }

                const customer = await getOrCreateCustomer(senderId);
                if (customer?.bot_paused) return;

                if (event.message?.text) {
                  const reply = await generateAIResponse(senderId, event.message.text);
                  await sendMessage(senderId, reply);
                } else if (event.message) {
                  // Image, voice, sticker — owner notify
                  const msgType = Object.keys(event.message)
                    .filter(k => k !== "mid" && k !== "seq").join(", ");
                  const reply = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
                  await sendMessage(senderId, reply);
                  await notifyOwnerDashboard(customer.id, "non_text_message", "📎 Text မဟုတ်တဲ့ Message", `Customer ပို့တာ: ${msgType}`);
                  await notifyOwnerTelegram(`📎 *Text မဟုတ်တဲ့ Message*\nအမျိုးအစား: ${msgType}\n👉 Dashboard မှာ ကြည့်ပြီး ပြန်ဆက်သွယ်ပေးပါ`);
                }
              } catch (innerErr: any) {
                console.error("Task error:", innerErr);
                await notifySystemError(`Task Error: ${innerErr.message}`);
              }
            })());
          }
        }

        await Promise.all(tasks);
      } catch (err: any) {
        console.error("Handler Error:", err);
        await notifySystemError(`Handler Error: ${err.message}`);
      }

      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method not allowed");
}