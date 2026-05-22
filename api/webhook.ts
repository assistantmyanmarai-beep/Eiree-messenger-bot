import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const FACEBOOK_WEBHOOK_VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OWNER_TELEGRAM_BOT_TOKEN = process.env.OWNER_TELEGRAM_BOT_TOKEN;
const OWNER_TELEGRAM_CHAT_ID = process.env.OWNER_TELEGRAM_CHAT_ID;

const AUTO_RESUME_MS = 30 * 60 * 1000;
const MEDIA_ENABLED = true;

// ═══════════════════════════════════════════════════════════════
// MYANMAR NUMBER NORMALIZER
// ═══════════════════════════════════════════════════════════════
function normalizeMyanmarNumbers(text: string): string {
  return text
    .replace(/၀/g, "0").replace(/၁/g, "1").replace(/၂/g, "2")
    .replace(/၃/g, "3").replace(/၄/g, "4").replace(/၅/g, "5")
    .replace(/၆/g, "6").replace(/၇/g, "7").replace(/၈/g, "8")
    .replace(/၉/g, "9");
}

// ═══════════════════════════════════════════════════════════════
// GENDER DETECT FROM SPEECH PATTERN
// ═══════════════════════════════════════════════════════════════
function detectGenderFromSpeechPattern(text: string): string {
  if (!text) return "";
  if (/ရှင့်|ရှင်|နော်\s*$|ကွယ်/.test(text)) return "female";
  if (/ဗျ\s*$|ဗျာ\s*$|ကွ\s*$|ကွာ\s*$|ဟဲ\s*$/.test(text)) return "male";
  return "";
}

