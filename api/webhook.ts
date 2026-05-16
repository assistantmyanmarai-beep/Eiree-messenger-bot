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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OWNER_TELEGRAM_BOT_TOKEN = process.env.OWNER_TELEGRAM_BOT_TOKEN;
const OWNER_TELEGRAM_CHAT_ID = process.env.OWNER_TELEGRAM_CHAT_ID;

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const AUTO_RESUME_MS = 30 * 60 * 1000; // Bot auto-resume after 30 min
const MEDIA_ENABLED = true;            // Product image sending feature

// ═══════════════════════════════════════════════════════════════
// TELEGRAM TEXT SANITIZER
// Telegram Markdown မှာ special character တွေပါရင် notification
// error ဖြစ်နိုင်တယ် — Customer နာမည်/လိပ်စာထဲက * _ ` [ ] တွေ ဖယ်မယ်
// ═══════════════════════════════════════════════════════════════
function sanitizeTelegramText(text: string): string {
  if (!text) return "";
  return text.replace(/[*_`[\]]/g, "");
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT SANITIZER
// AI reply ထဲမှာ JSON / placeholder text တွေ ပါလာရင် ဖယ်မယ်
// ═══════════════════════════════════════════════════════════════
function sanitizeReply(text: string): string {
  if (!text) return "";
  let cleaned = text
    // JSON structure တွေ ဖယ်မယ်
    .replace(/```json[\s\S]*?```/gi, "")
    .replace(/```[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*?"reply"[\s\S]*?\}/g, "")
    // Internal command/flag တွေ ဖယ်မယ်
    .replace(/NEED_FOLLOW_UP:\[.*?\]/gs, "")
    .replace(/NEED_FOLLOW_UP:[^\n]*/g, "")
    .replace(/PRICE_UNCERTAIN:[^\n]*/g, "")
    .replace(/PRICE_UNCERTAIN/g, "")
    .replace(/NEED_HUMAN_SUPPORT:\[.*?\]/gs, "")
    .replace(/NEED_HUMAN_SUPPORT:[^\n]*/g, "")
    .replace(/ORDER_INTENT_DETECTED:[^\n]*/g, "")
    .replace(/ORDER_COLLECTING/g, "")
    .replace(/ORDER_COMPLETE:\{.*?\}/gs, "")
    .replace(/NOTIFY_OWNER:[^\n]*/g, "")
    // Placeholder text တွေ ဖယ်မယ် — Customer မြင်မသင့်တာတွေ
    .replace(/ဈေးနှုန်းဖြည့်ပါ/g, "")
    .replace(/\[.*?ဖြည့်ပါ.*?\]/g, "")
    .replace(/\[COMMAND:.*?\]/g, "")
    .replace(/\[ACTION:.*?\]/g, "")
    .trim();
  return cleaned || "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPER
// ═══════════════════════════════════════════════════════════════
async function supabaseQuery(
  table: string,
  method: string,
  body?: any,
  query?: string
) {
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
    await notifySystemError(
      `Supabase Error (${method} ${table}): ${JSON.stringify(error?.response?.data || error.message)}`
    );
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
async function notifySystemError(msg: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🔴 System Error\n\n${msg}`,
      // parse_mode မသုံးဘဲ plain text ပို့မယ် — error ထဲမှာ special char ပါတတ်လို့
    });
  } catch (e: any) {
    console.error("System Telegram error:", e.message);
  }
}

async function notifyOwnerTelegram(msg: string) {
  if (!OWNER_TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${OWNER_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_CHAT_ID,
      text: msg,
      // FIX: parse_mode မသုံးတော့ဘူး — Customer နာမည်ထဲ * _ ` တွေပါရင်
      // Telegram error ဖြစ်ပြီး notification ပျောက်သွားတတ်လို့
    });
  } catch (e: any) {
    console.error("Owner Telegram error:", e.message);
  }
}

