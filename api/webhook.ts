import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// Environment variables
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const FACEBOOK_WEBHOOK_VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Telegram credentials for SYSTEM ERRORS ONLY
const TELEGRAM_BOT_TOKEN = "8739448828:AAFHiOlZpAKXrRCGf6hYZ8HcHgq51Ts0gCc";
const TELEGRAM_CHAT_ID = "8404721344";

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
    await notifyTelegramError(`Supabase Error (${method} ${table}): ${JSON.stringify(error?.response?.data || error.message)}`);
    return null;
  }
}

// Telegram Notification for SYSTEM ERRORS ONLY
async function notifyTelegramError(errorMessage: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(telegramApiUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `🚨 *Bot System Error* 🚨\n\n${errorMessage}`,
      parse_mode: "Markdown",
    });
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
  const newCustomer = await supabaseQuery("customers", "POST", { psid: psid });
  return newCustomer ? newCustomer[0] : { id: null, psid, bot_paused: false };
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
    message_type: messageType,
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
async function saveOrder(orderData: any) {
  return await supabaseQuery("orders", "POST", orderData);
}

// Notify owner about business events (dashboard notification)
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
async function updateConversationContext(customerId: number, data: any) {
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
    await notifyTelegramError(`Facebook Send Error: ${error?.response?.data?.error?.message || error.message}`);
  }
}

// Helper to extract order details
function extractOrderDetails(message: string, products: any[]) {
  let productName = null;
  let quantity = 1;
  let customerName = null;
  let phoneNumber = null;
  let deliveryAddress = null;

  for (const p of products) {
    if (message.toLowerCase().includes(p.name.toLowerCase())) {
      productName = p.name;
      const quantityMatch = message.match(/(\d+)\s*(လုံး|ခု|စုံ)/);
      if (quantityMatch) quantity = parseInt(quantityMatch[1]);
      break;
    }
  }

  const nameMatch = message.match(/(နာမည်|အမည်|ကျွန်တော်က|ကျနော်က|ကျွန်မက|ကျမက)\s*[:\-]?\s*([က-အ\s]+)/);
  if (nameMatch) customerName = nameMatch[2].trim();

  const phoneMatch = message.match(/(09|\+959)\d{7,9}/);
  if (phoneMatch) phoneNumber = phoneMatch[0];

  const addressKeywords = ["လိပ်စာ", "ပို့ပေးရမယ့်နေရာ", "အိမ်လိပ်စာ", "နေရပ်"];
  for (const keyword of addressKeywords) {
    if (message.includes(keyword)) {
      const parts = message.split(keyword);
      if (parts[1]) deliveryAddress = parts[1].replace(/[:\-]/, "").trim().split("\n")[0];
      break;
    }
  }

  return { productName, quantity, customerName, phoneNumber, deliveryAddress };
}

