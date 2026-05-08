import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// Environment variables
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const FACEBOOK_WEBHOOK_VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Supabase REST helper
async function supabaseQuery(table: string, method: string, body?: any, query?: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const headers: any = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };

  try {
    if (method === "GET") {
      const res = await axios.get(url, { headers });
      return res.data;
    } else if (method === "POST") {
      const res = await axios.post(url, body, { headers });
      return res.data;
    } else if (method === "PATCH") {
      const res = await axios.patch(url, body, { headers });
      return res.data;
    } else if (method === "PUT") {
      const res = await axios.put(url, body, { headers });
      return res.data;
    } else if (method === "DELETE") {
      const res = await axios.delete(url, { headers });
      return res.data;
    }
  } catch (error: any) {
    console.error(`Supabase ${method} ${table} error:`, error?.response?.data || error.message);
    // Do not rethrow, allow main flow to handle gracefully or with Telegram notification
    return null;
  }
}

// Telegram Notification for Errors Only
async function notifyTelegramError(errorMessage: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram bot token or chat ID not set. Cannot send error notification.");
    return;
  }
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(telegramApiUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🚨 Bot Error Notification 🚨\n\n${errorMessage}`,
      parse_mode: "Markdown",
    });
    console.log("Telegram error notification sent.");
  } catch (error: any) {
    console.error("Failed to send Telegram error notification:", error?.response?.data || error.message);
  }
}

// Get or create customer by PSID
async function getOrCreateCustomer(psid: string) {
  const existing = await supabaseQuery("customers", "GET", null, `psid=eq.${psid}&select=*`);
  if (existing && existing.length > 0) {
    return existing[0];
  }
  const newCustomer = await supabaseQuery("customers", "POST", {
    psid: psid,
  });
  return newCustomer ? newCustomer[0] : { id: null, psid, bot_paused: false }; // Default bot_paused to false
}

// Update customer's bot_paused status
async function updateCustomerBotPaused(customerId: number, botPaused: boolean) {
  if (!customerId) return;
  await supabaseQuery("customers", "PATCH", { bot_paused: botPaused }, `id=eq.${customerId}`);
}

// Get conversation history
async function getConversationHistory(customerId: number, limit: number = 10) {
  if (!customerId) return [];
  const conversations = await supabaseQuery(
    "conversations", "GET", null,
    `customer_id=eq.${customerId}&select=*&order=created_at.desc&limit=${limit}`
  );
  return conversations || [];
}

// Save conversation message
async function saveConversation(customerId: number, messageType: string, messageText: string, metadata: any = {}) {
  if (!customerId) return;
  await supabaseQuery("conversations", "POST", {
    customer_id: customerId,
    message_type: messageType, // 'customer' or 'bot'
    message_text: messageText,
    metadata: metadata,
  });
}

// Get active products
async function getProducts() {
  const products = await supabaseQuery("products", "GET", null, "select=*&is_active=eq.true");
  return products || [];
}

// Save a new order
async function saveOrder(orderData: { customer_id: number; product_id: number; full_name: string; phone_number: string; delivery_address: string; quantity: number; total_price_mmk: number; status: string; notes?: string }) {
  return await supabaseQuery("orders", "POST", orderData);
}

// Notify owner about customer interest (dashboard notification)
async function notifyOwnerDashboard(customerId: number, type: string, title: string, content: string, orderId: number | null = null) {
  if (!customerId) return;
  await supabaseQuery("owner_notifications", "POST", {
    notification_type: type,
    customer_id: customerId,
    order_id: orderId,
    title: title,
    content: content,
  });
}

// Update conversation context
async function updateConversationContext(customerId: number, data: { products_mentioned?: string[]; purchase_intent_level?: string; objections_raised?: string[]; preferences?: string; last_interaction_at?: string }) {
  if (!customerId) return;
  const existingContext = await supabaseQuery("conversation_context", "GET", null, `customer_id=eq.${customerId}&select=*`);
  if (existingContext && existingContext.length > 0) {
    await supabaseQuery("conversation_context", "PATCH", { ...data, updated_at: new Date().toISOString() }, `customer_id=eq.${customerId}`);
  } else {
    await supabaseQuery("conversation_context", "POST", { customer_id: customerId, ...data, updated_at: new Date().toISOString() });
  }
}

// Send message via Facebook Messenger API
async function sendMessage(recipientId: string, text: string) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text },
      },
      {
        params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Send message error:", error?.response?.data || error.message);
    await notifyTelegramError(`Failed to send Facebook message to ${recipientId}: ${error?.response?.data?.message || error.message}`);
  }
}

// Helper to extract order details from AI response or user message
function extractOrderDetails(message: string, products: any[]) {
  let productName = null;
  let quantity = 1;
  let customerName = null;
  let phoneNumber = null;
  let deliveryAddress = null;

  // Product and quantity
  for (const p of products) {
    if (message.toLowerCase().includes(p.name.toLowerCase())) {
      productName = p.name;
      const quantityMatch = message.match(/(\d+)\s*(လုံး|ခု|စုံ)/);
      if (quantityMatch && parseInt(quantityMatch[1]) > 0) {
        quantity = parseInt(quantityMatch[1]);
      }
      break;
    }
  }

  // Name (simple extraction, can be improved)
  const nameMatch = message.match(/(ကျွန်တော်|ကျွန်မ|ကျနော်|ကျမ|နာမည်|အမည်)\s*([က-အ]+\s*[က-အ]+)/);
  if (nameMatch) {
    customerName = nameMatch[2];
  }

  // Phone number (simple extraction, can be improved)
  const phoneMatch = message.match(/(09|\+959)\d{7,9}/);
  if (phoneMatch) {
    phoneNumber = phoneMatch[0];
  }

  // Delivery address (very basic, needs improvement for real-world)
  const addressKeywords = ["လိပ်စာ", "ပို့ပေးရမယ့်နေရာ", "အိမ်လိပ်စာ"];
  for (const keyword of addressKeywords) {
    const addressMatch = message.split(keyword)[1]?.trim();
    if (addressMatch) {
      deliveryAddress = addressMatch.split(/\n|,|\./)[0].trim(); // Take first line/segment after keyword
      break;
    }
  }

  return { productName, quantity, customerName, phoneNumber, deliveryAddress };
}

// Generate AI response using OpenRouter
async function generateAIResponse(psid: string, messageText: string): Promise<string> {
  try {
    const customer = await getOrCreateCustomer(psid);
    const history = await getConversationHistory(customer.id, 8);
    const products = await getProducts();

    // Build product info for the AI - show names only first, full details on specific query
    let productInfoForAI = "";
    const productNames = products.map((p: any) => p.name).join(", ");

    if (messageText.toLowerCase().includes("ပစ္စည်း")) {
      // If customer asks about products generally, list names
      productInfoForAI = `ရရှိနိုင်သော ပစ္စည်းများ: ${productNames}. မည်သည့်ပစ္စည်းအကြောင်း အသေးစိတ်သိလိုပါသလဲခင်ဗျာ။`;
    } else {
      // If customer asks about a specific product, provide full details
      const specificProductQuery = products.find(p => messageText.toLowerCase().includes(p.name.toLowerCase()));
      if (specificProductQuery) {
        productInfoForAI = `\n${specificProductQuery.name} (${specificProductQuery.sku}): ${specificProductQuery.description || ""} | စျေးနှုန်း: ${Number(specificProductQuery.price_mmk).toLocaleString()} MMK | ${specificProductQuery.filter_stages || ""} | Stock: (အခုလက်ရှိ stock ရှိပါတယ်ခင်ဗျာ။ Stock ကုန်နေပါက ၇-၁၀ ရက်အတွင်း ရပါမယ်။)`; // Assume stock for now
      } else {
        productInfoForAI = `ရရှိနိုင်သော ပစ္စည်းများ: ${productNames}.`;
      }
    }

    // Build conversation history for context
    const historyMessages = (history || []).reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    const systemPrompt = `သင်သည် EIREE Water Purifiers ၏ AI အရောင်းဝန်ထမ်း ဖြစ်ပါသည်။

သင့်ရဲ့ လုပ်ဆောင်ချက်များ:
1. ဖောက်သည်များကို ချိုသာစွာ ကြိုဆိုပါ
2. ရေသန့်စက်များအကြောင်း ပညာပေးပါ
3. ဖောက်သည်ရဲ့ လိုအပ်ချက်ကို နားထောင်ပြီး သင့်တော်တဲ့ ပစ္စည်းကို အကြံပေးပါ
4. ဝယ်ယူလိုပါက အော်ဒါယူပါ (နာမည်၊ ဖုန်းနံပါတ်၊ လိပ်စာ၊ ပစ္စည်းအမည်၊ အရေအတွက် တောင်းပါ)
5. လူသားတစ်ယောက်လို ပြောပါ - ရိုးရှင်းပြီး ချိုသာစွာ
6. အကယ်၍ ဖောက်သည်မှ ပစ္စည်းအကြောင်းမေးပါက ပစ္စည်းအမည်များကိုသာ ဦးစွာဖော်ပြပါ။ ထို့နောက်မှ ဖောက်သည်မှ စိတ်ဝင်စားသော ပစ္စည်းအမည်ကို ပြောမှသာ အသေးစိတ်အချက်အလက်များကို ပြောပြပါ။
7. ပစ္စည်း Stock မရှိပါက "အခုလက်ရှိ stock ကုန်နေပါတယ်ခင်ဗျာ။ Pre-order တင်ထားပေးရမလားခင်ဗျာ? ၇-၁၀ ရက်အတွင်း ရပါမယ်" ဟုပြောပြီး pre-order တင်ရန် တိုက်တွန်းပါ။ (လောလောဆယ်တော့ ပစ္စည်းအားလုံး Stock ရှိသည်ဟု ယူဆပါ)
8. အကယ်၍ AI မှ မသေချာသော မေးခွန်းများ (ဥပမာ- အသံဖိုင်၊ ဓာတ်ပုံ၊ နားမလည်သော မေးခွန်းများ) ကို ကြုံတွေ့ရပါက "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်" ဟု ပြန်ဖြေပါ။

ရရှိနိုင်သော ပစ္စည်းများ:
${productInfoForAI}

အရေးကြီးသော အချက်များ:
- USA နည်းပညာ ဖြင့် Taiwan မှာ ထုတ်လုပ်ထားတာ
- US FDA အသိအမှတ်ပြု
- UF (Ultrafiltration) နည်းပညာ - ဘက်တီးရီးယား 99.99% စစ်ထုတ်ပေးတယ်
- 0.01μm filter precision
- ရန်ကုန်မြို့တွင်း အခမဲ့ ပို့ဆောင်တပ်ဆင်ပေးတယ်
- Warranty ပါတယ်

စကားပြောပုံ:
- မြန်မာလို ပြောပါ
- ချိုသာပြီး professional ဖြစ်ပါ
- ဖောက်သည်ကို "ခင်ဗျာ" သုံးပြီး ပြောပါ (ယောက်ျားလေး tone)
- "ရှင့်" မသုံးပါနဲ့ - "ခင်ဗျာ" တစ်မျိုးတည်းသုံးပါ
- "ကြိုဆိုပါတယ်ခင်ဗျာ" "ကူညီပေးပါရစေခင်ဗျာ" စသဖြင့် ယောက်ျားလေးပုံစံ ပြောပါ
- အရမ်းရှည်ရှည်မပြောပါနဲ့ - ရိုးရှင်းတိုတိုပြောပါ (3-4 ကြောင်းထက် မပိုပါနဲ့)
- ဖောက်သည် စိတ်ဝင်စားတယ်ဆိုရင် order ယူဖို့ ကြိုးစားပါ
- Emoji ကို သင့်တော်သလို သုံးပါ

${customer.first_name ? `ဒီဖောက်သည်ရဲ့ နာမည်: ${customer.first_name} ${customer.last_name || ""}` : ""}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: messageText },
    ];

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages,
        max_tokens: 500,
        temperature: 0.7,
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiReply = response.data.choices[0]?.message?.content || "ခွင့်ပြုပါ၊ ခဏလေး ပြန်ဆက်သွယ်ပါမယ်ခင်ဗျာ။";

    // AI Uncertainty Handling
    const uncertaintyKeywords = ["ခဏလေးစောင့်ပေးပါခင်ဗျာ", "ပြန်ဆက်သွယ်ပေးပါမယ်"];
    if (uncertaintyKeywords.some(kw => aiReply.includes(kw))) {
      await notifyOwnerDashboard(
        customer.id,
        "ai_uncertainty",
        "AI မသေချာသော မေးခွန်း",
        `PSID: ${psid} | Customer message: "${messageText}" | AI replied with uncertainty.`
      );
    }

    // Order Flow Improvement: Check if AI is asking for order details or confirming order
    const orderConfirmationKeywords = ["အော်ဒါတင်ရန်", "မှာယူရန်", "အချက်အလက်များ", "အတည်ပြု"];
    if (orderConfirmationKeywords.some(kw => aiReply.includes(kw)) || messageText.toLowerCase().includes("မှာမယ်")) {
      const { productName, quantity, customerName, phoneNumber, deliveryAddress } = extractOrderDetails(messageText, products);
      const product = products.find(p => p.name === productName);

      if (product && customerName && phoneNumber && deliveryAddress && quantity > 0) {
        const total_price_mmk = product.price_mmk * quantity;
        const newOrder = await saveOrder({
          customer_id: customer.id,
          product_id: product.id,
          full_name: customerName,
          phone_number: phoneNumber,
          delivery_address: deliveryAddress,
          quantity: quantity,
          total_price_mmk: total_price_mmk,
          status: "pending",
          notes: `Order placed via AI bot for ${product.name}`,
        });

        if (newOrder) {
          await notifyOwnerDashboard(
            customer.id,
            "new_order",
            "အော်ဒါအသစ်",
            `PSID: ${psid} မှ အော်ဒါအသစ်တင်ထားပါသည်။ Product: ${product.name}, Quantity: ${quantity}, Total: ${total_price_mmk} MMK.`, 
            newOrder[0]?.id
          );
          // Update AI reply to confirm order
          return `အော်ဒါကို လက်ခံရရှိပါပြီခင်ဗျာ။ ${customerName} ရဲ့ ${product.name} ${quantity} လုံးကို ${deliveryAddress} သို့ ပို့ဆောင်ပေးပါမယ်။ စုစုပေါင်း ကျသင့်ငွေ ${total_price_mmk.toLocaleString()} MMK ဖြစ်ပါတယ်။ မကြာခင် ဆက်သွယ်ပေးပါမယ်ခင်ဗျာ။`;
        } else {
          await notifyTelegramError(`Failed to save order for PSID ${psid}. Message: ${messageText}`);
          return "အော်ဒါတင်ရာတွင် အခက်အခဲရှိနေပါသည်ခင်ဗျာ။ ခဏလေးစောင့်ပေးပါ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။";
        }
      } else if (messageText.toLowerCase().includes("မှာမယ်")) {
        // If customer wants to order but details are missing, ask for them
        return "မှာယူလိုပါက နာမည်၊ ဖုန်းနံပါတ်၊ ပို့ဆောင်ရမည့်လိပ်စာ၊ ဝယ်ယူလိုသော ပစ္စည်းအမည်နှင့် အရေအတွက်တို့ကို ပြောပြပေးပါခင်ဗျာ။";
      }
    }

    // Save conversation to database
    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", aiReply);

    // Customer summary: Update conversation_context
    const productsMentioned = products.filter(p => messageText.toLowerCase().includes(p.name.toLowerCase())).map(p => p.name);
    let purchaseIntentLevel = "low";
    const purchaseKeywords = ["မှာမယ်", "ဝယ်မယ်", "order", "အော်ဒါ", "ယူမယ်", "လိုချင်", "ဘယ်လောက်", "စျေး", "price"];
    if (purchaseKeywords.some(kw => messageText.toLowerCase().includes(kw))) {
      purchaseIntentLevel = "high";
    }

    await updateConversationContext(customer.id, {
      products_mentioned: productsMentioned.length > 0 ? productsMentioned : undefined,
      purchase_intent_level: purchaseIntentLevel,
      last_interaction_at: new Date().toISOString(),
      // objections_raised and preferences would require more advanced NLP
    });

    return aiReply;
  } catch (error: any) {
    console.error("AI Response Error:", error?.response?.data || error.message);
    await notifyTelegramError(`AI Response Error for PSID ${psid}: ${error?.response?.data?.message || error.message}`);
    return "ခွင့်ပြုပါခင်ဗျာ၊ ခဏလေး ပြန်ဆက်သွယ်ပါမယ်။ 🙏";
  }
}

