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
// OUTPUT SANITIZER (MUST)
// AI reply ထဲမှာ internal patterns တွေ ပါလာရင် ဖယ်ထုတ်မယ်
// Customer ဆီ သန့်ရှင်းတဲ့ text သက်သက်ပဲ ရောက်ရမယ်
// ═══════════════════════════════════════════════════════════════
function sanitizeReply(text: string): string {
  if (!text) return "";

  let cleaned = text
    // Internal command patterns
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
    // ဈေးနှုန်းဖြည့်ပါ ကဲ့သို့သော ပြဿနာဖြစ်ဖူးသော patterns
    .replace(/ဈေးနှုန်းဖြည့်ပါ/g, "")
    .replace(/\[.*?ဖြည့်ပါ.*?\]/g, "")
    // Bracket commands
    .replace(/\[COMMAND:.*?\]/g, "")
    .replace(/\[ACTION:.*?\]/g, "")
    // Extra blank lines
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
    return created ? created[0] : { id: null, psid, bot_paused: false };
  } catch (e: any) {
    console.error("getOrCreateCustomer error:", e);
    return { id: null, psid, bot_paused: false };
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
// ORDER DETAILS PARSER
// ═══════════════════════════════════════════════════════════════
async function parseOrderDetails(messageText: string): Promise<{
  name: string | null; phone: string | null; address: string | null; quantity: number;
}> {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: `Customer message: "${messageText}"\n\nExtract ONLY with valid JSON, no markdown:\n{"name":null,"phone":null,"address":null,"quantity":1}`,
        }],
        max_tokens: 150,
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 10000 }
    );
    const raw = response.data.choices[0]?.message?.content || "{}";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { return { name: null, phone: null, address: null, quantity: 1 }; }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AI RESPONSE — AI ကပဲ flow ထိန်းမယ်