// Generate AI response
async function generateAIResponse(psid: string, messageText: string): Promise<string> {
  try {
    const customer = await getOrCreateCustomer(psid);
    const history = await getConversationHistory(customer.id, 10);
    const products = await getProducts();
    
    // Get context
    const contextData = await supabaseQuery("conversation_context", "GET", null, `customer_id=eq.${customer.id}&select=*`);
    const context = contextData && contextData.length > 0 ? contextData[0] : null;
    const preferredAddress = context?.preferences;

    // First message handling
    if (!preferredAddress && history.length === 0) {
      await updateConversationContext(customer.id, { preferences: "pending" });
      return "မင်္ဂလာပါခင်ဗျာ။ EIREE Water Purifiers က ကြိုဆိုပါတယ်ခင်ဗျာ။ အကို/အမ ဘယ်လိုခေါ်ရမလဲခင်ဗျာ?";
    }

    // Preference detection
    if (context?.preferences === "pending") {
      let detectedAddress = "";
      if (messageText.includes("အကို") || messageText.includes("ကျနော်") || messageText.includes("ကျွန်တော်")) {
        detectedAddress = "အကို";
      } else if (messageText.includes("အမ") || messageText.includes("ကျမ") || messageText.includes("ကျွန်မ")) {
        detectedAddress = "အမ";
      } else {
        detectedAddress = "အကို/အမ"; 
      }
      await updateConversationContext(customer.id, { preferences: detectedAddress });
    }

    const currentAddress = context?.preferences || "အကို/အမ";

    // Product context
    let productContext = "";
    const productNames = products.map((p: any) => p.name).join(", ");
    const mentionedProduct = products.find(p => messageText.toLowerCase().includes(p.name.toLowerCase()));
    
    if (mentionedProduct) {
      const stockStatus = mentionedProduct.stock_quantity > 0 
        ? `လက်ရှိ Stock ရှိပါတယ်ခင်ဗျာ။` 
        : `လက်ရှိ Stock ပြတ်နေပါတယ်ခင်ဗျာ။ Pre-order တင်ထားလို့ရပါတယ်၊ ၇-၁၀ ရက်အတွင်း ပို့ပေးပါမယ်။`;
      
      productContext = `ပစ္စည်းအမည်: ${mentionedProduct.name}
စျေးနှုန်း: ${Number(mentionedProduct.price_mmk).toLocaleString()} MMK
အသေးစိတ်: ${mentionedProduct.description || "N/A"}
Stock အခြေအနေ: ${stockStatus}`;
    } else {
      productContext = `ရရှိနိုင်သော ပစ္စည်းအမည်များ: ${productNames}. (ပစ္စည်းအမည်ကို အတိအကျမေးမှသာ အသေးစိတ်ကို ဖြေပေးပါ။)`;
    }

    const historyMessages = (history || []).reverse().map((h: any) => ({
      role: h.message_type === "customer" ? "user" : "assistant",
      content: h.message_text,
    }));

    const systemPrompt = `သင်သည် EIREE Water Purifiers ၏ ကျွမ်းကျင်သော အရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်ပါသည်။

အရောင်းဗျူဟာနှင့် စကားပြောပုံစံ:
1. သင်သည် စက်ရုပ်မဟုတ်ဘဲ နွေးထွေးပျူငှာသော လူသားတစ်ဦးကဲ့သို့ စကားပြောပါ။
2. ဖောက်သည်ကို "${currentAddress}" ဟုသာ ခေါ်ဝေါ်သုံးစွဲပါ။
3. မိမိကိုယ်ကို ရည်ညွှန်းလျှင် "ခင်ဗျာ" ကိုသာ သုံးပါ။ "ရှင့်" လုံးဝမသုံးရပါ။
4. စကားပြောလျှင် တိုတိုနှင့် လိုရင်းကိုသာ ပြောပါ။ တစ်ခါပြန်လျှင် စာကြောင်း ၂ ကြောင်း သို့မဟုတ် ၃ ကြောင်းထက် ပိုမရှည်ပါစေနှင့်။
5. Bullet points များ၊ စာရှည်ကြီးများကို ရှောင်ပါ။ သူငယ်ချင်းချင်း chat သကဲ့သို့ သဘာဝကျကျ ပြောပါ။
6. အရောင်းပိတ်နိုင်ရန် တက်ကြွစွာ ကြိုးစားပါ။ ပစ္စည်း၏ ကောင်းကွက်များကို ထင်ရှားအောင်ပြောပြပြီး ဝယ်ယူရန် တိုက်တွန်းပါ။
7. ပစ္စည်းအကြောင်းမေးလျှင် အမည်များကိုသာ အရင်ပြောပြပါ။ စိတ်ဝင်စားမှုရှိမှသာ အသေးစိတ်နှင့် စျေးနှုန်းကို ပြောပြပါ။
8. အော်ဒါတင်လိုပါက နာမည်၊ ဖုန်း၊ လိပ်စာ၊ ပစ္စည်းအမည်၊ အရေအတွက်တို့ကို တောင်းခံပါ။
9. သင်ကိုယ်တိုင် မသေချာသော မေးခွန်းများ၊ အသံဖိုင်များ၊ သို့မဟုတ် နားမလည်သော အကြောင်းအရာများဖြစ်ပါက "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်" ဟုသာ ဖြေပါ။

လက်ရှိပစ္စည်းအချက်အလက်:
${productContext}`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemPrompt }, ...historyMessages, { role: "user", content: messageText }],
        max_tokens: 300,
        temperature: 0.7,
      },
      { 
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 8000 // 8 seconds timeout for AI call to stay within Vercel limits
      }
    );

    const aiReply = response.data.choices[0]?.message?.content || "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။";

    // Uncertainty handling
    if (aiReply.includes("ခဏလေးစောင့်ပေးပါခင်ဗျာ") || aiReply.includes("ပြန်ဆက်သွယ်ပေးပါမယ်")) {
      await notifyOwnerDashboard(customer.id, "ai_uncertainty", "AI Uncertainty", `Customer: ${messageText}`);
    }

    // Order processing
    if (messageText.includes("မှာမယ်") || messageText.includes("ယူမယ်") || aiReply.includes("အော်ဒါ")) {
      const details = extractOrderDetails(messageText, products);
      const product = products.find(p => p.name === details.productName);
      
      if (product && details.customerName && details.phoneNumber && details.deliveryAddress) {
        if (product.stock_quantity <= 0) {
          return `စိတ်မရှိပါနဲ့ခင်ဗျာ၊ ${product.name} က လက်ရှိ Stock ပြတ်နေလို့ Pre-order အနေနဲ့ပဲ မှတ်သားထားပေးပါမယ်။ ၇-၁၀ ရက်အတွင်း ပို့ပေးပါမယ်ခင်ဗျာ။ အားလုံးအဆင်ပြေပါသလား?`;
        }
        
        const order = await saveOrder({
          customer_id: customer.id,
          product_id: product.id,
          full_name: details.customerName,
          phone_number: details.phoneNumber,
          delivery_address: details.deliveryAddress,
          quantity: details.quantity,
          total_price_mmk: product.price_mmk * details.quantity,
          status: "pending"
        });

        if (order) {
          await notifyOwnerDashboard(customer.id, "new_order", "New Order Received", `Product: ${product.name}, Customer: ${details.customerName}`);
          return `အော်ဒါတင်ပေးပြီးပါပြီခင်ဗျာ။ ${details.customerName} ရဲ့ ${product.name} (${details.quantity}) ခုကို ${details.deliveryAddress} သို့ ပို့ဆောင်ပေးပါမယ်။ မကြာခင် ဖုန်းဆက်သွယ်ပေးပါမယ်ခင်ဗျာ။`;
        }
      }
    }

    await saveConversation(customer.id, "customer", messageText);
    await saveConversation(customer.id, "bot", aiReply);
    
    return aiReply;
  } catch (error: any) {
    console.error("AI Error:", error.response?.data || error.message);
    await notifyTelegramError(`AI API Error: ${JSON.stringify(error.response?.data || error.message)}`);
    return "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";
  }
}

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
      // Process messages synchronously within the handler to avoid Vercel background execution issues
      // We will use Promise.all to handle multiple events in one request but wait for them
      try {
        const tasks = [];
        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender.id;
            
            tasks.push((async () => {
              const customer = await getOrCreateCustomer(senderId);
              if (customer && customer.bot_paused) return;

              if (event.message && event.message.text) {
                const reply = await generateAIResponse(senderId, event.message.text);
                await sendMessage(senderId, reply);
              } else if (event.message) {
                const reply = "ခဏလေးစောင့်ပေးပါခင်ဗျာ၊ ကျွန်တော်တို့ team ကနေ ပြန်ဆက်သွယ်ပေးပါမယ်။ 🙏";
                await sendMessage(senderId, reply);
                await notifyOwnerDashboard(customer.id, "non_text_message", "Non-text Message", `Customer sent a ${Object.keys(event.message)[0]}`);
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
