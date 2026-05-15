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
// AUTO-RESUME DURATION — 30 မိနစ်
// ═══════════════════════════════════════════════════════════════
const AUTO_RESUME_MS = 30 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// MEDIA ENABLED — ပုံပို့မည့် feature
// true = Bot က product ဖြေတဲ့အခါ ပုံပါ တစ်ပါတည်းပို့မယ်
// ═══════════════════════════════════════════════════════════════
const MEDIA_ENABLED = true;

// ═══════════════════════════════════════════════════════════════
// OUTPUT SANITIZER
// ═══════════════════════════════════════════════════════════════
function sanitizeReply(text: string): string {
  if (!text) return "";
  let cleaned = text
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
    .replace(/ဈေးနှုန်းဖြည့်ပါ/g, "")
    .replace(/\[.*?ဖြည့်ပါ.*?\]/g, "")
    .replace(/\[COMMAND:.*?\]/g, "")
    .replace(/\[ACTION:.*?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
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
    return created ? created[0] : { id: null, psid, bot_paused: false, paused_at: null };
  } catch (e: any) {
    console.error("getOrCreateCustomer error:", e);
    return { id: null, psid, bot_paused: false, paused_at: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// BOT PAUSE CHECK WITH AUTO-RESUME
// bot_paused=true + paused_at=NULL    → Dashboard manual pause
// bot_paused=true + paused_at=time   → Auto pause (30min ကျော်ရင် resume)
// ═══════════════════════════════════════════════════════════════
async function isBotPausedForCustomer(customer: any): Promise<boolean> {
  if (!customer?.bot_paused) return false;
  if (!customer?.paused_at) return true;

  const elapsed = Date.now() - new Date(customer.paused_at).getTime();
  if (elapsed >= AUTO_RESUME_MS) {
    console.log(`Auto-resuming bot for customer ${customer.id} after 30 minutes`);
    await supabaseQuery("customers", "PATCH",
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
//   → bot_paused=true + paused_at=timestamp set (30min auto-resume)
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

    await supabaseQuery("customers", "PATCH",
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
// PRODUCTS
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

function parsePreferences(preferences: any) {
  const defaults = {
    address: "",
    collecting_order: false,
    pending_product: null as string | null,
    pending_order: null as any,
    has_active_order: false,
  };
  if (!preferences) return defaults;
  try {
    const p = typeof preferences === "string" && preferences.startsWith("{")
      ? JSON.parse(preferences)
      : typeof preferences === "object" ? preferences : null;
    if (!p) return typeof preferences === "string" && preferences !== "pending"
      ? { ...defaults, address: preferences } : defaults;
    return {
      address: p.address ?? "",
      collecting_order: p.collecting_order || false,
      pending_product: p.pending_product || null,
      pending_order: p.pending_order || null,
      has_active_order: p.has_active_order || false,
    };
  } catch { return defaults; }
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
// FACEBOOK SEND — Text message
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
// FACEBOOK SEND — Image message
// Product ဖြေတဲ့အခါ ပုံပါ တစ်ပါတည်းပို့မယ်
// MEDIA_ENABLED = true မှသာ အလုပ်လုပ်မယ်
// ═══════════════════════════════════════════════════════════════
async function sendImageMessage(recipientId: string, imageUrl: string): Promise<void> {
  if (!MEDIA_ENABLED || !imageUrl?.trim()) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } }
      },
      { params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN }, headers: { "Content-Type": "application/json" } }
    );
    console.log(`Image sent to ${recipientId}: ${imageUrl}`);
  } catch (e: any) {
    console.error("sendImageMessage error:", e?.response?.data || e.message);
await notifyOwnerTelegram(
  `⚠️ *ပုံပို့၍ မရဘဲ error ဖြစ်နေပါတယ်*\n\n` +
  `📎 URL: ${imageUrl}\n` +
  `❌ Error: ${e?.response?.data?.error?.message || e.message}\n\n` +
  `👉 Customer ဆီ ပုံကိုယ်တိုင် ပို့ပေးပါ`
);
  }
}

// ═══════════════════════════════════════════════════════════════
// SEND PRODUCT IMAGES
// Product တစ်ခုအတွက် ပုံ ၁ ပုံ သို့မဟုတ် ၂ ပုံ ပို့မယ်
// image_url = main photo, image_url2 = spec/detail photo
// ═══════════════════════════════════════════════════════════════
async function sendProductImages(recipientId: string, product: any): Promise<void> {
  if (!MEDIA_ENABLED) return;
  if (!product) return;

  // Main photo ပို့မယ်
  if (product.image_url) {
    await sendImageMessage(recipientId, product.image_url);
  }

  // Spec/detail photo ရှိရင် ထပ်ပို့မယ်
  if (product.image_url2) {
    // နည်းနည်း delay ပေးမယ် — Messenger မှာ order မမှားအောင်
    await new Promise(resolve => setTimeout(resolve, 500));
    await sendImageMessage(recipientId, product.image_url2);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AI RESPONSE
// ═══════════════════════════════════════════════════════════════
async function generateAIResponse(psid: string, messageText: string): Promise<{
  reply: string;
  productToShow: any | null;
}> {
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

    if (!context?.preferences && history.length === 0) {
      await updateContext(customer.id, {
        preferences: { address: "", collecting_order: false, has_active_order: false },
      });
      const greeting = "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nအိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", greeting);
      return { reply: greeting, productToShow: null };
    }

    const productList = products.map((p: any) => {
      const stockStatus = p.stock_quantity > 0 ? "Stock ရှိပါတယ်" : "Stock မရှိ (Pre-order ရနိုင်)";
      return `• ID:${p.id} | ${p.name} | ${Number(p.price_mmk).toLocaleString()} MMK | ${stockStatus}${p.description ? `\n  ${p.description}` : ""}`;
    }).join("\n\n");

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
  "reply": "Customer ဆီပို့မယ့် message",
  "action": "none" | "start_order" | "save_order" | "notify_owner" | "show_product",
  "product_id": null | number,
  "order_data": null | { "product_id": number, "product_name": string, "is_preorder": boolean },
  "collected_data": null | { "name": string, "phone": string, "address": string, "quantity": number }
}

━━━ Action Rules ━━━
• "none" — ပုံမှန် conversation
"show_product" — Customer က product တစ်ခုတည်းအကြောင်း focus ပြီး မေးတဲ့အခါ၊ ပုံကြည့်ချင်တဲ့သဘော ရှိတဲ့အခါ၊ ဘယ်လိုပုံစံလဲ/ဘယ်လိုစမျိုးလဲ မေးတဲ့အခါ၊ product တစ်ခုရဲ့ spec တိတိကျကျ သိချင်တဲ့အခါ — Customer က ပုံဆိုသောစကား မပါရင်တောင် product တစ်ခုကိုသာ focus ပြီး မေးနေရင် show_product သုံးပါ
  → product_id ထည့်ပေးပါ (ဘယ် product ရဲ့ ပုံပို့မလဲ)
• "start_order" — Customer က ဝယ်ယူလိုသော intent ရှိမှသာ
• "save_order" — name + phone + address ၃ ခုစလုံး ရပြီးမှသာ
• "notify_owner" — AI မဖြေနိုင်သော မေးခွန်း

━━━ Smart Context Handling ━━━
${orderContext}
• အော်ဒါ ကောက်နေချိန် ကြားဖြတ်မေးခွန်းရင် → ဖြေပြီးမှ ပြန်ဆက်၊ action: "none"
• cancel သဘောထားရှိရင် → collecting_order ရပ်၊ action: "none"

━━━ ဈေးနှုန်း STRICT RULE ━━━
⚠️ Product list ထဲကဟာကိုသာ ပြောပါ။
⚠️ Stock အရေအတွက် ဘယ်တော့မှ မပြောရ — "Stock ရှိပါတယ်" / "Pre-order ရနိုင်" သာပြောရ။
⚠️ မသေချာသော ဈေးနှုန်း → action: "notify_owner"

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
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    const rawContent = response.data.choices[0]?.message?.content || "{}";

    let aiResponse: any = { reply: fallback, action: "none", product_id: null, order_data: null, collected_data: null };
    try {
      const cleaned = rawContent.replace(/```json|```/g, "").trim();
      if (cleaned.startsWith("{")) {
        aiResponse = JSON.parse(cleaned);
      } else {
        aiResponse.reply = cleaned;
      }
    } catch {
      aiResponse.reply = rawContent;
    }

    const safeReply = sanitizeReply(aiResponse.reply || fallback);
    const action = aiResponse.action || "none";

    // ── SHOW PRODUCT — ပုံပို့မည့် product ရှာမယ် ──
    let productToShow: any = null;
    if (action === "show_product" && aiResponse.product_id) {
      productToShow = products.find((p: any) => p.id === aiResponse.product_id) || null;
    }

    // ── START ORDER ──
    if (action === "start_order" && aiResponse.order_data) {
      const product = products.find((p: any) => p.id === aiResponse.order_data.product_id)
        || products.find((p: any) => p.name === aiResponse.order_data.product_name)
        || products.find((p: any) => aiResponse.order_data.product_name?.toLowerCase().includes(p.name.toLowerCase()));

      await updateContext(customer.id, {
        preferences: {
          address: prefs.address,
          collecting_order: true,
          pending_product: product?.name || aiResponse.order_data.product_name,
          pending_product_id: product?.id || null,
          is_preorder: product ? product.stock_quantity <= 0 : false,
          has_active_order: false,
        },
      });
    }

    // ── SAVE ORDER ──
    if (action === "save_order" && aiResponse.collected_data) {
      const { name, phone, address, quantity } = aiResponse.collected_data;
      if (name && phone && address) {
        const product = prefs.pending_product
          ? products.find((p: any) =>
              p.name === prefs.pending_product ||
              p.name.toLowerCase().includes((prefs.pending_product || "").toLowerCase()))
          : products[0];

        const isPreorder = product && product.stock_quantity <= 0;
        const totalPrice = product ? Number(product.price_mmk) * (quantity || 1) : 0;
        const detectedGender = await detectGenderFromName(name);
        const finalAddress = detectedGender || prefs.address;

        const order = await saveOrder({
          customer_id: customer.id,
          product_id: product?.id || null,
          full_name: name,
          phone_number: phone,
          delivery_address: address,
          quantity: quantity || 1,
          total_price_mmk: totalPrice,
          status: isPreorder ? "preorder" : "pending",
        });

        if (order) {
          if (product?.id) await deductStock(product.id, quantity || 1);
          const orderLabel = isPreorder ? "(Pre-order)" : "";

          await notifyOwnerDashboard(
            customer.id, "new_order",
            `🛒 အော်ဒါအသစ် ${orderLabel}`,
            `👤 ${name} | 📞 ${phone} | 📍 ${address} | 📦 ${product?.name} x${quantity || 1} | 💰 ${totalPrice.toLocaleString()} MMK`
          );

          await notifyOwnerTelegram(
            `🛒 *အော်ဒါအသစ် ဝင်လာပါပြီ* ${orderLabel}\n\n` +
            `👤 *${name}*\n📞 ${phone}\n📍 ${address}\n` +
            `📦 ${product?.name} x${quantity || 1}\n` +
            `💰 *${totalPrice.toLocaleString()} MMK*\n\n` +
            `👉 Dashboard မှာ confirm လုပ်ပေးပါ`
          );

          await updateContext(customer.id, {
            preferences: {
              address: finalAddress,
              collecting_order: false,
              pending_product: null,
              has_active_order: true,
            },
          });
        }
      }
    }

    // ── NOTIFY OWNER ──
    if (action === "notify_owner") {
      await notifyOwnerDashboard(customer.id, "human_support_needed", "🙋 ကိုယ်တိုင်ဖြေရမည်", `Customer: ${messageText}`);
      await notifyOwnerTelegram(
        `🙋 *ကိုယ်တိုင်ဖြေပေးဖို့ လိုအပ်ပါတယ်*\n\nCustomer မေးတာ: *${messageText}*\n\n👉 Dashboard မှာ reply လုပ်ပေးပါ`
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
// MAIN WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {

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

                // ── STEP 1: ECHO CHECK (အရင်ဆုံး) ──
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
                  console.log(`Bot paused for customer ${customer.id} — skipping AI, saving message`);
                  if (event.message?.text) {
                    await saveConversation(customer.id, "customer", event.message.text);
                  }
                  return;
                }

                // ── STEP 5: AI RESPONSE ──
                if (event.message?.text) {
                  const { reply, productToShow } = await generateAIResponse(senderId, event.message.text);

                  // Race condition ကာကွယ်
                  const freshCheck = await supabaseQuery("customers", "GET", null, `psid=eq.${senderId}&select=bot_paused`);
                  if (freshCheck?.[0]?.bot_paused) {
                    console.log("Bot paused after AI response — reply discarded");
                    return;
                  }

                  // Text reply ပို့မယ်
                  await sendMessage(senderId, reply);

                  // Product ပုံ ရှိရင် ထပ်ပို့မယ် (text ပြီးမှ)
                  if (productToShow) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await sendProductImages(senderId, productToShow);
                  }

                } else if (event.message) {
                  // Text မဟုတ်တဲ့ message
                  const msgType = Object.keys(event.message)
                    .filter(k => k !== "mid" && k !== "seq").join(", ");
                  const reply = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
                  await sendMessage(senderId, reply);
                  await notifyOwnerDashboard(customer.id, "non_text_message", "📎 Text မဟုတ်တဲ့ Message", `Customer ပို့တာ: ${msgType}`);
                  await notifyOwnerTelegram(`📎 *Text မဟုတ်တဲ့ Message*\nအမျိုးအစား: *${msgType}*\n👉 Dashboard မှာ ကြည့်ပြီး ပြန်ဆက်သွယ်ပေးပါ`);
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