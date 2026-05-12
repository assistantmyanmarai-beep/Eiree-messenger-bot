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

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPER — Database နဲ့ ဆက်သွယ်တဲ့ function
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
    await notifyTelegramError(`Supabase Error (${method} ${table}): ${JSON.stringify(error?.response?.data || error.message)}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM — System error တွေကို owner ဆီပို့တဲ့ function
// ═══════════════════════════════════════════════════════════════
async function notifyTelegramError(errorMessage: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🚨 *EIREE MYANMAR Bot Error*\n\n${errorMessage}`,
      parse_mode: "Markdown",
    });
  } catch (e: any) {
    console.error("Telegram notify error:", e.message);
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
// CUSTOMER — Facebook PSID နဲ့ customer ရှာ၊ မရှိရင် အသစ်ဆောက်
// ═══════════════════════════════════════════════════════════════
async function getOrCreateCustomer(psid: string) {
  const existing = await supabaseQuery("customers", "GET", null, `psid=eq.${psid}&select=*`);
  if (existing && existing.length > 0) return existing[0];
  const created = await supabaseQuery("customers", "POST", { psid });
  return created ? created[0] : { id: null, psid, bot_paused: false };
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION HISTORY — AI ကို context ပေးဖို့ chat မှတ်တမ်း
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
// PRODUCTS — is_active=true ဖြစ်တဲ့ ပစ္စည်းတွေသာ ယူတယ်
// ═══════════════════════════════════════════════════════════════
async function getProducts() {
  return (await supabaseQuery("products", "GET", null, "is_active=eq.true&select=*")) || [];
}

// ═══════════════════════════════════════════════════════════════
// STOCK DEDUCT — Order confirm ဖြစ်တိုင်း stock အလိုအလျောက်နုတ်
// ═══════════════════════════════════════════════════════════════
async function deductStock(productId: number, quantity: number) {
  const product = await supabaseQuery("products", "GET", null, `id=eq.${productId}&select=stock_quantity,name`);
  if (!product || product.length === 0) return;
  const currentStock = product[0].stock_quantity || 0;
  const newStock = Math.max(0, currentStock - quantity);
  await supabaseQuery("products", "PATCH", { stock_quantity: newStock }, `id=eq.${productId}`);
  console.log(`Stock deducted: ${product[0].name} ${currentStock} → ${newStock}`);
}

// ═══════════════════════════════════════════════════════════════
// ORDER — Order အသစ် save လုပ်တဲ့ function
// ═══════════════════════════════════════════════════════════════
async function saveOrder(orderData: any) {
  return await supabaseQuery("orders", "POST", orderData);
}

// ═══════════════════════════════════════════════════════════════
// OWNER NOTIFICATIONS — Dashboard မှာ owner ကို alert ပေးတဲ့ function
// ═══════════════════════════════════════════════════════════════
async function notifyOwner(customerId: number, type: string, title: string, content: string, orderId: number | null = null) {
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
// CONVERSATION CONTEXT — Customer တစ်ယောက်ချင်းစီရဲ့ state သိမ်း
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
// CONTEXT PARSER — preferences column ထဲကနေ data ထုတ်ယူ
// address က "" (empty) ဆိုရင် gender မသိသေး — နာမ်စားမသုံးဘဲ ပြော
// ═══════════════════════════════════════════════════════════════
function parsePreferences(preferences: any): {
  address: string;
  order_state: string | null;
  pending_product: string | null;
  pending_order: any | null;
  is_preorder: boolean;
} {
  // address="" = gender မသေချာ၊ နာမ်စားမသုံး
  const defaults = { address: "", order_state: null, pending_product: null, pending_order: null, is_preorder: false };
  if (!preferences) return defaults;

  if (typeof preferences === "object" && !Array.isArray(preferences)) {
    return {
      address: preferences.address ?? "",
      order_state: preferences.order_state || null,
      pending_product: preferences.pending_product || null,
      pending_order: preferences.pending_order || null,
      is_preorder: preferences.is_preorder || false,
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
        };
      } catch { return defaults; }
    }
    // "pending" မဟုတ်တဲ့ plain string ဆိုရင် address အဖြစ်သုံး (အကို/အမ)
    if (preferences !== "pending") return { ...defaults, address: preferences };
  }
  return defaults;
}

// ═══════════════════════════════════════════════════════════════
// GENDER DETECTION — Order ချိန်မှာ နာမည်ကနေ AI နဲ့ ခန့်မှန်း
// မသေချာရင် "" ပြန်ပေး — နာမ်စားဆက်မသုံး
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
    return ""; // မသေချာရင် နာမ်စားမသုံး
  } catch { return ""; }
}

