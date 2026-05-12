import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// ─── Environment Variables ───────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const FACEBOOK_WEBHOOK_VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ─── Supabase Helper ─────────────────────────────────────────────────────────
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

// ─── Telegram Error Notification ─────────────────────────────────────────────
async function notifyTelegramError(errorMessage: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🚨 *EIREE Bot Error*\n\n${errorMessage}`,
      parse_mode: "Markdown",
    });
  } catch (e: any) {
    console.error("Telegram notify error:", e.message);
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────────
async function isMessageProcessed(messageId: string): Promise<boolean> {
  const result = await supabaseQuery("processed_messages", "GET", null, `message_id=eq.${messageId}&select=message_id`);
  return result && result.length > 0;
}
async function markMessageProcessed(messageId: string) {
  await supabaseQuery("processed_messages", "POST", { message_id: messageId });
}

// ─── Customer ─────────────────────────────────────────────────────────────────
async function getOrCreateCustomer(psid: string) {
  const existing = await supabaseQuery("customers", "GET", null, `psid=eq.${psid}&select=*`);
  if (existing && existing.length > 0) return existing[0];
  const created = await supabaseQuery("customers", "POST", { psid });
  return created ? created[0] : { id: null, psid, bot_paused: false };
}

// ─── Conversation History ─────────────────────────────────────────────────────
async function getConversationHistory(customerId: number, limit = 10) {
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

// ─── Products ─────────────────────────────────────────────────────────────────
async function getProducts() {
  return (await supabaseQuery("products", "GET", null, "is_active=eq.true&select=*")) || [];
}

// ─── Orders ───────────────────────────────────────────────────────────────────
async function saveOrder(orderData: any) {
  return await supabaseQuery("orders", "POST", orderData);
}

// ─── Owner Notifications ──────────────────────────────────────────────────────
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

// ─── Conversation Context ─────────────────────────────────────────────────────
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

// ─── AI Training Config (Dashboard ကနေ prompt ပြောင်းလို့ရအောင်) ──────────────
async function getSystemPromptFromDB(): Promise<string | null> {
  try {
    const result = await supabaseQuery("ai_training_config", "GET", null, "is_active=eq.true&select=*&order=updated_at.desc&limit=1");
    if (result && result.length > 0) {
      return result[0].system_prompt || result[0].prompt_content || result[0].content || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Facebook Send Message ────────────────────────────────────────────────────
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

// ─── Main AI Response Logic ───────────────────────────────────────────────────
async function generateAIResponse(psid: string, messageText: string): Promise<string> {
  try {
    const customer = await getOrCreateCustomer(psid);
    if (!customer?.id) return "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";

    const [history, products, context] = await Promise.all([
      getConversationHistory(customer.id, 15),
      getProducts(),
      getContext(customer.id),
    ]);

    // ── Gender preference detection (first message) ──
    const preferences = context?.preferences;
    let addressTerm = "အကို/အမ";

    if (!preferences && history.length === 0) {
      await updateContext(customer.id, { preferences: "pending" });
      await saveConversation(customer.id, "customer", messageText);
      const greeting = "မင်္ဂလာပါခင်ဗျာ။ EIREE Water Purifiers က ကြိုဆိုပါတယ်ခင်ဗျာ။ ဘယ်လိုခေါ်ရမလဲခင်ဗျာ? 😊";
      await saveConversation(customer.id, "bot", greeting);
      return greeting;
    }

    if (preferences === "pending") {
      const lower = messageText.toLowerCase();
      if (lower.includes("အကို") || lower.includes("ကျနော်") || lower.includes("ကျွန်တော်")) {
        addressTerm = "အကို";
      } else if (lower.includes("အမ") || lower.includes("ကျမ") || lower.includes("ကျွန်မ")) {
        addressTerm = "အမ";
      } else {
        addressTerm = "အကို/အမ";
      }
      await updateContext(customer.id, { preferences: addressTerm });
    } else if (preferences && preferences !== "pending") {
      // preferences column မှာ string တစ်ခုတည်းဆိုရင် addressTerm အဖြစ်သုံး
      // jsonb ဆိုရင် address field ကိုကြည့်
      if (typeof preferences === "string" && !preferences.startsWith("{")) {
        addressTerm = preferences;
      } else if (typeof preferences === "object" && preferences?.address) {
        addressTerm = preferences.address;
      } else if (typeof preferences === "string") {
        try {
          const parsed = JSON.parse(preferences);
          addressTerm = parsed?.address || "အကို/အမ";
        } catch {
          addressTerm = preferences;
        }
      }
    }

    // ── Order state check ──
    // preferences jsonb မှာ order_state သိမ်းထားတယ်
    let orderState: string | null = null;
    let pendingProduct: string | null = null;

    if (context?.preferences && typeof context.preferences === "object") {
      orderState = context.preferences.order_state || null;
      pendingProduct = context.preferences.pending_product || null;
    } else if (context?.preferences && typeof context.preferences === "string" && context.preferences.startsWith("{")) {
      try {
        const p = JSON.parse(context.preferences);
        orderState = p.order_state || null;
        pendingProduct = p.pending_product || null;
        addressTerm = p.address || addressTerm;
      } catch { /* ignore */ }
    }

    // ── awaiting_details state — Customer က နာမည်/ဖုန်း/လိပ်စာ ပေးနေတဲ့အဆင့် ──
    if (orderState === "awaiting_details") {
      return await handleOrderDetailsCollection(customer, messageText, pendingProduct, addressTerm, products);
    }

    // ── awaiting_confirm state — Customer က confirm လုပ်နေတဲ့အဆင့် ──
    if (orderState === "awaiting_confirm") {
      return await handleOrderConfirmation(customer, messageText, addressTerm);
    }

    // ── Product list for AI context ──
    const productList = products.map((p: any) =>
      `- ${p.name} | စျေးနှုန်း: ${Number(p.price_mmk).toLocaleString()} MMK | Stock: ${p.stock_quantity > 0 ? "ရှိ" : "မရှိ (Pre-order ရနိုင်)"} | ${p.description || ""}`
    ).join("\n");

    // ── Conversation history for AI ──
    const historyMessages = [...(history || [])].reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    // ── System Prompt — DB ကအရင်ကြည့်၊ မရှိရင် default သုံး ──
    const dbPrompt = await getSystemPromptFromDB();

    const defaultPrompt = `သင်သည် EIREE Water Purifiers ၏ ကျွမ်းကျင်သော အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်ပါသည်။

စကားပြောပုံစံ:
- ဖောက်သည်ကို "${addressTerm}" ဟုသာ ခေါ်ပါ။ "ရှင့်" လုံးဝမသုံးရ။
- မိမိကိုယ်ကို "ခင်ဗျာ" သုံးပါ။
- တိုတိုနှင့် သူငယ်ချင်းချင်း chat သကဲ့သို့ သဘာဝကျကျ ပြောပါ။ စာကြောင်း ၂-၃ ကြောင်းထက် မပိုပါစေနှင့်။
- Bullet points၊ စာရှည်ကြီးများ ရှောင်ပါ။

အရောင်းဗျူဟာ:
- ပစ္စည်းအကြောင်းမေးရင် နာမည်နဲ့ အကျဉ်းချုပ်ပဲ အရင်ပြောပါ။ စိတ်ဝင်စားမှ အသေးစိတ်ပြောပါ။
- ဝယ်ချင်တဲ့ သဘောထားတွေ (မှာမယ်၊ ယူမယ်၊ ဝယ်မယ်၊ ပေးပို့ပါ၊ ရချင်တယ်၊ စီစဉ်ပေးပါ၊ ပေးလိုက်တော့ စသည်) တွေ့ရင် — ချက်ချင်း နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာ တစ်ခါတည်း တောင်းပါ။ တစ်ခုချင်းစီ မမေးပါနဲ့။
- မသေချာတဲ့ မေးခွန်းများ ဆိုရင် "ခဏလေးစောင့်ပေးပါ၊ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်" ဟုသာ ဖြေပါ။
- conversation history ကို ကြည့်ပြီး customer က ဘယ် product ကို ဆိုလိုတာလဲ ဆုံးဖြတ်ပါ။ product နာမည်အတိအကျ မပါလည်း context ကြည့်ပြီး သိနိုင်ပါတယ်။

ORDER_INTENT ရှိရင်:
ဖောက်သည်က ဝယ်ယူလိုသော သဘောထား ပြသရင် အောက်ပါ format နဲ့သာ ဖြေပါ —
"ORDER_INTENT_DETECTED:[product_name]"
ဥပမာ: "ORDER_INTENT_DETECTED:5 Stage UF Drinking Water Purifier (SS304)"
product မသေချာရင် "ORDER_INTENT_DETECTED:unknown" ဖြေပါ။

လက်ရှိ ပစ္စည်းများ:
${productList}`;

    const systemPrompt = dbPrompt
      ? dbPrompt.replace("${addressTerm}", addressTerm).replace("{addressTerm}", addressTerm)
      : defaultPrompt;

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
        max_tokens: 400,
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    const aiReply: string = response.data.choices[0]?.message?.content ||
      "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။";

    // ── ORDER_INTENT_DETECTED handler ──
    if (aiReply.startsWith("ORDER_INTENT_DETECTED:")) {
      const detectedProduct = aiReply.replace("ORDER_INTENT_DETECTED:", "").trim();

      // preferences ထဲမှာ order_state သိမ်း
      const currentPrefs = typeof context?.preferences === "object"
        ? context.preferences
        : (() => { try { return JSON.parse(context?.preferences || "{}"); } catch { return { address: addressTerm }; } })();

      await updateContext(customer.id, {
        preferences: {
          ...currentPrefs,
          address: addressTerm,
          order_state: "awaiting_details",
          pending_product: detectedProduct !== "unknown" ? detectedProduct : null,
        },
      });

      const askDetails = detectedProduct !== "unknown"
        ? `${addressTerm}၊ ${detectedProduct} အတွက် အော်ဒါတင်ပေးပါမယ်ခင်ဗျာ။ နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး တစ်ခါတည်းပြောပေးပါနော် 😊`
        : `အော်ဒါတင်ပေးပါမယ်ခင်ဗျာ။ နာမည်၊ ဖုန်းနံပါတ်နဲ့ လိပ်စာလေး တစ်ခါတည်းပြောပေးပါနော် 😊`;

      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", askDetails);
      return askDetails;
    }

    // ── Uncertainty handler ──
    if (aiReply.includes("ပြန်ဆက်သွယ်ပေးပါမယ်") || aiReply.includes("team ကနေ")) {
      await notifyOwner(customer.id, "ai_uncertainty", "AI မသေချာတဲ့ မေးခွန်း", `Customer: ${messageText}`);
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

// ─── Order Details Collection ─────────────────────────────────────────────────
async function handleOrderDetailsCollection(
  customer: any,
  messageText: string,
  pendingProduct: string | null,
  addressTerm: string,
  products: any[]
): Promise<string> {
  // AI ကို သုံးပြီး နာမည်/ဖုန်း/လိပ်စာ parse လုပ်ခိုင်းမယ်
  const parsePrompt = `Customer message: "${messageText}"

ဒီ message ထဲကနေ အောက်ပါ information တွေကို extract လုပ်ပြီး JSON format နဲ့ပဲ ဖြေပါ။ JSON မဟုတ်တဲ့ text မထည့်ပါနဲ့။

{
  "name": "နာမည် (မရှိရင် null)",
  "phone": "ဖုန်းနံပါတ် 09 နဲ့စတဲ့ဟာ (မရှိရင် null)",
  "address": "လိပ်စာ (မရှိရင် null)",
  "quantity": 1
}`;

  let parsedDetails = { name: null, phone: null, address: null, quantity: 1 };

  try {
    const parseResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: parsePrompt }],
        max_tokens: 200,
        temperature: 0.1,
      },
      {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 10000,
      }
    );

    const raw = parseResponse.data.choices[0]?.message?.content || "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    parsedDetails = JSON.parse(cleaned);
  } catch (e) {
    console.error("Parse error:", e);
  }

  const { name, phone, address, quantity } = parsedDetails as any;

  // မပြည့်စုံရင် ထပ်မေး
  const missing = [];
  if (!name) missing.push("နာမည်");
  if (!phone) missing.push("ဖုန်းနံပါတ်");
  if (!address) missing.push("လိပ်စာ");

  if (missing.length > 0) {
    const askAgain = `${missing.join("၊ ")} လေးပါ ထပ်ပြောပေးပါနော် ${addressTerm} 😊`;
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", askAgain);
    return askAgain;
  }

  // Product ရှာ
  let product = pendingProduct
    ? products.find((p: any) =>
        p.name.toLowerCase().includes(pendingProduct.toLowerCase()) ||
        pendingProduct.toLowerCase().includes(p.name.toLowerCase())
      )
    : null;

  if (!product) product = products[0]; // fallback to first product

  // Confirm မေး
  const totalPrice = product ? Number(product.price_mmk) * (quantity || 1) : 0;
  const confirmMsg = `အော်ဒါ အတည်ပြုချင်ပါသလားခင်ဗျာ 😊

👤 ${name}
📞 ${phone}
📍 ${address}
📦 ${product?.name || pendingProduct || "ပစ္စည်း"}
💰 ${totalPrice > 0 ? totalPrice.toLocaleString() + " MMK" : ""}

"ဟုတ်ကဲ့" လို့ပြောရင် အော်ဒါတင်ပေးပါမယ်ခင်ဗျာ။`;

  // Context မှာ pending order သိမ်း
  const currentPrefs = typeof customer?.preferences === "object"
    ? customer.preferences
    : { address: addressTerm };

  await updateContext(customer.id, {
    preferences: {
      ...currentPrefs,
      address: addressTerm,
      order_state: "awaiting_confirm",
      pending_product: product?.name || pendingProduct,
      pending_order: {
        customer_name: name,
        phone_number: phone,
        delivery_address: address,
        quantity: quantity || 1,
        product_id: product?.id || null,
        product_name: product?.name || pendingProduct,
        total_price_mmk: totalPrice,
      },
    },
  });

  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", confirmMsg);
  return confirmMsg;
}

// ─── Order Confirmation ───────────────────────────────────────────────────────
async function handleOrderConfirmation(customer: any, messageText: string, addressTerm: string): Promise<string> {
  const confirmWords = ["ဟုတ်ကဲ့", "အင်း", "yes", "ok", "ဟုတ်", "မှာမယ်", "ကောင်းပြီ", "ပြီးပြီ", "တင်ပေး"];
  const cancelWords = ["မမှာတော့ဘူး", "cancel", "ပယ်ဖျက်", "မလုပ်တော့ဘူး", "နေပါတော့"];

  const lower = messageText.toLowerCase();
  const isConfirm = confirmWords.some(w => lower.includes(w));
  const isCancel = cancelWords.some(w => lower.includes(w));

  // Context ကနေ pending order ယူ
  const context = await getContext(customer.id);
  let pendingOrder: any = null;
  let currentPrefs: any = { address: addressTerm };

  if (context?.preferences) {
    if (typeof context.preferences === "object") {
      pendingOrder = context.preferences.pending_order || null;
      currentPrefs = context.preferences;
    } else if (typeof context.preferences === "string" && context.preferences.startsWith("{")) {
      try {
        currentPrefs = JSON.parse(context.preferences);
        pendingOrder = currentPrefs.pending_order || null;
      } catch { /* ignore */ }
    }
  }

  if (isCancel) {
    await updateContext(customer.id, {
      preferences: { ...currentPrefs, order_state: null, pending_order: null, pending_product: null },
    });
    const cancelMsg = "အဆင်ပြေပါတယ်ခင်ဗျာ။ နောက်တစ်ခါ လိုအပ်ရင် ပြန်မေးပါနော် 😊";
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", cancelMsg);
    return cancelMsg;
  }

  if (isConfirm && pendingOrder) {
    const order = await saveOrder({
      customer_id: customer.id,
      product_id: pendingOrder.product_id,
      full_name: pendingOrder.customer_name,
      phone_number: pendingOrder.phone_number,
      delivery_address: pendingOrder.delivery_address,
      quantity: pendingOrder.quantity,
      total_price_mmk: pendingOrder.total_price_mmk,
      status: "pending",
    });

    // Order state ရှင်းလင်း
    await updateContext(customer.id, {
      preferences: { ...currentPrefs, order_state: null, pending_order: null, pending_product: null },
    });

    if (order) {
      await notifyOwner(customer.id, "new_order", "🛒 အော်ဒါအသစ်", `${pendingOrder.customer_name} | ${pendingOrder.product_name} | ${pendingOrder.phone_number}`);
      const successMsg = `အော်ဒါတင်ပြီးပါပြီခင်ဗျာ ✅\n\nမကြာခင် ဖုန်းဆက်သွယ်ပြီး အတည်ပြုပေးပါမယ် ${addressTerm} 🙏`;
      await saveConversation(customer.id, "customer", messageText);
      await saveConversation(customer.id, "bot", successMsg);
      return successMsg;
    }
  }

  // Confirm/Cancel မဟုတ်ရင် ပြန်မေး
  const reask = `"ဟုတ်ကဲ့" သို့မဟုတ် "မမှာတော့ဘူး" လို့ ပြောပေးပါ ${addressTerm} 😊`;
  await saveConversation(customer.id, "customer", messageText);
  await saveConversation(customer.id, "bot", reask);
  return reask;
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────
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
            const senderId = event.sender.id;
            const messageId = event.message?.mid;

            tasks.push((async () => {
              // Deduplication check
              if (messageId) {
                const alreadyProcessed = await isMessageProcessed(messageId);
                if (alreadyProcessed) {
                  console.log(`Skipping duplicate: ${messageId}`);
                  return;
                }
                await markMessageProcessed(messageId);
              }

              const customer = await getOrCreateCustomer(senderId);
              if (customer?.bot_paused) return; // Bot paused — admin က manual reply လုပ်မယ်

              if (event.message?.text) {
                const reply = await generateAIResponse(senderId, event.message.text);
                await sendMessage(senderId, reply);
              } else if (event.message) {
                // Voice, image, sticker စသည်
                const reply = "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";
                await sendMessage(senderId, reply);
                await notifyOwner(customer.id, "non_text_message", "Non-text Message",
                  `Customer sent: ${Object.keys(event.message).filter(k => k !== "mid" && k !== "seq").join(", ")}`
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