async function notifyOwnerDashboard(
  customerId: number,
  type: string,
  title: string,
  content: string,
  orderId: number | null = null
) {
  if (!customerId) return;
  try {
    await supabaseQuery("owner_notifications", "POST", {
      notification_type: type,
      customer_id: customerId,
      order_id: orderId,
      title,
      content,
    });
  } catch (e: any) {
    console.error("Dashboard notify error:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICATION
// Message ID တူတာ ထပ်မဆောင်ရွက်ရ
// ═══════════════════════════════════════════════════════════════
async function isMessageProcessed(messageId: string): Promise<boolean> {
  try {
    const result = await supabaseQuery(
      "processed_messages", "GET", null,
      `message_id=eq.${messageId}&select=message_id`
    );
    return result && result.length > 0;
  } catch {
    return false;
  }
}

async function markMessageProcessed(messageId: string) {
  try {
    await supabaseQuery("processed_messages", "POST", { message_id: messageId });
  } catch (e: any) {
    console.error("Mark processed error:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER
// ═══════════════════════════════════════════════════════════════
async function getOrCreateCustomer(psid: string) {
  try {
    const existing = await supabaseQuery("customers", "GET", null, `psid=eq.${psid}&select=*`);
    if (existing && existing.length > 0) return existing[0];
    const created = await supabaseQuery("customers", "POST", { psid });
    return created ? created[0] : { id: null, psid, bot_paused: false, paused_at: null };
  } catch (e: any) {
    console.error("getOrCreateCustomer error:", e);
    return { id: null, psid, bot_paused: false, paused_at: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// BOT PAUSE CHECK WITH AUTO-RESUME
// bot_paused=true + paused_at=NULL  → Manual pause (indefinite)
// bot_paused=true + paused_at=time → Auto pause (30min ကျော်ရင် resume)
// ═══════════════════════════════════════════════════════════════
async function isBotPausedForCustomer(customer: any): Promise<boolean> {
  if (!customer?.bot_paused) return false;
  if (!customer?.paused_at) return true;

  const elapsed = Date.now() - new Date(customer.paused_at).getTime();
  if (elapsed >= AUTO_RESUME_MS) {
    console.log(`Auto-resuming bot for customer ${customer.id} after 30 minutes`);
    await supabaseQuery(
      "customers", "PATCH",
      { bot_paused: false, paused_at: null },
      `id=eq.${customer.id}`
    );
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE ECHO HANDLER
// Admin က Messenger ကနေ ဖြေတိုင်း —
//   → conversations table ထဲ admin message save
//   → bot_paused=true + paused_at=now (30min auto-resume)
// ═══════════════════════════════════════════════════════════════
async function handleMessageEcho(event: any): Promise<void> {
  try {
    if (!event.message?.is_echo) return;

    const customerPsid = event.recipient?.id;
    if (!customerPsid) return;

    const customer = await getOrCreateCustomer(customerPsid);
    if (!customer?.id) return;

    const adminMessageText = event.message?.text || "[Media or attachment]";

    await supabaseQuery("conversations", "POST", {
      customer_id: customer.id,
      message_type: "admin",
      message_text: adminMessageText,
      metadata: { source: "messenger_echo" },
    });

    await supabaseQuery(
      "customers", "PATCH",
      { bot_paused: true, paused_at: new Date().toISOString() },
      `id=eq.${customer.id}`
    );

    console.log(`Admin replied to customer ${customer.id} — bot paused 30 min`);
  } catch (e: any) {
    console.error("handleMessageEcho error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION
// ═══════════════════════════════════════════════════════════════
async function getConversationHistory(customerId: number, limit = 20) {
  if (!customerId) return [];
  try {
    return (
      await supabaseQuery(
        "conversations", "GET", null,
        `customer_id=eq.${customerId}&select=*&order=created_at.desc&limit=${limit}`
      )
    ) || [];
  } catch {
    return [];
  }
}

async function saveConversation(
  customerId: number,
  messageType: string,
  messageText: string
) {
  if (!customerId) return;
  try {
    await supabaseQuery("conversations", "POST", {
      customer_id: customerId,
      message_type: messageType,
      message_text: messageText,
      metadata: {},
    });
  } catch (e: any) {
    console.error("saveConversation error:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════
async function getProducts() {
  try {
    return (
      await supabaseQuery("products", "GET", null, "is_active=eq.true&select=*")
    ) || [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// STOCK MANAGEMENT
//
// လက်ရှိ Logic (မူရင်း — မှားသည်):
//   Order save → ချက်ချင်း stock နှုတ်တယ်
//   Cancel ဖြစ်ရင် stock ပြန်မထည့်ဘူး
//
// ပြင်ဆင်ပြီး Logic (ဒီ version):
//   Order save → stock မနှုတ်သေးဘဲ "reserved" အဖြစ် သဘောထားမယ်
//   Dashboard မှာ Confirmed နှိပ် → webhook ကို API call လုပ်မယ် → stock နှုတ်မယ်
//   Dashboard မှာ Cancelled နှိပ် → stock ပြန်ထည့်မယ်
//   has_active_order → confirmed/cancelled နှစ်ခုစလုံးမှာ false ပြန်ထားမယ်
//
// NOTE: Dashboard (Lovable) ဘက်မှာ confirmed/cancelled button တွေမှာ
// ဒီ endpoint တွေကို call လုပ်ဖို့ ထပ်ထည့်ပေးရမယ်:
//   PATCH /api/orders/confirm  → { order_id, customer_psid }
//   PATCH /api/orders/cancel   → { order_id, customer_psid }
// ═══════════════════════════════════════════════════════════════
async function deductStock(productId: number, quantity: number) {
  try {
    const product = await supabaseQuery(
      "products", "GET", null,
      `id=eq.${productId}&select=stock_quantity,name`
    );
    if (!product || product.length === 0) return;
    const newStock = Math.max(0, (product[0].stock_quantity || 0) - quantity);
    await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
    console.log(`Stock deducted: product ${productId}, qty ${quantity}, remaining ${newStock}`);
  } catch (e: any) {
    console.error("deductStock error:", e);
  }
}

async function restoreStock(productId: number, quantity: number) {
  try {
    const product = await supabaseQuery(
      "products", "GET", null,
      `id=eq.${productId}&select=stock_quantity,name`
    );
    if (!product || product.length === 0) return;
    const newStock = (product[0].stock_quantity || 0) + quantity;
    await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
    console.log(`Stock restored: product ${productId}, qty ${quantity}, new total ${newStock}`);
  } catch (e: any) {
    console.error("restoreStock error:", e);
  }
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
    const result = await supabaseQuery(
      "conversation_context", "GET", null,
      `customer_id=eq.${customerId}&select=*`
    );
    return result && result.length > 0 ? result[0] : null;
  } catch {
    return null;
  }
}

async function updateContext(customerId: number, data: any) {
  if (!customerId) return;
  try {
    const existing = await getContext(customerId);
    if (existing) {
      await supabaseQuery(
        "conversation_context", "PATCH",
        { ...data, updated_at: new Date().toISOString() },
        `customer_id=eq.${customerId}`
      );
    } else {
      await supabaseQuery("conversation_context", "POST", {
        customer_id: customerId,
        ...data,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (e: any) {
    console.error("updateContext error:", e);
  }
}

function parsePreferences(preferences: any) {
  const defaults = {
    address: "",
    collecting_order: false,
    pending_product: null as string | null,
    pending_product_id: null as number | null,
    pending_order: null as any,
    has_active_order: false,
  };
  if (!preferences) return defaults;
  try {
    const p =
      typeof preferences === "string" && preferences.startsWith("{")
        ? JSON.parse(preferences)
        : typeof preferences === "object"
        ? preferences
        : null;
    if (!p)
      return typeof preferences === "string" && preferences !== "pending"
        ? { ...defaults, address: preferences }
        : defaults;
    return {
      address: p.address ?? "",
      collecting_order: p.collecting_order || false,
      pending_product: p.pending_product || null,
      pending_product_id: p.pending_product_id || null,
      pending_order: p.pending_order || null,
      has_active_order: p.has_active_order || false,
    };
  } catch {
    return defaults;
  }
}

// ═══════════════════════════════════════════════════════════════
// AI TRAINING CONFIG FETCH
// is_active=true တွေကိုပဲ ယူမယ်
// ═══════════════════════════════════════════════════════════════
async function getActiveTrainingInstructions(): Promise<string> {
  try {
    const configs = await supabaseQuery(
      "ai_training_config", "GET", null,
      "is_active=eq.true&select=system_prompt,content&order=created_at.asc"
    );
    if (!configs || configs.length === 0) return "";
    const instructions = configs
      .map((c: any) => c.content || c.system_prompt || "")
      .filter((text: string) => text.trim().length > 0)
      .join("\n• ");
    return instructions ? `• ${instructions}` : "";
  } catch (e: any) {
    console.error("getActiveTrainingInstructions error:", e.message);
    return "";
  }
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
        messages: [
          {
            role: "user",
            content: `နာမည် "${name}" က ယောကျ်ားလေးလား မိန်းကလေးလား? JSON format နဲ့သာ:\n{"gender":"male"} or {"gender":"female"} or {"gender":"unknown"}`,
          },
        ],
        max_tokens: 20,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );
    const raw = response.data.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (parsed.gender === "male") return "အကို";
    if (parsed.gender === "female") return "အမ";
    return "";
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════
// FACEBOOK SEND — Text
// ═══════════════════════════════════════════════════════════════
async function sendMessage(recipientId: string, text: string) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      { recipient: { id: recipientId }, message: { text } },
      {
        params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Send message error:", error?.response?.data || error.message);
    await notifySystemError(
      `Facebook Send Error: ${error?.response?.data?.error?.message || error.message}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// FACEBOOK SEND — Image
// MEDIA_ENABLED = true မှသာ အလုပ်လုပ်မယ်
// ═══════════════════════════════════════════════════════════════
async function sendImageMessage(recipientId: string, imageUrl: string): Promise<void> {
  if (!MEDIA_ENABLED || !imageUrl?.trim()) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: { url: imageUrl, is_reusable: false },
          },
        },
      },
      {
        params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log(`Image sent to ${recipientId}: ${imageUrl}`);
  } catch (e: any) {
    console.error("sendImageMessage error:", e?.response?.data || e.message);
    await notifyOwnerTelegram(
      `⚠️ ပုံပို့၍ မရဘဲ error ဖြစ်နေပါတယ်\n\n` +
        `URL: ${imageUrl}\n` +
        `Error: ${e?.response?.data?.error?.message || e.message}\n\n` +
        `Customer ဆီ ပုံကိုယ်တိုင် ပို့ပေးပါ`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// SEND PRODUCT IMAGES
// image_url = main photo, image_url2 = spec photo
// ═══════════════════════════════════════════════════════════════
async function sendProductImages(recipientId: string, product: any): Promise<void> {
  if (!MEDIA_ENABLED || !product) return;

  if (product.image_url) {
    await sendImageMessage(recipientId, product.image_url);
  }
  if (product.image_url2) {
    await new Promise(resolve => setTimeout(resolve, 500));
    await sendImageMessage(recipientId, product.image_url2);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AI RESPONSE
// ═══════════════════════════════════════════════════════════════
async function generateAIResponse(
  psid: string,
  messageText: string
): Promise<{ reply: string; productToShow: any | null }> {
  const fallback = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";

  try {
    const customer = await getOrCreateCustomer(psid);
    if (!customer?.id) return { reply: fallback, productToShow: null };

    const [history, products, context, trainingInstructions] = await Promise.all([
      getConversationHistory(customer.id, 20),
      getProducts(),
      getContext(customer.id),
      getActiveTrainingInstructions(),
    ]);

    const prefs = parsePreferences(context?.preferences);

    // ── First-time greeting ──
    if (!context?.preferences && history.length === 0) {
      await updateContext(customer.id, {
        preferences: { address: "", collecting_order: false, has_active_order: false },
      });
      const greeting =
        "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\n" +
        "အိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ " +
        "သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ " +
        "ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", greeting);
      return { reply: greeting, productToShow: null };
    }

    const productList = products
      .map(
        (p: any) =>
          `• ID:${p.id} | ${p.name} | ${Number(p.price_mmk).toLocaleString()} MMK` +
          (p.description ? `\n  ${p.description}` : "") +
          (p.filter_stages ? `\n  Filter: ${p.filter_stages}` : "") +
          (p.filter_precision ? ` | ${p.filter_precision}` : "")
      )
      .join("\n\n");

    const historyMessages = [...history].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    const addressRule = prefs.address
      ? `ဖောက်သည်ကို "${prefs.address}" ဟုသာ ခေါ်ပါ။`
      : `ဖောက်သည်ကို နာမ်စားဖြင့် မခေါ်ပါနဲ့။ ယဉ်ကျေးစွာ ဆက်သွယ်ပါ။`;

    const orderContext = prefs.collecting_order
      ? `\n\n⚠️ လက်ရှိ အော်ဒါ ကောက်နေဆဲ (Product: ${prefs.pending_product || "မသေချာသေး"})။ နာမည်၊ ဖုန်းနံပါတ်၊ လိပ်စာ ရယူနေသည်။`
      : "";

    // FIX: has_active_order=true ဆိုရင် AI ကို ထပ်မကောက်ရ သတိပေးမယ်
    const activeOrderWarning = prefs.has_active_order
      ? `\n\n🔒 CRITICAL: ဤ Customer ၏ အော်ဒါ submit ပြီးသားဖြစ်သည်။ "ဟုတ်ကဲ့"၊ "အိုကေ"၊ "ကောင်းပြီ"၊ "ဟုတ်" ကဲ့သို့ confirm စကားများကို အော်ဒါအသစ်အဖြစ် လုံးဝမသတ်မှတ်ရ။ action="save_order" ကို လုံးဝမသုံးရ။`
      : "";

    const trainingSection = trainingInstructions
      ? `\n━━━ Client ညွှန်ကြားချက်များ (လိုက်နာရမည်) ━━━\n${trainingInstructions}`
      : "";

    const systemPrompt = `သင်သည် EIREE MYANMAR ၏ Professional အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။

━━━ စကားပြောပုံစံ ━━━
• ${addressRule} "ရှင့်" မသုံးနဲ့။
• မိမိကို "ခင်ဗျာ" သုံးပါ။
• သဘာဝကျကျ၊ နွေးထွေးစွာ ပြောပါ။ Reply တစ်ခုကို ၄-၅ ကြောင်းထက် မပိုပါနဲ့။
• Bullet point ကြီးများ ရှောင်ပါ။${trainingSection}

━━━ Response Format ━━━
သင်သည် အမြဲ JSON format နဲ့ respond ရမည်:
{
  "reply": "Customer ဆီပို့မယ့် message သာပါရမည်",
  "action": "none" | "start_order" | "save_order" | "notify_owner" | "show_product",
  "product_id": null | number,
  "order_data": null | { "product_id": number, "product_name": string },
  "collected_data": null | { "name": string, "phone": string, "address": string, "quantity": number }
}

━━━ Action Rules ━━━
• "none" — ပုံမှန် conversation
• "show_product" — Customer က product တစ်ခုကို focus ပြီး မေးတဲ့အခါ (product_id ထည့်ပေးပါ)
• "start_order" — Customer က ဝယ်ယူလိုသော intent ရှိမှသာ
• "save_order" — name + phone + address ၃ ခုစလုံး ရပြီးမှသာ
  ⚠️ has_active_order=true ဆိုရင် save_order လုံးဝမသုံးရ
  ⚠️ "ဟုတ်ကဲ့"၊ "အိုကေ"၊ "ကောင်းပြီ" ကဲ့သို့ confirm စကားကို order အသစ်အဖြစ် မသတ်မှတ်ရ
• "notify_owner" — AI မဖြေနိုင်သော မေးခွန်း၊ မသေချာသော ဈေးနှုန်း

━━━ Smart Context Handling ━━━
${orderContext}${activeOrderWarning}
• အော်ဒါ ကောက်နေချိန် ကြားဖြတ်မေးခွန်းရင် → ဖြေပြီးမှ ပြန်ဆက်၊ action: "none"
• cancel သဘောထားရှိရင် → collecting_order ရပ်၊ action: "none"

━━━ ဈေးနှုန်း STRICT RULE ━━━
⚠️ Product list ထဲကဟာကိုသာ ပြောပါ။
⚠️ မသေချာသော ဈေးနှုန်း → action: "notify_owner" — Customer ဆီ ဈေးနှုန်း မပြောဘဲ owner ဆီ ပို့ပါ။
⚠️ Stock အကြောင်း လုံးဝမပြောရ — ရှိတယ်ဖြစ်ဖြစ် မရှိဘူးဖြစ်ဖြစ် Customer ကို မပြောရ။
⚠️ reply field ထဲမှာ placeholder text မပါရ — "ဈေးနှုန်းဖြည့်ပါ"၊ "[ဖြည့်ပါ]" မျိုး လုံးဝမထည့်ရ။
⚠️ Product တစ်ခုအကြောင်း ဖြေတဲ့အခါ — ဈေးနှုန်း၊ filter stage တွေကို သဘာဝကျကျ စကားပြောသလို ဖြေပါ။ ပုံပို့မည့်အခါမှသာ "ပုံလေးပါ တစ်ပါတည်းကြည့်နိုင်ပါတယ်ခင်ဗျာ 👇" ထည့်ပါ။

━━━ Products ━━━
${productList}`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: messageText },
        ],
        max_tokens: 500,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const rawContent = response.data.choices[0]?.message?.content || "{}";

    // ═══════════════════════════════════════════════════════════════
    // AI RESPONSE PARSER
    // FIX: AI က "json\n{...}" ပုံစံပြန်ရင် { ကို ရှာပြီး parse မယ်
    // ဒါမှ JSON တစ်ခုလုံး Customer ဆီ မရောက်နိုင်ဘူး
    // ═══════════════════════════════════════════════════════════════
    let aiResponse: any = {
      reply: fallback,
      action: "none",
      product_id: null,
      order_data: null,
      collected_data: null,
    };
    try {
      // ① markdown fence နဲ့ "json" prefix တွေ ဖယ်မယ်
      const stripped = rawContent
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      if (stripped.startsWith("{")) {
        // ② တိုက်ရိုက် JSON
        aiResponse = JSON.parse(stripped);
      } else {
        // ③ "json" prefix ပါပြီး { ရှိရင် ထုတ်မယ်
        const jsonStart = stripped.indexOf("{");
        if (jsonStart !== -1) {
          aiResponse = JSON.parse(stripped.slice(jsonStart));
        } else {
          // ④ Plain text ဆိုရင် reply အဖြစ် သုံးမယ်
          aiResponse.reply = stripped;
        }
      }
    } catch {
      // ⑤ Parse မရရင် raw text ကို sanitize လုပ်ပြီး သုံးမယ်
      aiResponse.reply = sanitizeReply(rawContent);
    }

    const safeReply = sanitizeReply(aiResponse.reply || fallback);
    const action = aiResponse.action || "none";

    // ── SHOW PRODUCT ──
    let productToShow: any = null;
    if (action === "show_product" && aiResponse.product_id) {
      productToShow = products.find((p: any) => p.id === aiResponse.product_id) || null;
    }

    // ── START ORDER ──
    if (action === "start_order" && aiResponse.order_data) {
      // FIX: product_id မရှိရင် product name နဲ့ match လုပ်မယ်
      // products[0] ကို blind ယူတဲ့ logic ဖယ်လိုက်ပြီ
      const product =
        products.find((p: any) => p.id === aiResponse.order_data.product_id) ||
        products.find((p: any) => p.name === aiResponse.order_data.product_name) ||
        products.find((p: any) =>
          aiResponse.order_data.product_name
            ?.toLowerCase()
            .includes(p.name.toLowerCase())
        ) ||
        null; // Product မတွေ့ရင် null — ယူဆမလုပ်ဘူး

      await updateContext(customer.id, {
        preferences: {
          address: prefs.address,
          collecting_order: true,
          pending_product: product?.name || aiResponse.order_data.product_name || null,
          pending_product_id: product?.id || null,
          has_active_order: false,
        },
      });
    }

    // ── SAVE ORDER ──
    // FIX 1: has_active_order=true ဆိုရင် duplicate order မဖြစ်အောင် block
    // FIX 2: product မသေချာရင် order မကောက်ဘဲ owner ကို notify လုပ်မယ်
    // FIX 3: Stock ကို order save အချိန်မှာ မနှုတ်တော့ဘဲ
    //        Dashboard မှာ Confirmed နှိပ်မှ နှုတ်မယ် (order-confirm endpoint မှာ)
    if (action === "save_order" && aiResponse.collected_data) {
      if (prefs.has_active_order) {
        // Duplicate order — block လုပ်မယ်
        console.log(`Duplicate order blocked for customer ${customer.id} — has_active_order=true`);
      } else {
        const { name, phone, address, quantity } = aiResponse.collected_data;
        if (name && phone && address) {
          // Product ကို pending_product_id ကနေ ယူမယ် — ပိုသေချာတယ်
          const product = prefs.pending_product_id
            ? products.find((p: any) => p.id === prefs.pending_product_id)
            : prefs.pending_product
            ? products.find(
                (p: any) =>
                  p.name === prefs.pending_product ||
                  p.name.toLowerCase().includes((prefs.pending_product || "").toLowerCase())
              )
            : null; // Product မသေချာရင် null — blind ယူမလုပ်ဘူး

          // Product မတွေ့ရင် owner ကို notify လုပ်ပြီး မကောက်ဘဲနေမယ်
          if (!product) {
            await notifyOwnerTelegram(
              `⚠️ Order တစ်ခု product မရှင်းသေးဘဲ ဝင်လာတယ်\n\n` +
                `Customer: ${sanitizeTelegramText(name)}\n` +
                `Phone: ${sanitizeTelegramText(phone)}\n` +
                `Address: ${sanitizeTelegramText(address)}\n` +
                `Product ပြောတာ: ${sanitizeTelegramText(prefs.pending_product || "မပြောဘဲ")}\n\n` +
                `Dashboard မှာ စစ်ပြီး manual order ဖန်တီးပေးပါ`
            );
            await notifyOwnerDashboard(
              customer.id,
              "human_support_needed",
              "⚠️ Product မရှင်းသေး Order",
              `${name} | ${phone} | ${address} — Product မသေချာ`
            );
          } else {
            const isPreorder = product.stock_quantity <= 0;
            const totalPrice = Number(product.price_mmk) * (quantity || 1);
            const detectedGender = await detectGenderFromName(name);
            const finalAddress = detectedGender || prefs.address;

            const order = await saveOrder({
              customer_id: customer.id,
              product_id: product.id,
              full_name: name,
              phone_number: phone,
              delivery_address: address,
              quantity: quantity || 1,
              total_price_mmk: totalPrice,
              // FIX: Stock ဒီမှာ မနှုတ်တော့ဘူး
              // status = pending → Dashboard မှာ Confirmed နှိပ်မှ stock နှုတ်မယ်
              status: isPreorder ? "preorder" : "pending",
            });

            if (order) {
              const orderLabel = isPreorder ? "(Pre-order)" : "";
              // FIX: sanitizeTelegramText သုံးမယ် — Notification error မဖြစ်အောင်
              await notifyOwnerDashboard(
                customer.id,
                "new_order",
                `🛒 အော်ဒါအသစ် ${orderLabel}`,
                `${name} | ${phone} | ${address} | ${product.name} x${quantity || 1} | ${totalPrice.toLocaleString()} MMK`
              );

              await notifyOwnerTelegram(
                `🛒 အော်ဒါအသစ် ဝင်လာပါပြီ ${orderLabel}\n\n` +
                  `👤 ${sanitizeTelegramText(name)}\n` +
                  `📞 ${sanitizeTelegramText(phone)}\n` +
                  `📍 ${sanitizeTelegramText(address)}\n` +
                  `📦 ${sanitizeTelegramText(product.name)} x${quantity || 1}\n` +
                  `💰 ${totalPrice.toLocaleString()} MMK\n\n` +
                  `👉 Dashboard မှာ confirm လုပ်ပေးပါ`
              );

              // has_active_order = true — Duplicate order ကာကွယ်မယ်
              await updateContext(customer.id, {
                preferences: {
                  address: finalAddress,
                  collecting_order: false,
                  pending_product: null,
                  pending_product_id: null,
                  has_active_order: true,
                },
              });
            }
          }
        }
      }
    }

    // ── NOTIFY OWNER ──
    if (action === "notify_owner") {
      await notifyOwnerDashboard(
        customer.id,
        "human_support_needed",
        "🙋 ကိုယ်တိုင်ဖြေရမည်",
        `Customer: ${messageText}`
      );
      await notifyOwnerTelegram(
        `🙋 ကိုယ်တိုင်ဖြေပေးဖို့ လိုအပ်ပါတယ်\n\n` +
          `Customer မေးတာ: ${sanitizeTelegramText(messageText)}\n\n` +
          `Dashboard မှာ reply လုပ်ပေးပါ`
      );
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", safeReply);
    return { reply: safeReply, productToShow };

  } catch (error: any) {
    console.error("generateAIResponse error:", error);
    await notifySystemError(`generateAIResponse: ${error.message}`);
    return { reply: fallback, productToShow: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER CONFIRM ENDPOINT
// Dashboard မှာ "Confirmed" နှိပ်တဲ့အခါ ဒီ endpoint ကို call လုပ်ရမယ်
// → Stock နှုတ်မယ်
// → has_active_order = false reset လုပ်မယ် (Customer ထပ်ဝယ်နိုင်အောင်)
// → orders table status = "confirmed" update လုပ်မယ်
//
// Dashboard (Lovable) မှာ Confirmed button မှာ ဒါကို ထပ်ထည့်ပေးရမယ်:
// fetch('/api/webhook?action=confirm-order', {
//   method: 'POST',
//   body: JSON.stringify({ order_id, customer_psid, product_id, quantity })
// })
// ═══════════════════════════════════════════════════════════════
async function handleOrderConfirm(body: any): Promise<void> {
  const { order_id, customer_psid, product_id, quantity } = body;
  if (!order_id) return;

  try {
    // ① Order status → confirmed
    await supabaseQuery("orders", "PATCH", { status: "confirmed" }, `id=eq.${order_id}`);

    // ② Stock နှုတ်မယ် (confirmed မှ နှုတ်တယ် — cancel ဖြစ်ရင် ပြန်ထည့်နိုင်မယ်)
    if (product_id && quantity) {
      await deductStock(product_id, quantity);
    }

    // ③ has_active_order = false reset — Customer ထပ်ဝယ်နိုင်မယ်
    if (customer_psid) {
      const customer = await getOrCreateCustomer(customer_psid);
      if (customer?.id) {
        const context = await getContext(customer.id);
        const prefs = parsePreferences(context?.preferences);
        await updateContext(customer.id, {
          preferences: { ...prefs, has_active_order: false },
        });
      }
    }

    console.log(`Order ${order_id} confirmed — stock deducted, has_active_order reset`);
  } catch (e: any) {
    console.error("handleOrderConfirm error:", e);
    await notifySystemError(`Order Confirm Error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER CANCEL ENDPOINT
// Dashboard မှာ "Cancelled" နှိပ်တဲ့အခါ ဒီ endpoint ကို call လုပ်ရမယ်
// → Stock ပြန်ထည့်မယ် (confirmed ပြီးတဲ့ order cancel ဖြစ်ရင်)
// → has_active_order = false reset လုပ်မယ်
// → orders table status = "cancelled" update လုပ်မယ်
// ═══════════════════════════════════════════════════════════════
async function handleOrderCancel(body: any): Promise<void> {
  const { order_id, customer_psid, product_id, quantity, was_confirmed } = body;
  if (!order_id) return;

  try {
    // ① Order status → cancelled
    await supabaseQuery("orders", "PATCH", { status: "cancelled" }, `id=eq.${order_id}`);

    // ② Confirmed ပြီးတဲ့ order cancel ဖြစ်ရင်သာ stock ပြန်ထည့်မယ်
    // Pending order cancel ဆိုရင် stock မနှုတ်ဘဲဆဲဆဲမို့ ပြန်မထည့်ရ
    if (was_confirmed && product_id && quantity) {
      await restoreStock(product_id, quantity);
    }

    // ③ has_active_order = false reset — Customer ထပ်ဝယ်နိုင်မယ်
    if (customer_psid) {
      const customer = await getOrCreateCustomer(customer_psid);
      if (customer?.id) {
        const context = await getContext(customer.id);
        const prefs = parsePreferences(context?.preferences);
        await updateContext(customer.id, {
          preferences: { ...prefs, has_active_order: false },
        });
      }
    }

    console.log(`Order ${order_id} cancelled — stock ${was_confirmed ? "restored" : "unchanged"}, has_active_order reset`);
  } catch (e: any) {
    console.error("handleOrderCancel error:", e);
    await notifySystemError(`Order Cancel Error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {

  // ── GET: Facebook Webhook Verification ──
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    const body = req.body;

    // ── Dashboard Order Confirm ──
    if (req.query.action === "confirm-order") {
      await handleOrderConfirm(body);
      return res.status(200).json({ success: true });
    }

    // ── Dashboard Order Cancel ──
    if (req.query.action === "cancel-order") {
      await handleOrderCancel(body);
      return res.status(200).json({ success: true });
    }

    // ── Facebook Messenger Webhook ──
    if (body.object === "page") {
      try {
        const tasks: Promise<void>[] = [];

        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            const messageId = event.message?.mid;
            if (!senderId) continue;

            tasks.push(
              (async () => {
                try {
                  // ── STEP 1: ECHO CHECK ──
                  if (event.message?.is_echo) {
                    await handleMessageEcho(event);
                    return;
                  }

                  // ── STEP 2: DEDUPLICATION ──
                  if (messageId) {
                    if (await isMessageProcessed(messageId)) {
                      console.log(`Skipping duplicate: ${messageId}`);
                      return;
                    }
                    await markMessageProcessed(messageId);
                  }

                  // ── STEP 3: CUSTOMER ──
                  const customer = await getOrCreateCustomer(senderId);

                  // ── STEP 4: BOT PAUSE CHECK ──
                  if (await isBotPausedForCustomer(customer)) {
                    console.log(`Bot paused for customer ${customer.id} — saving message`);
                    if (event.message?.text) {
                      await saveConversation(customer.id, "customer", event.message.text);
                    }
                    return;
                  }

                  // ── STEP 5: AI RESPONSE ──
                  if (event.message?.text) {
                    const { reply, productToShow } = await generateAIResponse(
                      senderId,
                      event.message.text
                    );

                    // Race condition ကာကွယ် — Admin ဝင်ဖြေပြီးသွားရင် bot reply မပို့ရ
                    const freshCheck = await supabaseQuery(
                      "customers", "GET", null,
                      `psid=eq.${senderId}&select=bot_paused`
                    );
                    if (freshCheck?.[0]?.bot_paused) {
                      console.log("Bot paused after AI — reply discarded");
                      return;
                    }

                    await sendMessage(senderId, reply);

                    if (productToShow) {
                      await new Promise(resolve => setTimeout(resolve, 300));
                      await sendProductImages(senderId, productToShow);
                    }

                  } else if (event.message) {
                    // Text မဟုတ်တဲ့ message (ပုံ၊ sticker etc.)
                    const msgType = Object.keys(event.message)
                      .filter(k => k !== "mid" && k !== "seq")
                      .join(", ");
                    await sendMessage(
                      senderId,
                      "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏"
                    );
                    await notifyOwnerDashboard(
                      customer.id,
                      "non_text_message",
                      "📎 Text မဟုတ်တဲ့ Message",
                      `Customer ပို့တာ: ${msgType}`
                    );
                    await notifyOwnerTelegram(
                      `📎 Text မဟုတ်တဲ့ Message\nအမျိုးအစား: ${msgType}\n👉 Dashboard မှာ ကြည့်ပြီး ပြန်ဆက်သွယ်ပေးပါ`
                    );
                  }
                } catch (innerErr: any) {
                  console.error("Task error:", innerErr);
                  await notifySystemError(`Task Error: ${innerErr.message}`);
                }
              })()
            );
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