// ═══════════════════════════════════════════════════════════════
// GENDER DETECT FROM NAME (AI)
// ═══════════════════════════════════════════════════════════════
async function detectGenderFromName(name: string): Promise<string> {
  if (!name || name.length < 2) return "";
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: `နာမည် "${name}" က ယောကျ်ားလေးလား မိန်းကလေးလား? JSON format နဲ့သာ:\n{"gender":"male"} or {"gender":"female"} or {"gender":"unknown"}` }],
        max_tokens: 20,
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 5000 }
    );
    const raw = response.data.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (parsed.gender === "male") return "male";
    if (parsed.gender === "female") return "female";
    return "";
  } catch { return ""; }
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM SANITIZER
// ═══════════════════════════════════════════════════════════════
function sanitizeTelegramText(text: string): string {
  if (!text) return "";
  return text.replace(/[*_`[\]]/g, "");
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT SANITIZER
// ═══════════════════════════════════════════════════════════════
function sanitizeReply(text: string): string {
  if (!text) return "";
  let cleaned = text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/^\s*\{[\s\S]*\}\s*$/gm, "")
    .replace(/\{[\s\S]*?"reply"[\s\S]*?\}/g, "")
    .replace(/```json[\s\S]*?```/gi, "")
    .replace(/```[\s\S]*?```/gi, "")
    .replace(/"(reply|action|product_id|product_ids|order_data|collected_data)":\s*(?:"[^"]*"|\{[^}]*\}|\[[^\]]*\]|null|true|false|\d+),?\s*/gi, "")
    .replace(/^\s*[{}[\]]\s*$/gm, "")
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
    .replace(/ID:\d+\s*\|?\s*/g, "")
    .replace(/ပုံလေးပါ\s*တစ်ပါတည်းကြည့်နိုင်ပါတယ်[^၊။\n]*/g, "")
    .replace(/တစ်ပါတည်းကြည့်နိုင်ပါတယ်ခင်ဗျာ\s*👇/g, "")
    .replace(/👇/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[\*\-]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || "ကျွန်တော်တို့ team မှ မကြာမီ ပြန်လည် ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
}

// ═══════════════════════════════════════════════════════════════
// ORDER DATA EXTRACTOR
// ═══════════════════════════════════════════════════════════════
function extractOrderDataFromMessage(messageText: string): {
  name: string | null; phone: string | null; address: string | null;
} {
  const result = { name: null as string | null, phone: null as string | null, address: null as string | null };
  const normalizedText = normalizeMyanmarNumbers(messageText).replace(/\s+/g, "");
  const phoneMatch = normalizedText.match(/09\d{7,9}/);
  if (phoneMatch) result.phone = phoneMatch[0];
  const lines = messageText.split(/[\n،,]/).map(l => l.trim()).filter(l => l.length > 1);
  const nonPhoneLines = lines.filter(l => !normalizeMyanmarNumbers(l).replace(/\s+/g, "").match(/09\d{7,9}/));
  if (nonPhoneLines.length >= 1) result.name = nonPhoneLines[0];
  if (nonPhoneLines.length >= 2) result.address = nonPhoneLines[nonPhoneLines.length - 1];
  return result;
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
      chat_id: TELEGRAM_CHAT_ID, text: `System Error\n\n${msg}`,
    });
  } catch (e: any) { console.error("System Telegram error:", e.message); }
}

async function notifyOwnerTelegram(msg: string) {
  if (!OWNER_TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${OWNER_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_CHAT_ID, text: msg,
    });
  } catch (e: any) { console.error("Owner Telegram error:", e.message); }
}

async function notifyOwnerDashboard(customerId: number, type: string, title: string, content: string, orderId: number | null = null) {
  if (!customerId) return;
  try {
    await supabaseQuery("owner_notifications", "POST", {
      notification_type: type, customer_id: customerId,
      order_id: orderId, title, content,
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
// ═══════════════════════════════════════════════════════════════
async function isBotPausedForCustomer(customer: any): Promise<boolean> {
  if (!customer?.bot_paused) return false;
  if (!customer?.paused_at) return true;
  const elapsed = Date.now() - new Date(customer.paused_at).getTime();
  if (elapsed >= AUTO_RESUME_MS) {
    await supabaseQuery("customers", "PATCH", { bot_paused: false, paused_at: null }, `id=eq.${customer.id}`);
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE ECHO HANDLER
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
      customer_id: customer.id, message_type: "admin",
      message_text: adminMessageText, metadata: { source: "messenger_echo" },
    });
    await supabaseQuery("customers", "PATCH",
      { bot_paused: true, paused_at: new Date().toISOString() },
      `id=eq.${customer.id}`
    );
  } catch (e: any) { console.error("handleMessageEcho error:", e.message); }
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

async function saveConversation(customerId: number, messageType: string, messageText: string, metadata?: any) {
  if (!customerId) return;
  try {
    await supabaseQuery("conversations", "POST", {
      customer_id: customerId, message_type: messageType,
      message_text: messageText, metadata: metadata || {},
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

function findProductFromHistory(history: any[], products: any[]): any {
  const botMessages = history
    .filter((h: any) => h.message_type === "bot")
    .map((h: any) => h.message_text || "")
    .join(" ");
  for (const product of products) {
    if (botMessages.includes(product.name)) return product;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// STOCK MANAGEMENT
// ═══════════════════════════════════════════════════════════════
async function deductStock(productId: number, quantity: number) {
  try {
    const product = await supabaseQuery("products", "GET", null, `id=eq.${productId}&select=stock_quantity,name`);
    if (!product || product.length === 0) return;
    const newStock = Math.max(0, (product[0].stock_quantity || 0) - quantity);
    await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
  } catch (e: any) { console.error("deductStock error:", e); }
}

async function restoreStock(productId: number, quantity: number) {
  try {
    const product = await supabaseQuery("products", "GET", null, `id=eq.${productId}&select=stock_quantity,name`);
    if (!product || product.length === 0) return;
    const newStock = (product[0].stock_quantity || 0) + quantity;
    await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
  } catch (e: any) { console.error("restoreStock error:", e); }
}

// ═══════════════════════════════════════════════════════════════
// ORDER SAVE
// ═══════════════════════════════════════════════════════════════
async function processSaveOrder(
  customerId: number, psid: string, name: string, phone: string,
  address: string, quantity: number, product: any, prefs: any
) {
  const isPreorder = product.stock_quantity <= 0;
  const totalPrice = Number(product.price_mmk) * (quantity || 1);
  const genderFromName = await detectGenderFromName(name);
  const existingGender = prefs.detected_gender || "";
  const finalGender = genderFromName || existingGender;
  const genderTitle = finalGender === "male" ? "အကို" : finalGender === "female" ? "အမ" : "";

  const order = await supabaseQuery("orders", "POST", {
    customer_id: customerId, product_id: product.id, full_name: name,
    phone_number: phone, delivery_address: address,
    quantity: quantity || 1, total_price_mmk: totalPrice,
    status: isPreorder ? "preorder" : "pending",
  });

  if (order) {
    const orderLabel = isPreorder ? "(Pre-order)" : "";
    await notifyOwnerDashboard(customerId, "new_order",
      `🛒 အော်ဒါအသစ် ${orderLabel}`,
      `${name} | ${phone} | ${address} | ${product.name} x${quantity || 1} | ${totalPrice.toLocaleString()} MMK`
    );
    await notifyOwnerTelegram(
      `🛒 အော်ဒါအသစ် ဝင်လာပါပြီ ${orderLabel}\n\n` +
      `👤 ${sanitizeTelegramText(name)}\n📞 ${sanitizeTelegramText(phone)}\n` +
      `📍 ${sanitizeTelegramText(address)}\n📦 ${sanitizeTelegramText(product.name)} x${quantity || 1}\n` +
      `💰 ${totalPrice.toLocaleString()} MMK\n🔑 Customer ID: ${psid}\n\n👉 Dashboard မှာ confirm လုပ်ပေးပါ`
    );
    await updateContext(customerId, {
      preferences: {
        address: "", collecting_order: false, pending_product: null,
        pending_product_id: null, has_active_order: true,
        detected_gender: finalGender, customer_name: name, gender_title: genderTitle,
      },
    });
    console.log(`Order saved for customer ${customerId} — ${product.name}`);
    return true;
  }
  return false;
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
        { ...data, updated_at: new Date().toISOString() }, `customer_id=eq.${customerId}`
      );
    } else {
      await supabaseQuery("conversation_context", "POST", {
        customer_id: customerId, ...data, updated_at: new Date().toISOString(),
      });
    }
  } catch (e: any) { console.error("updateContext error:", e); }
}

function parsePreferences(preferences: any) {
  const defaults = {
    address: "", collecting_order: false,
    pending_product: null as string | null, pending_product_id: null as number | null,
    has_active_order: false, detected_gender: "" as string,
    customer_name: "" as string, gender_title: "" as string,
  };
  if (!preferences) return defaults;
  try {
    const p = typeof preferences === "string" && preferences.startsWith("{")
      ? JSON.parse(preferences) : typeof preferences === "object" ? preferences : null;
    if (!p) return defaults;
    return {
      address: p.address ?? "", collecting_order: p.collecting_order || false,
      pending_product: p.pending_product || null, pending_product_id: p.pending_product_id || null,
      has_active_order: p.has_active_order || false, detected_gender: p.detected_gender || "",
      customer_name: p.customer_name || "", gender_title: p.gender_title || "",
    };
  } catch { return defaults; }
}

// ═══════════════════════════════════════════════════════════════
// AI TRAINING CONFIG
// ═══════════════════════════════════════════════════════════════
async function getActiveTrainingInstructions(): Promise<string> {
  try {
    const configs = await supabaseQuery("ai_training_config", "GET", null,
      "is_active=eq.true&select=system_prompt,content&order=created_at.asc");
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
// FACEBOOK SEND — Text (chunk split for long messages)
// ═══════════════════════════════════════════════════════════════
async function sendMessage(recipientId: string, text: string) {
  const MAX_LENGTH = 1500;
  if (text.length <= MAX_LENGTH) {
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
    return;
  }
  const paragraphs = text.split(/\n\n+/);
  let chunk = "";
  for (const para of paragraphs) {
    if ((chunk + "\n\n" + para).length > MAX_LENGTH) {
      if (chunk) {
        try {
          await axios.post(
            `https://graph.facebook.com/v18.0/me/messages`,
            { recipient: { id: recipientId }, message: { text: chunk.trim() } },
            { params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN }, headers: { "Content-Type": "application/json" } }
          );
        } catch (error: any) { console.error("Send chunk error:", error?.response?.data || error.message); }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      chunk = para;
    } else {
      chunk = chunk ? chunk + "\n\n" + para : para;
    }
  }
  if (chunk) {
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/me/messages`,
        { recipient: { id: recipientId }, message: { text: chunk.trim() } },
        { params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN }, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) { console.error("Send last chunk error:", error?.response?.data || error.message); }
  }
}

// ═══════════════════════════════════════════════════════════════
// FACEBOOK SEND — Image
// ═══════════════════════════════════════════════════════════════
async function sendImageMessage(recipientId: string, imageUrl: string): Promise<void> {
  if (!MEDIA_ENABLED || !imageUrl?.trim()) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } }
      },
      { params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN }, headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("sendImageMessage error:", e?.response?.data || e.message);
    await notifyOwnerTelegram(
      `⚠️ ပုံပို့၍ မရဘဲ error ဖြစ်နေပါတယ်\nURL: ${imageUrl}\nError: ${e?.response?.data?.error?.message || e.message}\nCustomer ဆီ ပုံကိုယ်တိုင် ပို့ပေးပါ`
    );
  }
}

async function sendProductImages(recipientId: string, product: any, customerId?: number): Promise<void> {
  if (!MEDIA_ENABLED || !product) return;
  if (product.image_url) {
    await sendImageMessage(recipientId, product.image_url);
    if (customerId) await saveConversation(customerId, "bot", product.image_url, { image_url: product.image_url });
  }
  if (product.image_url2) {
    await new Promise(resolve => setTimeout(resolve, 500));
    await sendImageMessage(recipientId, product.image_url2);
    if (customerId) await saveConversation(customerId, "bot", product.image_url2, { image_url: product.image_url2 });
  }
}

async function sendMultipleProductImages(recipientId: string, productList: any[], customerId?: number): Promise<void> {
  if (!MEDIA_ENABLED || !productList?.length) return;
  for (const product of productList) {
    await sendMessage(recipientId, `${product.name}\n${Number(product.price_mmk).toLocaleString()} ကျပ်`);
    await new Promise(resolve => setTimeout(resolve, 300));
    if (product.image_url) {
      await sendImageMessage(recipientId, product.image_url);
      if (customerId) await saveConversation(customerId, "bot", product.image_url, { image_url: product.image_url });
    }
    if (product.image_url2) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await sendImageMessage(recipientId, product.image_url2);
      if (customerId) await saveConversation(customerId, "bot", product.image_url2, { image_url: product.image_url2 });
    }
    await new Promise(resolve => setTimeout(resolve, 800));
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AI RESPONSE
// ═══════════════════════════════════════════════════════════════
async function generateAIResponse(psid: string, messageText: string): Promise<{
  reply: string;
  productToShow: any | null;
  productsToShow: any[];
}> {
  const fallback = "ကျွန်တော်တို့ team မှ မကြာမီ ပြန်လည် ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";

  try {
    const customer = await getOrCreateCustomer(psid);
    if (!customer?.id) return { reply: fallback, productToShow: null, productsToShow: [] };

    const [history, products, context, trainingInstructions] = await Promise.all([
      getConversationHistory(customer.id, 20),
      getProducts(),
      getContext(customer.id),
      getActiveTrainingInstructions(),
    ]);

    const prefs = parsePreferences(context?.preferences);

    // ── Speech pattern gender detect ──
    if (!prefs.detected_gender) {
      const speechGender = detectGenderFromSpeechPattern(messageText);
      if (speechGender) {
        const genderTitle = speechGender === "male" ? "အကို" : "အမ";
        await updateContext(customer.id, {
          preferences: { ...prefs, detected_gender: speechGender, gender_title: genderTitle },
        });
        prefs.detected_gender = speechGender;
        prefs.gender_title = genderTitle;
      }
    }

    // ── First-time greeting ──
    if (!context?.preferences && history.length === 0) {
      await updateContext(customer.id, {
        preferences: { address: "", collecting_order: false, has_active_order: false, detected_gender: "", customer_name: "", gender_title: "" },
      });
      const greeting = "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nအိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", greeting);
      return { reply: greeting, productToShow: null, productsToShow: [] };
    }

    const productListForAI = products.map((p: any) =>
      `• [ID:${p.id}] ${p.name} | ${Number(p.price_mmk).toLocaleString()} MMK` +
      (p.description ? ` | ${p.description}` : "") +
      (p.filter_stages ? ` | Filter: ${p.filter_stages}` : "") +
      (p.filter_precision ? ` | ${p.filter_precision}` : "")
    ).join("\n");

    const historyMessages = [...history].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    let addressRule = "";
    if (prefs.gender_title && prefs.customer_name) {
      addressRule = `Customer ကို "${prefs.gender_title} ${prefs.customer_name}" ဟုသာ ခေါ်ပါ။`;
    } else if (prefs.gender_title) {
      addressRule = `Customer ကို "${prefs.gender_title}" ဟုသာ ခေါ်ပါ။`;
    } else {
      addressRule = `Customer gender မသေချာသောကြောင့် နာမ်စားဖြင့် မခေါ်ပါနဲ့။ ယဉ်ကျေးစွာ ဆက်သွယ်ပါ။`;
    }

    const orderContext = prefs.collecting_order
      ? `\n\n⚠️ လက်ရှိ အော်ဒါ ကောက်နေဆဲ (Product: ${prefs.pending_product || "မသေချာသေး"})။` : "";

    const activeOrderWarning = prefs.has_active_order
      ? `\n\n🔒 CRITICAL: ဤ Customer ၏ အော်ဒါ submit ပြီးသားဖြစ်သည်။ action="save_order" ကို လုံးဝမသုံးရ။` : "";

    const trainingSection = trainingInstructions
      ? `\n━━━ Client ညွှန်ကြားချက်များ ━━━\n${trainingInstructions}` : "";

    const systemPrompt = `သင်သည် EIREE MYANMAR ၏ Professional အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။

━━━ Customer ဆက်သွယ်ပုံ ━━━
• ${addressRule}
• "ရှင့်" "ခင်ဗျားရဲ့" ကဲ့သို့ ရိုင်းသော နာမ်စားများ လုံးဝမသုံးရ။
• မိမိကိုယ်ကို "ကျွန်တော်" ဟုသာ ရည်ညွှန်းပါ။
• သဘာဝကျကျ၊ နွေးထွေးစွာ ပရော်ဖက်ရှင်နယ်ဆန်ဆန် ပြောပါ။
• Markdown မသုံးရ — ** * # formatting လုံးဝမသုံးရ။ Plain text သာ သုံးပါ။
• \\n escape sequence တွေ reply ထဲ မထည့်ရ။
• Product ID တွေ ([ID:x]) ကို reply ထဲ လုံးဝမထည့်ရ။${trainingSection}

━━━ Reply Length Rules ━━━
⚠️ ပုံမှန် conversation → ၃-၄ ကြောင်းသာ ပြောပါ။
⚠️ Customer က အသေးစိတ်ရှင်းပြခိုင်းမှသာ → paragraph တွေခွဲပြီး ရှင်းပြပါ။
⚠️ Technical details တွေ တပြိုင်တည်း မတန်းစီနဲ့ — customer မေးတာကိုသာ ဖြေပါ။

━━━ Response Format ━━━
အမြဲ JSON format နဲ့ respond ရမည်။ JSON key/value တွေ "reply" text ထဲ လုံးဝမပါရ။

{
  "reply": "Customer ဆီပို့မယ့် plain Myanmar text သာ",
  "action": "none" | "show_product" | "show_products" | "start_order" | "save_order" | "notify_owner",
  "product_id": null | number,
  "product_ids": null | [number, number, ...],
  "order_data": null | { "product_id": number, "product_name": string },
  "collected_data": null | { "name": string, "phone": string, "address": string, "quantity": number }
}

━━━ Action Rules ━━━
• "none" — ပုံမှန် conversation
• "show_product" — Customer က product တစ်ခုတည်း ပုံကြည့်ချင်သောအခါ (product_id ထည့်ပါ)
  ⚠️ reply ထဲ ပုံပို့မည် hint မထည့်ရ — system က အလိုအလျောက် ပုံပို့မည်
• "show_products" — Customer က product အများကြီး ပုံကြည့်ချင်သောအခါ (product_ids array)
  ⚠️ reply ထဲ ပုံပို့မည် hint မထည့်ရ — system က တစ်ခုချင်းစီ ပုံပို့မည်
• "start_order" — Customer က ဝယ်မည်ဆိုပြီး info မပေးသေးသောအခါ
  ⚠️ name/phone/address တောင်းမည့် reply ထုတ်တိုင်း start_order ပါ တစ်ပါတည်းထွက်ရမည်
• "save_order" — name + phone + address ၃ ခုစလုံး ရပြီးဆိုရင် ချက်ချင်း သုံးပါ
  ⚠️ has_active_order=true ဆိုရင် save_order လုံးဝမသုံးရ
  ⚠️ collected_data ထဲ phone မှာ မြန်မာဂဏန်းပါရင် 09... အဖြစ် ပြောင်းပြီး ထည့်ပေးပါ
• "notify_owner" — AI မဖြေနိုင်သော မေးခွန်း၊ မသေချာသော ဈေးနှုန်း၊ delivery date

━━━ Context ━━━
${orderContext}${activeOrderWarning}

━━━ ဈေးနှုန်း Rules ━━━
⚠️ Product list ထဲကဟာကိုသာ ပြောပါ။ Product ID ကို Customer ဆီ မပြောရ။
⚠️ မသေချာသော ဈေးနှုန်း → action: "notify_owner"
⚠️ Stock အကြောင်း လုံးဝမပြောရ။

━━━ Products (internal reference only) ━━━
${productListForAI}`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: messageText },
        ],
        max_tokens: 800,
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    const rawContent = response.data.choices[0]?.message?.content || "{}";

    let aiResponse: any = {
      reply: fallback, action: "none", product_id: null,
      product_ids: null, order_data: null, collected_data: null,
    };

    try {
      const stripped = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      if (stripped.startsWith("{")) {
        aiResponse = JSON.parse(stripped);
      } else {
        const jsonStart = stripped.indexOf("{");
        if (jsonStart !== -1) {
          aiResponse = JSON.parse(stripped.slice(jsonStart));
        } else {
          aiResponse.reply = stripped;
        }
      }
    } catch {
      aiResponse.reply = sanitizeReply(rawContent);
    }

    const safeReply = sanitizeReply(aiResponse.reply || fallback);
    let action = aiResponse.action || "none";

    // ── SHOW SINGLE PRODUCT ──
    let productToShow: any = null;
    if (action === "show_product" && aiResponse.product_id) {
      productToShow = products.find((p: any) => p.id === aiResponse.product_id) || null;
    }

    // ── SHOW MULTIPLE PRODUCTS ──
    let productsToShow: any[] = [];
    if (action === "show_products" && aiResponse.product_ids?.length > 0) {
      productsToShow = aiResponse.product_ids
        .map((id: number) => products.find((p: any) => p.id === id))
        .filter(Boolean);
    }

    // ══════════════════════════════════════════════════════════════
    // POST-AI SMART IMAGE SAFETY NET
    // AI က action="none" ပြန်လာပြီး Customer က ပုံတောင်းနေရင်
    // ဒီ Customer ရဲ့ recent history ထဲမှာ mention လုပ်ခဲ့တဲ့
    // product နာမည်တွေနဲ့ match လုပ်ပြီး ပုံပို့ပေးမယ်
    // ─────────────────────────────────────────────────────────────
    // မှတ်ချက်: ဒါက pre-intercept မဟုတ်ဘဲ post-AI safety net ပါ
    // AI ကို အရင်ဆုံး ဆုံးဖြတ်ခိုင်းပြီး action="none" မှသာ run မယ်
    // Customer တစ်ယောက်စီ ကိုယ်ပိုင် history ကနေ ရှာတာမို့
    // တစ်ဦးနဲ့တစ်ဦး မရောသွားဘူး
    // ══════════════════════════════════════════════════════════════
    if (action === "none" && productToShow === null && productsToShow.length === 0) {
      const imageKeywords = ["ပုံ", "photo", "ဓာတ်ပုံ", "ပြပေး", "ကြည့်ချင်", "မြင်ချင်", "show", "image", "ပုံလေး", "ပုံပြ", "ကြည့်ပါ", "ပြပါ"];
      const isAskingForImage = imageKeywords.some(k => messageText.toLowerCase().includes(k.toLowerCase()));

      if (isAskingForImage) {
        // ဒီ Customer ရဲ့ recent history (နောက်ဆုံး ၅ ကြောင်း) + current message ပေါင်းပြီး စစ်မယ်
        const recentHistoryText = history.slice(0, 5).map((h: any) => h.message_text || "").join(" ");
        const combinedText = (messageText + " " + recentHistoryText).toLowerCase();

        // History ထဲမှာ mention လုပ်ခဲ့တဲ့ product နာမည်တွေ ရှာမယ်
        const matchedProducts = products.filter((p: any) =>
          combinedText.includes(p.name.toLowerCase())
        );

        if (matchedProducts.length === 1) {
          // Product တစ်ခုတည်း match ဆိုရင် show_product
          productToShow = matchedProducts[0];
          action = "show_product";
          console.log(`[IMAGE SAFETY NET] Single product: ${matchedProducts[0].name}`);
        } else if (matchedProducts.length > 1) {
          // Product တစ်ခုထက်ပိုရင် show_products (အကုန်ပါမယ်)
          productsToShow = matchedProducts;
          action = "show_products";
          console.log(`[IMAGE SAFETY NET] Multiple products: ${matchedProducts.map((p: any) => p.name).join(", ")}`);
        }
      }
    }

    // ── START ORDER ──
    if (action === "start_order" && aiResponse.order_data) {
      const product =
        products.find((p: any) => p.id === aiResponse.order_data.product_id) ||
        products.find((p: any) => p.name === aiResponse.order_data.product_name) ||
        products.find((p: any) => aiResponse.order_data.product_name?.toLowerCase().includes(p.name.toLowerCase())) ||
        findProductFromHistory(history, products) || null;
      await updateContext(customer.id, {
        preferences: {
          ...prefs, collecting_order: true,
          pending_product: product?.name || aiResponse.order_data.product_name || null,
          pending_product_id: product?.id || null, has_active_order: false,
        },
      });
    }

    // ── SAVE ORDER — HYBRID APPROACH ──
    if (action === "save_order" && aiResponse.collected_data && !prefs.has_active_order) {
      const { name, phone, address, quantity } = aiResponse.collected_data;
      const normalizedPhone = phone ? normalizeMyanmarNumbers(phone).replace(/\s+/g, "") : phone;
      if (name && normalizedPhone && address) {
        const product =
          (prefs.pending_product_id ? products.find((p: any) => p.id === prefs.pending_product_id) : null) ||
          (prefs.pending_product ? products.find((p: any) =>
            p.name === prefs.pending_product || p.name.toLowerCase().includes((prefs.pending_product || "").toLowerCase())
          ) : null) ||
          (aiResponse.order_data?.product_id ? products.find((p: any) => p.id === aiResponse.order_data.product_id) : null) ||
          findProductFromHistory(history, products) || null;

        if (product) {
          console.log(`[AI PATH] Saving order for customer ${customer.id}`);
          await processSaveOrder(customer.id, psid, name, normalizedPhone, address, quantity || 1, product, prefs);
        } else {
          await notifyOwnerTelegram(`⚠️ Order product မရှင်းသေး\nCustomer: ${sanitizeTelegramText(name)}\nPhone: ${sanitizeTelegramText(normalizedPhone)}\n🔑 ID: ${psid}`);
          await notifyOwnerDashboard(customer.id, "human_support_needed", "⚠️ Product မရှင်းသေး Order", `${name} | ${normalizedPhone} | ${address}`);
        }
      }
    } else if (
      action !== "save_order" && !prefs.has_active_order && prefs.collecting_order &&
      normalizeMyanmarNumbers(messageText).replace(/\s+/g, "").match(/09\d{7,9}/)
    ) {
      const extracted = extractOrderDataFromMessage(messageText);
      const { name, phone, address } = extracted;
      if (name && phone && address) {
        const product =
          (prefs.pending_product_id ? products.find((p: any) => p.id === prefs.pending_product_id) : null) ||
          (prefs.pending_product ? products.find((p: any) =>
            p.name === prefs.pending_product || p.name.toLowerCase().includes((prefs.pending_product || "").toLowerCase())
          ) : null) ||
          findProductFromHistory(history, products) || null;
        if (product) {
          console.log(`[FALLBACK PATH] Saving order for customer ${customer.id}`);
          await processSaveOrder(customer.id, psid, name, phone, address, 1, product, prefs);
        }
      }
    }

    // ── NOTIFY OWNER ──
    if (action === "notify_owner") {
      await notifyOwnerDashboard(customer.id, "human_support_needed", "🙋 ကိုယ်တိုင်ဖြေရမည်", `Customer: ${messageText}`);
      await notifyOwnerTelegram(`🙋 ကိုယ်တိုင်ဖြေပေးဖို့ လိုအပ်ပါတယ်\n\nCustomer: ${sanitizeTelegramText(messageText)}\n🔑 ID: ${psid}\n\nDashboard မှာ reply လုပ်ပေးပါ`);
    }

    // ── CODE-LEVEL START ORDER SAFETY NET ──
    if (action === "none" && !prefs.collecting_order && !prefs.has_active_order) {
      const askingForInfo = safeReply.includes("နာမည်") && (safeReply.includes("ဖုန်း") || safeReply.includes("လိပ်စာ"));
      if (askingForInfo) {
        const productFromHistory = findProductFromHistory(history, products);
        if (productFromHistory) {
          await updateContext(customer.id, {
            preferences: { ...prefs, collecting_order: true, pending_product: productFromHistory.name, pending_product_id: productFromHistory.id, has_active_order: false },
          });
        }
      }
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", safeReply);
    return { reply: safeReply, productToShow, productsToShow };

  } catch (error: any) {
    console.error("generateAIResponse error:", error);
    await notifySystemError(`generateAIResponse: ${error.message}`);
    return { reply: fallback, productToShow: null, productsToShow: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER CONFIRM
// ═══════════════════════════════════════════════════════════════
async function handleOrderConfirm(body: any): Promise<void> {
  const { order_id, customer_psid, product_id, quantity } = body;
  if (!order_id) return;
  try {
    const confirmedAt = new Date().toISOString();
    await supabaseQuery("orders", "PATCH", { status: "confirmed", confirmed_at: confirmedAt }, `id=eq.${order_id}`);
    if (product_id && quantity) await deductStock(product_id, quantity);
    if (customer_psid) {
      const customer = await getOrCreateCustomer(customer_psid);
      if (customer?.id) {
        const context = await getContext(customer.id);
        const prefs = parsePreferences(context?.preferences);
        let purchasedProductName: string | null = null;
        if (product_id) {
          const productData = await supabaseQuery("products", "GET", null, `id=eq.${product_id}&select=name`);
          purchasedProductName = productData?.[0]?.name || null;
        }
        await updateContext(customer.id, {
          preferences: { ...prefs, has_active_order: false, purchased_product: purchasedProductName, purchased_product_id: product_id || null, confirmed_at: confirmedAt },
        });
      }
    }
  } catch (e: any) {
    console.error("handleOrderConfirm error:", e);
    await notifySystemError(`Order Confirm Error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER CANCEL
// ═══════════════════════════════════════════════════════════════
async function handleOrderCancel(body: any): Promise<void> {
  const { order_id, customer_psid, product_id, quantity, was_confirmed } = body;
  if (!order_id) return;
  try {
    await supabaseQuery("orders", "PATCH", { status: "cancelled" }, `id=eq.${order_id}`);
    if (was_confirmed && product_id && quantity) await restoreStock(product_id, quantity);
    if (customer_psid) {
      const customer = await getOrCreateCustomer(customer_psid);
      if (customer?.id) {
        const context = await getContext(customer.id);
        const prefs = parsePreferences(context?.preferences);
        await updateContext(customer.id, { preferences: { ...prefs, has_active_order: false } });
      }
    }
  } catch (e: any) {
    console.error("handleOrderCancel error:", e);
    await notifySystemError(`Order Cancel Error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

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

    if (req.query.action === "confirm-order") {
      await handleOrderConfirm(body);
      return res.status(200).json({ success: true });
    }
    if (req.query.action === "cancel-order") {
      await handleOrderCancel(body);
      return res.status(200).json({ success: true });
    }

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
                if (event.message?.is_echo) {
                  await handleMessageEcho(event);
                  return;
                }

                if (messageId) {
                  if (await isMessageProcessed(messageId)) return;
                  await markMessageProcessed(messageId);
                }

                const customer = await getOrCreateCustomer(senderId);

                if (await isBotPausedForCustomer(customer)) {
                  if (event.message?.text) await saveConversation(customer.id, "customer", event.message.text);
                  return;
                }

                if (event.message?.text) {
                  const { reply, productToShow, productsToShow } = await generateAIResponse(senderId, event.message.text);

                  const freshCheck = await supabaseQuery("customers", "GET", null, `psid=eq.${senderId}&select=bot_paused`);
                  if (freshCheck?.[0]?.bot_paused) return;

                  await sendMessage(senderId, reply);

                  if (productToShow) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await sendProductImages(senderId, productToShow, customer.id);
                  }

                  if (productsToShow.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await sendMultipleProductImages(senderId, productsToShow, customer.id);
                  }

                } else if (event.message) {
                  const msgType = Object.keys(event.message).filter(k => k !== "mid" && k !== "seq").join(", ");
                  await sendMessage(senderId, "ကျွန်တော်တို့ team မှ မကြာမီ ပြန်လည် ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏");
                  await notifyOwnerDashboard(customer.id, "non_text_message", "📎 Text မဟုတ်တဲ့ Message", `Customer ပို့တာ: ${msgType}`);
                  await notifyOwnerTelegram(`📎 Text မဟုတ်တဲ့ Message\nအမျိုးအစား: ${msgType}\n🔑 ID: ${senderId}\n👉 Dashboard မှာ ကြည့်ပြီး ပြန်ဆက်သွယ်ပေးပါ`);
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