// Main handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET - Facebook webhook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
      console.log("Webhook verified successfully");
      return res.status(200).send(challenge);
    } else {
      console.error("Webhook verification failed");
      return res.status(403).send("Forbidden");
    }
  }

  // POST - Receive messages from Facebook
  if (req.method === "POST") {
    const body = req.body;

    if (body.object === "page") {
      for (const entry of body.entry || []) {
        if (entry.messaging) {
          for (const event of entry.messaging) {
            const senderId = event.sender.id;

            // Human handover support: Check bot_paused status
            const customer = await getOrCreateCustomer(senderId);
            if (customer && customer.bot_paused) {
              console.log(`Bot paused for customer ${senderId}. Skipping message processing.`);
              return res.status(200).send("EVENT_RECEIVED"); // Acknowledge message but don't process
            }

            if (event.message && event.message.text) {
              const messageText = event.message.text;

              try {
                const reply = await generateAIResponse(senderId, messageText);
                await sendMessage(senderId, reply);
              } catch (err) {
                console.error("Error processing message:", err);
                await notifyTelegramError(`Error processing message for PSID ${senderId}: ${err instanceof Error ? err.message : String(err)}`);
                await sendMessage(senderId, "ခွင့်ပြုပါခင်ဗျာ၊ ခဏလေး ပြန်ဆက်သွယ်ပါမယ်။ 🙏");
              }
            } else if (event.message) {
                // Handle non-text messages
                const nonTextMessage = "ခွင့်ပြုပါခင်ဗျာ၊ လောလောဆယ် text message ပဲ လက်ခံနိုင်ပါသေးတယ်။ စာရိုက်ပြီး မေးပေးပါခင်ဗျာ 🙏";
                await sendMessage(senderId, nonTextMessage);
                // Notify dashboard about non-text message
                await notifyOwnerDashboard(
                    customer.id,
                    "non_text_message",
                    "ဖောက်သည်မှ text မဟုတ်သော message ပို့ပါသည်",
                    `PSID: ${senderId} sent a non-text message (e.g., image, audio, sticker).`
                );
                await saveConversation(customer.id, "customer", "[Non-text message]", event.message);
                await saveConversation(customer.id, "bot", nonTextMessage);
            }
          }
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(405).send("Method not allowed");
}
// Force redeploy Fri May  8 11:15:08 EDT 2026
