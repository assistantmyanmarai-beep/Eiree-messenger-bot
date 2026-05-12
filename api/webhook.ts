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

// System errors အတွက် (code crash, Supabase error)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Owner/Business notifications အတွက် (new order, AI uncertainty, follow-up)
const OWNER_TELEGRAM_BOT_TOKEN = process.env.OWNER_TELEGRAM_BOT_TOKEN;
const OWNER_TELEGRAM_CHAT_ID = process.env.OWNER_TELEGRAM_CHAT_ID;

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
// TELEGRAM — System errors (code/server ပြဿနာ) — developer ဆီ
// ═══════════════════════════════════════════════════════════════
async function notifySystemError(errorMessage: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🔴 *System Error*\n\n${errorMessage}`,
      parse_mode: "Markdown",
    });
  } catch (e: any) {
    console.error("System Telegram error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM — Owner/Business notifications — client ဆီ
// new order, AI uncertainty, follow-up လိုအပ်တာတွေ
// ═══════════════════════════════════════════════════════════════
async function notifyOwnerTelegram(message: string) {
  if (!OWNER_TELEGRAM_BOT_TOKEN || !OWNER_TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${OWNER_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
  } catch (e: any) {
    console.error("Owner Telegram error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICATION — Facebook retry ကြောင့် message ထပ်မဖြစ်အောင်
// ═══════════════════════════════════════════════════════════════
async function isMessageProcessed(messageId: string): Promise<boolean> {
  const result = await supabaseQuery("processed_messages", "GET", null, `message_id=eq.${messageId}&select=message_id`);
  return result && result.length > 0;
}

async function markMessageProcessed(messageId: string) {
  await supabaseQuery("processed_messages", "POST", { message_id: messageId });
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER
// ═══════════════════════════════════════════════════════════════
async function getOrCreateCustomer(psid: string) {
  const existing = await supabaseQuery("customers", "GET", null, `psid=eq.${psid}&select=*`);
  if (existing && existing.length > 0) return existing[0];
  const created = await supabaseQuery("customers", "POST", { psid });
  return created ? created[0] : { id: null, psid, bot_paused: false };
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION HISTORY
// ═══════════════════════════════════════════════════════════════
async function getConversationHistory(customerId: number, limit = 15) {
  if (!customerId) return [];
  return (await supabaseQuery("conversations", "GET", null,
    `customer_id=eq.${customerId}&select=*&order=created_at.desc&limit=${limit}`)) || [];
}

async function saveConversation(customerId: number, messageType: string, messageText: string, metadata: any = {}) {
  if (!customerId) return;
  await supabaseQuery("conversations", "POST", {
    customer_id: customerId,
    message_type: messageType,
    message_text: messageText,
    metadata,
  });
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTS — Stock number မပြော၊ ရှိ/မရှိ သာပြော
// ═══════════════════════════════════════════════════════════════
async function getProducts() {
  return (await supabaseQuery("products", "GET", null, "is_active=eq.true&select=*")) || [];
}

// ═══════════════════════════════════════════════════════════════
// STOCK DEDUCT — Order confirm တိုင်း stock နုတ်
// ═══════════════════════════════════════════════════════════════
async function deductStock(productId: number, quantity: number) {
  const product = await supabaseQuery("products", "GET", null, `id=eq.${productId}&select=stock_quantity,name`);
  if (!product || product.length === 0) return;
  const currentStock = product[0].stock_quantity || 0;
  const newStock = Math.max(0, currentStock - quantity);
  await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
  console.log(`Stock: ${product[0].name} ${currentStock} → ${newStock}`);
}

// ═══════════════════════════════════════════════════════════════
// ORDER
// ═══════════════════════════════════════════════════════════════
async function saveOrder(orderData: any) {
  return await supabaseQuery("orders", "POST", orderData);
}

// ═══════════════════════════════════════════════════════════════
// OWNER DASHBOARD NOTIFICATIONS — Dashboard ထဲမှာ ပြမယ်
// ═══════════════════════════════════════════════════════════════
async function notifyOwnerDashboard(customerId: number, type: string, title: string, content: string, orderId: number | null = null) {
  if (!customerId) return;
  await supabaseQuery("owner_notifications", "POST", {
    notification_type: type,
    customer_id: customerId,
    order_id: orderId,
    title,
    content,
  });
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════
async function getContext(customerId: number) {
  if (!customerId) return null;
  const result = await supabaseQuery("conversation_context", "GET", null, `customer_id=eq.${customerId}&select=*`);
  return result && result.length > 0 ? result[0] : null;
}

async function updateContext(customerId: number, data: any) {
  if (!customerId) return;
  const existing = await getContext(customerId);
  if (existing) {
    await supabaseQuery("conversation_context", "PATCH",
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
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT PARSER
// address="" = gender မသေချာ၊ နာမ်စားမသုံး
// ═══════════════════════════════════════════════════════════════
function parsePreferences(preferences: any): {
  address: string;
  order_state: string | null;
  pending_product: string | null;
  pending_order: any | null;
  is_preorder: boolean;
  has_active_order: boolean; // Order တင်ပြီးပြီ ဆိုတာ track လုပ်ဖို့
} {
  const defaults = {
    address: "",
    order_state: null,
    pending_product: null,
    pending_order: null,
    is_preorder: false,
    has_active_order: false,
  };
  if (!preferences) return defaults;

  if (typeof preferences === "object" && !Array.isArray(preferences)) {
    return {
      address: preferences.address ?? "",
      order_state: preferences.order_state || null,
      pending_product: preferences.pending_product || null,
      pending_order: preferences.pending_order || null,
      is_preorder: preferences.is_preorder || false,
      has_active_order: preferences.has_active_order || false,
    };
  }

  if (typeof preferences === "string") {
    if (preferences.startsWith("{")) {
      try {
        const parsed = JSON.parse(preferences);
        return {
          address: parsed.address ?? "",
          order_state: parsed.order_state || null,
          pending_product: parsed.pending_product || null,
          pending_order: parsed.pending_order || null,
          is_preorder: parsed.is_preorder || false,
          has_active_order: parsed.has_active_order || false,
        };
      } catch { return defaults; }
    }
    if (preferences !== "pending") return { ...defaults, address: preferences };
  }
  return defaults;
}

// ═══════════════════════════════════════════════════════════════
// GENDER DETECTION — နာမည်ကနေ AI နဲ့ ခန့်မှန်း
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
          content: `နာမည် "${name}" က ယောကျ်ားလေးလား မိန်းကလေးလား? JSON format နဲ့သာ ဖြေပါ:\n{"gender": "male"} သို့မဟုတ် {"gender": "female"} သို့မဟုတ် {"gender": "unknown"}`,
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
// AI TRAINING CONFIG — Dashboard ကနေ prompt ပြောင်းလို့ရအောင်
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
// FACEBOOK SEND MESSAGE
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
// MAIN AI RESPONSE
// ═══════════════════════════════════════════════════════════════
async function generateAIResponse(psid: string, messageText: string): Promise<string> {
  try {
    const customer = await getOrCreateCustomer(psid);
    if (!customer?.id) return "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";

    const [history, products, context] = await Promise.all([
      getConversationHistory(customer.id, 15),
      getProducts(),
      getContext(customer.id),
    ]);

    const prefs = parsePreferences(context?.preferences);

    // Order flow states
    if (prefs.order_state === "awaiting_details") {
      return await handleOrderDetailsCollection(customer, messageText, prefs.pending_product, prefs.address, products, context);
    }
    if (prefs.order_state === "awaiting_confirm") {
      return await handleOrderConfirmation(customer, messageText, prefs.address, context);
    }

    // ── has_active_order = true ဆိုရင် order ပြီးနောက် ဆက်မေးနေတာ ──
    // AI ကပဲ သဘာဝကျကျ ဆက်ဖြေပြီး follow-up notification ပို့
    if (prefs.has_active_order) {
      const followUpMsg = await handlePostOrderConversation(customer, messageText, prefs, history, products);
      return followUpMsg;
    }

    // First message
    if (!context?.preferences && history.length === 0) {
      await updateContext(customer.id, { preferences: { address: "", order_state: null, has_active_order: false } });
      await saveConversation(customer.id, "customer", messageText);
      const greeting = "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nအိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "bot", greeting);
      return greeting;
    }

    // Product list — stock ရှိ/မရှိ သာပြော၊ အရေအတွက် မပြော
    const productList = products.map((p: any) => {
      const stockStatus = p.stock_quantity > 0 ? "Stock ရှိပါတယ်" : "Stock မရှိ — Pre-order ရနိုင်";
      return `• ${p.name}\n  စျေး: ${Number(p.price_mmk).toLocaleString()} MMK\n  ${stockStatus}\n  ${p.description || ""}`;
    }).join("\n\n");

    const historyMessages = [...(history || [])].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    const dbPrompt = await getSystemPromptFromDB();

    const addressRule = prefs.address
      ? `ဖောက်သည်ကို "${prefs.address}" ဟုသာ ခေါ်ပါ။ "ရှင့်" လုံးဝမသုံးနဲ့။`
      : `ဖောက်သည်ကို နာမ်စားဖြင့် မခေါ်ပါနဲ့။ ယဉ်ကျေးသောစကားပြောပုံစံဖြင့်သာ ဆက်သွယ်ပါ။`;

    const defaultSystemPrompt = `သင်သည် EIREE MYANMAR ၏ ကျွမ်းကျင်သော Professional အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်ပါသည်။

━━━ စကားပြောပုံစံ ━━━
• ${addressRule}
• မိမိကို "ခင်ဗျာ" သုံးပါ။
• သဘာဝကျကျ၊ နွေးထွေးစွာ ပြောပါ။ စာကြောင်း ၃ ကြောင်းထက်မပိုပါနဲ့။
• Bullet point၊ စာရှည်ကြီး ရှောင်ပါ။

━━━ အရောင်းဗျူဟာ ━━━
• ပစ္စည်းမေးရင် အကျဉ်းချုပ်ပြောပြပြီး စိတ်ဝင်စားမှ အသေးစိတ်ဆက်ပြော။
• ပစ္စည်းရဲ့ ကောင်းကွက်ကို ထင်ရှားအောင် ပြောပပြီး ဝယ်ယူချင်အောင် လုပ်ပါ။
• Conversation history ကိုကြည့်ပြီး ဆိုလိုတဲ့ product ကို context နဲ့ နားလည်ပါ။
• Stock မရှိရင် Pre-order ရနိုင်ကြောင်း ဖော်ပြပြီး order ဆက်ကောက်ပါ။
• Stock အရေအတွက် ဘယ်တော့မှ မပြောရ — "Stock ရှိပါတယ်" / "Pre-order ရနိုင်ပါတယ်" သာပြောရ။

━━━ ဝယ်ယူလိုသော သဘောထား ━━━
Customer က ဝယ်ချင်တဲ့သဘောထား (မှာမယ်၊ ယူမယ်၊ ဝယ်မယ်၊ ပေးလိုက်တော့၊ ရချင်တယ်၊ စီစဉ်ပေးပါ) ပြသရင်:
"ORDER_INTENT_DETECTED:[product_name]"
Product မသေချာရင်: "ORDER_INTENT_DETECTED:unknown"

━━━ ဈေးနှုန်း STRICT RULES ━━━
⚠️ ဈေးနှုန်းကို product list ထဲကဟာကိုသာ ပြောပါ။
⚠️ မသေချာရင် "PRICE_UNCERTAIN" ဟုသာ ဖြေပါ။

━━━ မဖြေနိုင်တဲ့ မေးခွန်းများ ━━━
တပ်ဆင်ချိန်၊ ဘယ်ရက်ပို့မလဲ၊ အာမခံ၊ COD ရလားစသည် — "NEED_HUMAN_SUPPORT:[မေးခွန်း]" ဟုဖြေပါ။

━━━ လက်ရှိ ပစ္စည်းများ ━━━
${productList}`;

    const systemPrompt = dbPrompt
      ? dbPrompt.replace(/\$\{addressTerm\}|\{addressTerm\}/g, prefs.address).replace(/\$\{productList\}|\{productList\}/g, productList)
      : defaultSystemPrompt;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemPrompt }, ...historyMessages, { role: "user", content: messageText }],
        max_tokens: 400,
        temperature: 0.7,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 15000 }
    );

    const aiReply: string = response.data.choices[0]?.message?.content ||
      "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။";

    // ORDER_INTENT_DETECTED
    if (aiReply.startsWith("ORDER_INTENT_DETECTED:")) {
      const detectedProduct = aiReply.replace("ORDER_INTENT_DETECTED:", "").trim();
      const product = products.find((p: any) =>
        detectedProduct !== "unknown" &&
        (p.name.toLowerCase().includes(detectedProduct.toLowerCase()) ||
          detectedProduct.toLowerCase().includes(p.name.toLowerCase()))
      );
      const isPreorder = product && product.stock_quantity <= 0;

      await updateContext(customer.id, {
        preferences: {
          address: prefs.address,
          order_state: "awaiting_details",
          pending_product: detectedProduct !== "unknown" ? detectedProduct : null,
          is_preorder: isPreorder || false,
          has_active_order: false,
        },
      });

      const salutation = prefs.address ? `${prefs.address}၊ ` : "";
      const askDetails = isPreorder
        ? `${salutation}${product.name} က လက်ရှိ Stock မရှိသေးပါဘူးခင်ဗျာ။ Pre-order အနေနဲ့ ၇-၁၀ ရက်အတွင်း ပို့ပေးနိုင်ပါတယ် 😊\n\nဆက်လုပ်မယ်ဆိုရင် နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး ပြောပေးပါနော်ခင်ဗျာ။`
        : `${salutation}အော်ဒါတင်ပေးပါမယ်ခင်ဗျာ 😊 နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး တစ်ခါတည်း ပြောပေးပါနော်ခင်ဗျာ။`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", askDetails);
      return askDetails;
    }

    // PRICE_UNCERTAIN — ဈေးနှုန်းမသေချာရင် owner notify
    if (aiReply.includes("PRICE_UNCERTAIN")) {
      const uncertainMsg = "ဈေးနှုန်းနဲ့ပတ်သက်ပြီး တိကျသောအချက်အလက် ပြန်စစ်ပေးပါမယ်ခင်ဗျာ။ ခဏလေးစောင့်ပေးပါနော် 🙏";
      await notifyOwnerDashboard(customer.id, "price_query", "💰 ဈေးနှုန်းမေးခွန်း", `Customer မေးတာ: ${messageText}`);
      await notifyOwnerTelegram(`💰 *ဈေးနှုန်းမေးခွန်း — ကိုယ်တိုင်ဖြေပေးပါ*\n\nCustomer: ${messageText}\n\n👉 Dashboard မှာ reply လုပ်ပေးပါ`);
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", uncertainMsg);
      return uncertainMsg;
    }

    // NEED_HUMAN_SUPPORT — AI မဖြေနိုင်တဲ့ မေးခွန်း
    if (aiReply.startsWith("NEED_HUMAN_SUPPORT:")) {
      const question = aiReply.replace("NEED_HUMAN_SUPPORT:", "").trim();
      const supportMsg = "ကောင်းသောမေးခွန်းပါ ခင်ဗျာ 😊 ကျွန်တော်တို့ team ကနေ မကြာမီ တိကျစွာ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ။";
      await notifyOwnerDashboard(customer.id, "human_support_needed", "🙋 ကိုယ်တိုင်ဖြေရမည့်မေးခွန်း", `Customer မေးတာ: ${question}`);
      await notifyOwnerTelegram(`🙋 *ကိုယ်တိုင်ဖြေပေးဖို့ လိုအပ်ပါတယ်*\n\nCustomer မေးတာ: *${question}*\n\n👉 Dashboard မှာ reply လုပ်ပေးပါ`);
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", supportMsg);
      return supportMsg;
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", aiReply);
    return aiReply;

  } catch (error: any) {
    console.error("AI Error:", error.response?.data || error.message);
    await notifySystemError(`AI Error: ${JSON.stringify(error.response?.data || error.message)}`);
    return "ကျွန်တော်တို့ system နည်းနည်းအဆင်မပြေဖြစ်နေပါတယ်ခင်ဗျာ။ ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ် 🙏";
  }
}

// ═══════════════════════════════════════════════════════════════
// POST-ORDER CONVERSATION
// Order တင်ပြီးနောက် customer ဆက်မေးလာရင် handle လုပ်
// Order data ထပ်မတောင်းဘဲ AI က သဘာဝကျကျ ဖြေပြီး owner notify
// ═══════════════════════════════════════════════════════════════
async function handlePostOrderConversation(
  customer: any, messageText: string, prefs: any,
  history: any[], products: any[]
): Promise<string> {

  const historyMessages = [...(history || [])].reverse().map((h: any) => ({
    role: h.message_type === "customer" ? "user" : "assistant",
    content: h.message_text,
  }));

  const salutation = prefs.address ? `${prefs.address}` : "";

  // Post-order prompt — order data မတောင်းဘဲ ဆက်ဖြေ
  const postOrderPrompt = `သင်သည် EIREE MYANMAR ၏ အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်ပါသည်။

Customer သည် အော်ဒါ တင်ပြီးနောက် ထပ်မေးနေပါသည်။
${salutation ? `ဖောက်သည်ကို "${salutation}" ဟုခေါ်ပါ။` : "နာမ်စားမသုံးဘဲ ယဉ်ကျေးစွာ ပြောပါ။"}

အော်ဒါဆိုင်ရာ မေးခွန်းများ (တပ်ဆင်ချိန်၊ ဘယ်ရက်ပို့မလဲ၊ COD ရလား၊ အာမခံ):
→ "NEED_FOLLOW_UP:[မေးခွန်း]" ဟုဖြေပါ။

တခြားပစ္စည်းအကြောင်းမေးရင်:
→ သဘာဝကျကျ ဖြေပါ။ Order data ထပ်မတောင်းရ။

Customer မေးတာ: "${messageText}"`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [...historyMessages, { role: "user", content: postOrderPrompt }],
        max_tokens: 300,
        temperature: 0.7,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 15000 }
    );

    const aiReply: string = response.data.choices[0]?.message?.content || "NEED_FOLLOW_UP:" + messageText;

    if (aiReply.startsWith("NEED_FOLLOW_UP:")) {
      const question = aiReply.replace("NEED_FOLLOW_UP:", "").trim();
      const followUpMsg = "ကောင်းသောမေးခွန်းပါ ခင်ဗျာ 😊 ကျွန်တော်တို့ team ကနေ မကြာမီ တိကျစွာ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ။";

      // Owner ကို တိတိကျကျ notify
      await notifyOwnerDashboard(customer.id, "order_followup", "📞 Order ပြီးနောက် Follow-up လိုအပ်", `Customer မေးတာ: ${question}`);
      await notifyOwnerTelegram(
        `📞 *Order ပြီးနောက် Follow-up လိုအပ်ပါတယ်*\n\n` +
        `Customer မေးတာ: *${question}*\n\n` +
        `👉 ဖောက်သည်ကို တိုက်ရိုက် ဆက်သွယ်ပေးပါ`
      );

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", followUpMsg);
      return followUpMsg;
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", aiReply);
    return aiReply;

  } catch {
    const errMsg = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", errMsg);
    return errMsg;
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER DETAILS COLLECTION — နာမည်/ဖုန်း/လိပ်စာ AI parse
// ═══════════════════════════════════════════════════════════════
async function handleOrderDetailsCollection(
  customer: any, messageText: string, pendingProduct: string | null,
  addressTerm: string, products: any[], context: any
): Promise<string> {

  const parsePrompt = `Customer message: "${messageText}"
Extract and respond ONLY with JSON, no markdown:
{"name": "နာမည် or null", "phone": "09xxxxxxxxx or null", "address": "လိပ်စာ or null", "quantity": 1}`;

  let parsedDetails: any = { name: null, phone: null, address: null, quantity: 1 };

  try {
    const parseResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: parsePrompt }],
        max_tokens: 150,
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 10000 }
    );
    const raw = parseResponse.data.choices[0]?.message?.content || "{}";
    parsedDetails = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("Parse error:", e);
  }

  const { name, phone, address, quantity } = parsedDetails;
  const missing: string[] = [];
  if (!name) missing.push("နာမည်");
  if (!phone) missing.push("ဖုန်းနံပါတ်");
  if (!address) missing.push("လိပ်စာ");

  if (missing.length > 0) {
    const askAgain = `${missing.join("၊ ")} လေး ထပ်ပြောပေးပါနော်ခင်ဗျာ 😊`;
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", askAgain);
    return askAgain;
  }

  const product = pendingProduct
    ? products.find((p: any) =>
        p.name.toLowerCase().includes(pendingProduct.toLowerCase()) ||
        pendingProduct.toLowerCase().includes(p.name.toLowerCase()))
    : products[0];

  const isPreorder = product && product.stock_quantity <= 0;
  const totalPrice = product ? Number(product.price_mmk) * (quantity || 1) : 0;
  const detectedGender = await detectGenderFromName(name);
  const finalAddress = detectedGender || addressTerm;

  const currentPrefs = parsePreferences(context?.preferences);
  await updateContext(customer.id, {
    preferences: {
      ...currentPrefs,
      address: finalAddress,
      order_state: "awaiting_confirm",
      pending_product: product?.name || pendingProduct,
      is_preorder: isPreorder,
      has_active_order: false,
      pending_order: {
        customer_name: name,
        phone_number: phone,
        delivery_address: address,
        quantity: quantity || 1,
        product_id: product?.id || null,
        product_name: product?.name || pendingProduct,
        total_price_mmk: totalPrice,
        is_preorder: isPreorder,
      },
    },
  });

  const preorderNote = isPreorder ? `\n⏳ Pre-order — ၇-၁၀ ရက်အတွင်း ပို့ပေးပါမယ်` : "";
  const confirmMsg =
    `အော်ဒါလေးအတည်ပြုပေးပါအုန်းခင်ဗျာ 😊\n\n` +
    `👤 ${name}\n📞 ${phone}\n📍 ${address}\n` +
    `📦 ${product?.name || pendingProduct} x${quantity || 1}\n` +
    `💰 ${totalPrice > 0 ? totalPrice.toLocaleString() + " MMK" : ""}` +
    preorderNote;

  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", confirmMsg);
  return confirmMsg;
}

// ═══════════════════════════════════════════════════════════════
// ORDER CONFIRMATION
// ═══════════════════════════════════════════════════════════════
async function handleOrderConfirmation(customer: any, messageText: string, addressTerm: string, context: any): Promise<string> {
  const confirmWords = ["ဟုတ်ကဲ့", "အင်း", "yes", "ok", "ဟုတ်", "မှာမယ်", "ကောင်းပြီ", "ပြီးပြီ", "တင်ပေး", "ဆက်လုပ်", "ပေးပါ"];
  const cancelWords = ["မမှာတော့", "cancel", "ပယ်ဖျက်", "မလုပ်တော့", "နေပါတော့", "မလို"];

  const lower = messageText.toLowerCase();
  const isConfirm = confirmWords.some((w) => lower.includes(w));
  const isCancel = cancelWords.some((w) => lower.includes(w));

  const prefs = parsePreferences(context?.preferences);
  const pendingOrder = prefs.pending_order;

  if (isCancel) {
    await updateContext(customer.id, {
      preferences: { address: prefs.address, order_state: null, pending_order: null, pending_product: null, has_active_order: false },
    });
    const cancelMsg = "အဆင်ပြေပါတယ်ခင်ဗျာ 😊 နောက်တစ်ခါ လိုအပ်ရင် ပြန်မေးပါနော်။";
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", cancelMsg);
    return cancelMsg;
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

    // has_active_order = true သတ်မှတ် — order ပြီးနောက် ဆက်မေးရင် track လုပ်ဖို့
    await updateContext(customer.id, {
      preferences: {
        address: prefs.address,
        order_state: null,
        pending_order: null,
        pending_product: null,
        has_active_order: true, // ← Order တင်ပြီးပြီ
      },
    });

    if (order) {
      const salutation = prefs.address ? ` ${prefs.address}` : "";

      // Dashboard notification
      await notifyOwnerDashboard(
        customer.id, "new_order",
        `🛒 အော်ဒါအသစ် ${orderStatus === "preorder" ? "(Pre-order)" : ""}`,
        `👤 ${pendingOrder.customer_name}\n📞 ${pendingOrder.phone_number}\n📍 ${pendingOrder.delivery_address}\n📦 ${pendingOrder.product_name} x${pendingOrder.quantity}\n💰 ${pendingOrder.total_price_mmk?.toLocaleString()} MMK`
      );

      // Telegram notification — တိတိကျကျ
      await notifyOwnerTelegram(
        `🛒 *အော်ဒါအသစ် ဝင်လာပါပြီ* ${orderStatus === "preorder" ? "*(Pre-order)*" : ""}\n\n` +
        `👤 နာမည်: *${pendingOrder.customer_name}*\n` +
        `📞 ဖုန်း: *${pendingOrder.phone_number}*\n` +
        `📍 လိပ်စာ: ${pendingOrder.delivery_address}\n` +
        `📦 ပစ္စည်း: ${pendingOrder.product_name} x${pendingOrder.quantity}\n` +
        `💰 စုစုပေါင်း: *${pendingOrder.total_price_mmk?.toLocaleString()} MMK*\n\n` +
        `👉 Dashboard မှာ ကြည့်ပြီး confirm လုပ်ပေးပါ`
      );

      const successMsg = pendingOrder.is_preorder
        ? `Pre-order တင်ပြီးပါပြီ${salutation} ✅\n\nမကြာမီ ဖုန်းဆက်ပြီး အသေးစိတ် ရှင်းပြပေးပါမယ်ခင်ဗျာ 🙏`
        : `အော်ဒါတင်ပြီးပါပြီ${salutation} ✅\n\nမကြာမီ ဖုန်းဆက်ပြီး အတည်ပြုပေးပါမယ်ခင်ဗျာ 🙏`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", successMsg);
      return successMsg;
    }
  }

  const reask = `အော်ဒါတင်ပေးရမလားခင်ဗျာ? 😊`;
  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", reask);
  return reask;
}

// ═══════════════════════════════════════════════════════════════
// MAIN WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === FACEBOOK_WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    const body = req.body;
    if (body.object === "page") {
      try {
        const tasks: Promise<void>[] = [];
        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender.id;
            const messageId = event.message?.mid;

            tasks.push((async () => {
              if (messageId) {
                const alreadyProcessed = await isMessageProcessed(messageId);
                if (alreadyProcessed) { console.log(`Skipping duplicate: ${messageId}`); return; }
                await markMessageProcessed(messageId);
              }

              const customer = await getOrCreateCustomer(senderId);
              if (customer?.bot_paused) return;

              if (event.message?.text) {
                const reply = await generateAIResponse(senderId, event.message.text);
                await sendMessage(senderId, reply);
              } else if (event.message) {
                // Voice, image, sticker — owner ကို notify
                const msgType = Object.keys(event.message).filter((k) => k !== "mid" && k !== "seq").join(", ");
                const reply = "ကျွန်တော်တို့ team ကနေ မကြာမီ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏";
                await sendMessage(senderId, reply);

                await notifyOwnerDashboard(customer.id, "non_text_message", "📎 Text မဟုတ်တဲ့ Message", `Customer ပို့တာ: ${msgType}`);
                await notifyOwnerTelegram(
                  `📎 *Text မဟုတ်တဲ့ Message ဝင်လာပါတယ်*\n\n` +
                  `Message အမျိုးအစား: *${msgType}*\n\n` +
                  `👉 Dashboard မှာ ကြည့်ပြီး ပြန်ဆက်သွယ်ပေးပါ`
                );
              }
            })());
          }
        }
        await Promise.all(tasks);
      } catch (err) {
        console.error("Handler Error:", err);
      }
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method not allowed");
}