// ═══════════════════════════════════════════════════════════════
async function generateAIResponse(psid: string, messageText: string): Promise<string> {
  const fallback = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";

  try {
    const customer = await getOrCreateCustomer(psid);
    if (!customer?.id) return fallback;

    const [history, products, context] = await Promise.all([
      getConversationHistory(customer.id, 20),
      getProducts(),
      getContext(customer.id),
    ]);

    const prefs = parsePreferences(context?.preferences);

    // ── First message ──
    if (!context?.preferences && history.length === 0) {
      await updateContext(customer.id, {
        preferences: { address: "", collecting_order: false, has_active_order: false },
      });
      const greeting = "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nအိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", greeting);
      return greeting;
    }

    // ── Product list ──
    const productList = products.map((p: any) => {
      const stockStatus = p.stock_quantity > 0 ? "Stock ရှိပါတယ်" : "Stock မရှိ (Pre-order ရနိုင်)";
      return `• ID:${p.id} | ${p.name} | ${Number(p.price_mmk).toLocaleString()} MMK | ${stockStatus}${p.description ? `\n  ${p.description}` : ""}`;
    }).join("\n\n");

    // ── Conversation history ──
    const historyMessages = [...history].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    // ── Address rule ──
    const addressRule = prefs.address
      ? `ဖောက်သည်ကို "${prefs.address}" ဟုသာ ခေါ်ပါ။`
      : `ဖောက်သည်ကို နာမ်စားဖြင့် မခေါ်ပါနဲ့။ ယဉ်ကျေးစွာ ဆက်သွယ်ပါ။`;

    // ── Collecting order context ──
    const orderContext = prefs.collecting_order
      ? `\n\n⚠️ လက်ရှိ အော်ဒါ ကောက်နေဆဲ ဖြစ်သည် (Product: ${prefs.pending_product || "မသေချာသေး"})။ ဖောက်သည်ထံမှ နာမည်၊ ဖုန်းနံပါတ်၊ လိပ်စာ ရယူနေသည်။`
      : "";

    // ══════════════════════════════════════════════════════
    // SYSTEM PROMPT — AI ကပဲ flow ထိန်းမယ်
    // Internal commands မသုံးဘဲ JSON response နဲ့ communicate
    // ══════════════════════════════════════════════════════
    const systemPrompt = `သင်သည် EIREE MYANMAR ၏ Professional အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။

━━━ စကားပြောပုံစံ ━━━
• ${addressRule} "ရှင့်" မသုံးနဲ့။
• မိမိကို "ခင်ဗျာ" သုံးပါ။
• သဘာဝကျကျ၊ နွေးထွေးစွာ ပြောပါ။ Reply တစ်ခုကို ၄-၅ ကြောင်းထက် မပိုပါနဲ့။
• Bullet point ကြီးများ ရှောင်ပါ။

━━━ Response Format ━━━
သင်သည် အမြဲ JSON format နဲ့ respond ရမည်:
{
  "reply": "Customer ဆီပို့မယ့် message",
  "action": "none" | "start_order" | "save_order" | "notify_owner",
  "order_data": null | { "product_id": number, "product_name": string, "is_preorder": boolean },
  "collected_data": null | { "name": string, "phone": string, "address": string, "quantity": number }
}

━━━ Action Rules ━━━
• "none" — ပုံမှန် conversation
• "start_order" — Customer က ဝယ်ယူလိုသော intent ရှိမှသာ (မှာမယ်၊ ဝယ်မယ်၊ ယူမယ် — တိတိကျကျသော intent)
• "save_order" — Customer က name + phone + address ၃ ခုစလုံး ပေးပြီးမှသာ
• "notify_owner" — AI မဖြေနိုင်သော မေးခွန်း (တပ်ဆင်ချိန်၊ delivery date၊ အာမခံ)

━━━ Smart Context Handling (MUST) ━━━
${orderContext}
• အော်ဒါ ကောက်နေချိန်မှာ Customer က တစ်ခြားမေးခွန်း ကြားဖြတ်မေးလာရင်:
  1. အဲ့ဒီ မေးခွန်းကို ဦးစွာ ဖြေပါ
  2. ပြီးမှ "နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး ဆက်ပြောပေးပါနော်" ဆိုပြီး သဘာဝကျကျ ပြန်ဆက်ပါ
  3. action: "none" ထားပါ (state မပြောင်းဘဲ)
• Customer က name/phone/address မပါဘဲ တစ်ခြားပြောနေရင် → action: "none"
• Customer က cancel လိုချင်တဲ့ သဘောထားရှိရင် → collecting_order ရပ်ပြီး action: "none"

━━━ ဈေးနှုန်း STRICT RULE ━━━
⚠️ Product list ထဲကဟာကိုသာ ပြောပါ။
⚠️ Stock အရေအတွက် (ဘယ်နှလုံး) ဘယ်တော့မှ မပြောရ — "Stock ရှိပါတယ်" / "Pre-order ရနိုင်" သာပြောရ။
⚠️ မသေချာသော ဈေးနှုန်း → action: "notify_owner"

━━━ Products ━━━
${productList}`;

    // ── AI Call ──
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

    // ── Parse AI JSON response ──
    let aiResponse: any = { reply: fallback, action: "none", order_data: null, collected_data: null };
    try {
      const cleaned = rawContent.replace(/```json|```/g, "").trim();
      // JSON ထဲမှာ reply ပါရင် parse လုပ်
      if (cleaned.startsWith("{")) {
        aiResponse = JSON.parse(cleaned);
      } else {
        // AI က plain text ပြန်ခဲ့ရင် reply အဖြစ် treat
        aiResponse.reply = cleaned;
      }
    } catch {
      // Parse မအောင်မြင်ရင် raw content ကို reply အဖြစ် သုံး
      aiResponse.reply = rawContent;
    }

    // ── Output Sanitizer (MUST) ──
    const safeReply = sanitizeReply(aiResponse.reply || fallback);

    // ── Action Handler ──
    const action = aiResponse.action || "none";

    // START ORDER — collecting_order state on
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

    // SAVE ORDER — name + phone + address ၃ ခုစလုံး ရပြီ
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

        // Gender detect
        const detectedGender = await detectGenderFromName(name);
        const finalAddress = detectedGender || prefs.address;

        // Save order
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

          const sal = finalAddress ? ` ${finalAddress}` : "";
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

          // State update — order complete
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

    // NOTIFY OWNER — AI မဖြေနိုင်သော မေးခွန်း
    if (action === "notify_owner") {
      await notifyOwnerDashboard(customer.id, "human_support_needed", "🙋 ကိုယ်တိုင်ဖြေရမည်", `Customer: ${messageText}`);
      await notifyOwnerTelegram(
        `🙋 *ကိုယ်တိုင်ဖြေပေးဖို့ လိုအပ်ပါတယ်*\n\nCustomer မေးတာ: *${messageText}*\n\n👉 Dashboard မှာ reply လုပ်ပေးပါ`
      );
    }

    // ── Save conversation ──
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", safeReply);
    return safeReply;

  } catch (error: any) {
    console.error("generateAIResponse error:", error);
    await notifySystemError(`generateAIResponse: ${error.message}`);
    return fallback;
  }
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