// ═══════════════════════════════════════════════════════════════
// AI TRAINING CONFIG — Dashboard ကနေ prompt ပြောင်းလို့ရအောင်
// Table မှာ data ရှိရင် DB ကဟာသုံး၊ မရှိရင် default prompt သုံး
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
// FACEBOOK SEND MESSAGE — Customer ဆီ reply ပို့တဲ့ function
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
    await notifyTelegramError(`Facebook Send Error: ${error?.response?.data?.error?.message || error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AI RESPONSE — Customer message ကို AI နဲ့ ဖြေတဲ့ function
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

    // Order state တွေ ရှိနေရင် အဲ့ flow ကိုသာ handle
    if (prefs.order_state === "awaiting_details") {
      return await handleOrderDetailsCollection(customer, messageText, prefs.pending_product, prefs.address, products, context);
    }
    if (prefs.order_state === "awaiting_confirm") {
      return await handleOrderConfirmation(customer, messageText, prefs.address, context);
    }

    // First message — greeting နဲ့ product မိတ်ဆက် (နာမည်မမေးတော့)
    if (!context?.preferences && history.length === 0) {
      // address="" နဲ့ စတင် — gender မသေချာသေးလို့ နာမ်စားမသုံး
      await updateContext(customer.id, { preferences: { address: "", order_state: null } });
      await saveConversation(customer.id, "customer", messageText);
      const greeting = "မင်္ဂလာပါခင်ဗျာ 😊 EIREE MYANMAR မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nအိမ်သုံးရေသန့်စက်လေးတွေ ရှာနေတာလားခင်ဗျာ? ကျွန်တော်တို့ဆီမှာ သောက်ရေသီးသန့်အတွက်ရော၊ တစ်အိမ်လုံးအတွက်ပါ ရေသန့်စက်အမျိုးမျိုး ရှိပါတယ်ခင်ဗျာ။ ဘာများ ကူညီပေးရမလဲခင်ဗျာ? 🙏";
      await saveConversation(customer.id, "bot", greeting);
      return greeting;
    }

    // Product list — ဈေးနှုန်းကို DB ကဟာသာ သုံး၊ AI က မရမ်းပြောရ
    const productList = products.map((p: any) => {
      const stock = p.stock_quantity > 0
        ? `Stock ရှိ (${p.stock_quantity} လုံး)`
        : `Stock မရှိ — Pre-order ရနိုင်`;
      return `• ${p.name}\n  စျေး: ${Number(p.price_mmk).toLocaleString()} MMK\n  ${stock}\n  ${p.description || ""}`;
    }).join("\n\n");

    const historyMessages = [...(history || [])].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    const dbPrompt = await getSystemPromptFromDB();

    // address="" ဆိုရင် နာမ်စားမသုံး rule ထည့်ထားတယ်
    const addressRule = prefs.address
      ? `ဖောက်သည်ကို "${prefs.address}" ဟုသာ ခေါ်ပါ။ "ရှင့်" လုံးဝမသုံးနဲ့။`
      : `ဖောက်သည်ကို နာမ်စားဖြင့် မခေါ်ပါနဲ့။ "ခင်ဗျာ" ကိုသာ နောက်ဆက်တွဲအဖြစ်သုံးပြီး ယဉ်ကျေးသောစကားပြောပုံစံဖြင့်သာ ဆက်သွယ်ပါ။`;

    const defaultSystemPrompt = `သင်သည် EIREE MYANMAR ၏ ကျွမ်းကျင်သော Professional အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်ပါသည်။

━━━ စကားပြောပုံစံ ━━━
• ${addressRule}
• မိမိကို "ခင်ဗျာ" သုံးပါ။
• သူငယ်ချင်းချင်း chat လိုမျိုး သဘာဝကျကျ၊ နွေးထွေးစွာ ပြောပါ။
• တစ်ကြိမ်ပြန်တဲ့အခါ စာကြောင်း ၃ ကြောင်းထက်မပိုပါနဲ့။
• Bullet point၊ စာရှည်ကြီး ရှောင်ပါ။

━━━ အရောင်းဗျူဟာ ━━━
• ပစ္စည်းမေးရင် အကျဉ်းချုပ်ပြောပြပြီး စိတ်ဝင်စားမှ အသေးစိတ်ဆက်ပြော။
• ပစ္စည်းရဲ့ ကောင်းကွက်ကို ထင်ရှားအောင် ပြောပြပြီး ဝယ်ယူချင်အောင် လုပ်ပါ။
• Conversation history ကိုကြည့်ပြီး ဆိုလိုတဲ့ product ကို context နဲ့ နားလည်ပါ။
• Stock မရှိတဲ့ product ဆိုရင် Pre-order ရနိုင်ကြောင်း ဖော်ပြပြီး order ဆက်ကောက်ပါ။

━━━ ဝယ်ယူလိုသော သဘောထား ━━━
Customer က ဝယ်ချင်တဲ့သဘောထား (မှာမယ်၊ ယူမယ်၊ ဝယ်မယ်၊ ပေးလိုက်တော့၊ ရချင်တယ်၊ စီစဉ်ပေးပါ၊ order တင်ပေးပါ) ပြသရင် ဒီ format နဲ့သာ ဖြေပါ:
"ORDER_INTENT_DETECTED:[product_name]"
Product မသေချာရင်: "ORDER_INTENT_DETECTED:unknown"

━━━ ဈေးနှုန်း STRICT RULES (အရေးအကြီးဆုံး) ━━━
⚠️ ဈေးနှုန်းကို အောက်က product list ထဲကဟာကိုသာ ပြောပါ။
⚠️ Product list မပါတဲ့ ဈေးနှုန်း တစ်ပြားတစ်ချပ်မဆို ပြောခွင့်မရှိ။
⚠️ ဈေးနှုန်းမသေချာရင် "ခဏလေးစောင့်ပေးပါ၊ team ကနေ အတိအကျပြန်ဆက်သွယ်ပေးပါမယ်" ဟုသာ ဖြေပါ။

━━━ မသေချာတဲ့ မေးခွန်းများ ━━━
"ခဏလေးစောင့်ပေးပါ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ 🙏" ဟုသာ ဖြေပါ။

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

    // ORDER_INTENT_DETECTED handler
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
        },
      });

      // address="" ဆိုရင် နာမ်စားမသုံး
      const salutation = prefs.address ? `${prefs.address}၊ ` : "";

      const askDetails = isPreorder
        ? `${salutation}${product.name} က လက်ရှိ Stock ကုန်နေပါတယ်ခင်ဗျာ။ Pre-order အနေနဲ့ ၇-၁၀ ရက်အတွင်း ပို့ပေးနိုင်ပါတယ် 😊\n\nနာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး ပြောပေးပါနော်ခင်ဗျာ။`
        : `${salutation}အော်ဒါတင်ပေးပါမယ်ခင်ဗျာ 😊\n\nနာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး တစ်ခါတည်း ပြောပေးပါနော်ခင်ဗျာ။`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", askDetails);
      return askDetails;
    }

    // ဈေးနှုန်းမသေချာရင် owner ကို notify
    if (aiReply.includes("ပြန်ဆက်သွယ်ပေးပါမယ်") || aiReply.includes("team ကနေ")) {
      await notifyOwner(customer.id, "ai_uncertainty", "🤖 AI မသေချာတဲ့မေးခွန်း", `Customer: ${messageText}`);
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", aiReply);
    return aiReply;

  } catch (error: any) {
    console.error("AI Error:", error.response?.data || error.message);
    await notifyTelegramError(`AI Error: ${JSON.stringify(error.response?.data || error.message)}`);
    return "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDER DETAILS COLLECTION — နာမည်/ဖုန်း/လိပ်စာ AI နဲ့ parse လုပ်
// ═══════════════════════════════════════════════════════════════
async function handleOrderDetailsCollection(
  customer: any, messageText: string, pendingProduct: string | null,
  addressTerm: string, products: any[], context: any
): Promise<string> {

  const parsePrompt = `Customer message: "${messageText}"

Extract information and respond ONLY with JSON, no other text, no markdown:
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
    console.error("Parse details error:", e);
  }

  const { name, phone, address, quantity } = parsedDetails;

  // မပြည့်စုံတာတွေ စစ်ပြီး ထပ်မေး
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

  // နာမည်ကနေ gender detect — order ချိန်မှာ သေချာမှ အကို/အမ သုံး
  const detectedGender = await detectGenderFromName(name);
  const finalAddress = detectedGender || addressTerm; // detect မရရင် မူလ address သုံး

  const currentPrefs = parsePreferences(context?.preferences);
  await updateContext(customer.id, {
    preferences: {
      ...currentPrefs,
      address: finalAddress,
      order_state: "awaiting_confirm",
      pending_product: product?.name || pendingProduct,
      is_preorder: isPreorder,
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
// ORDER CONFIRMATION — Customer confirm/cancel လုပ်တဲ့ အဆင့်
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
      preferences: { address: prefs.address, order_state: null, pending_order: null, pending_product: null },
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

    // Stock အလိုအလျောက်နုတ်
    if (pendingOrder.product_id && pendingOrder.quantity) {
      await deductStock(pendingOrder.product_id, pendingOrder.quantity);
    }

    // Order state ရှင်းလင်း
    await updateContext(customer.id, {
      preferences: { address: prefs.address, order_state: null, pending_order: null, pending_product: null },
    });

    if (order) {
      // addressTerm ရှိရင် သုံး၊ မရှိရင် မသုံး
      const salutation = prefs.address ? ` ${prefs.address}` : "";
      await notifyOwner(
        customer.id, "new_order",
        `🛒 အော်ဒါအသစ် ${orderStatus === "preorder" ? "(Pre-order)" : ""}`,
        `${pendingOrder.customer_name} | ${pendingOrder.product_name} | ${pendingOrder.phone_number}`
      );

      const successMsg = pendingOrder.is_preorder
        ? `Pre-order တင်ပြီးပါပြီ${salutation} ✅\n\nမကြာခင် ဖုန်းဆက်ပြီး အတည်ပြုပေးပါမယ်ခင်ဗျာ 🙏`
        : `အော်ဒါတင်ပြီးပါပြီ${salutation} ✅\n\nမကြာခင် ဖုန်းဆက်ပြီး အတည်ပြုပေးပါမယ်ခင်ဗျာ 🙏`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", successMsg);
      return successMsg;
    }
  }

  // Confirm/Cancel မဟုတ်သေးရင် သဘာဝကျကျ ပြန်မေး
  const reask = `အော်ဒါတင်ပေးရမလားခင်ဗျာ? 😊`;
  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", reask);
  return reask;
}

// ═══════════════════════════════════════════════════════════════
// MAIN WEBHOOK HANDLER — Facebook က message တွေ receive လုပ်တယ်
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET — Facebook webhook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === FACEBOOK_WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  // POST — Incoming messages from Facebook
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
              // Duplicate check
              if (messageId) {
                const alreadyProcessed = await isMessageProcessed(messageId);
                if (alreadyProcessed) { console.log(`Skipping duplicate: ${messageId}`); return; }
                await markMessageProcessed(messageId);
              }

              const customer = await getOrCreateCustomer(senderId);
              if (customer?.bot_paused) return; // Admin manual reply mode

              if (event.message?.text) {
                const reply = await generateAIResponse(senderId, event.message.text);
                await sendMessage(senderId, reply);
              } else if (event.message) {
                // Voice, image, sticker — owner ကို notify
                const msgType = Object.keys(event.message).filter((k) => k !== "mid" && k !== "seq").join(", ");
                const reply = "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";
                await sendMessage(senderId, reply);
                await notifyOwner(customer.id, "non_text_message", "📎 Text မဟုတ်တဲ့ Message", `Customer sent: ${msgType}`);
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