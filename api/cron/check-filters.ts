import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT VARIABLES
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPER — webhook.ts နဲ့ အတူတူပဲ axios သုံးမယ်
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
  } catch (error: any) {
    console.error(`Supabase ${method} ${table} error:`, error?.response?.data || error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACEBOOK MESSAGE SENDER
// POST_PURCHASE_UPDATE tag — ဝယ်ပြီးသား customer ကို proactive ပို့ဖို့
// ═══════════════════════════════════════════════════════════════
async function sendFacebookMessage(psid: string, text: string): Promise<boolean> {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: psid },
        message: { text },
        messaging_type: "MESSAGE_TAG",
        tag: "POST_PURCHASE_UPDATE",
      },
      {
        params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { "Content-Type": "application/json" },
      }
    );
    return res.status === 200;
  } catch (err: any) {
    console.error(`[Cron] Facebook send failed for PSID ${psid}:`, err?.response?.data || err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// conversation_context preferences update
// ═══════════════════════════════════════════════════════════════
async function updateContextPreferences(
  customerId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const existing = await supabaseQuery(
    "conversation_context", "GET", null, `customer_id=eq.${customerId}&select=preferences`
  );
  const currentPrefs = existing?.[0]?.preferences ?? {};
  const newPrefs = { ...currentPrefs, ...updates };
  await supabaseQuery(
    "conversation_context", "PATCH",
    { preferences: newPrefs, updated_at: new Date().toISOString() },
    `customer_id=eq.${customerId}`
  );
}

// ═══════════════════════════════════════════════════════════════
// conversations table ထဲ bot log သွင်းမယ်
// AI က Cron ဘာပို့သွားတယ်ဆိုတာ context ထဲ မြင်နိုင်မယ်
// ═══════════════════════════════════════════════════════════════
async function logBotMessage(customerId: string, messageText: string): Promise<void> {
  await supabaseQuery("conversations", "POST", {
    customer_id: customerId,
    message_type: "bot",
    message_text: messageText,
    metadata: { source: "cron_job" },
    created_at: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════════
// 1-MONTH CHECK — Satisfaction + Referral
// ═══════════════════════════════════════════════════════════════
async function processOneMonthChecks(): Promise<void> {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 31);
  const to = new Date(now);
  to.setDate(to.getDate() - 29);

  const orders = await supabaseQuery(
    "orders", "GET", null,
    `status=eq.confirmed&confirmed_at=gte.${from.toISOString()}&confirmed_at=lte.${to.toISOString()}&select=id,customer_id,product_id,confirmed_at`
  );

  if (!orders || orders.length === 0) {
    console.log("[Cron 1-month] No customers to follow up today.");
    return;
  }

  for (const order of orders) {
    // Customer PSID ဆွဲထုတ်မယ်
    const customerData = await supabaseQuery(
      "customers", "GET", null, `id=eq.${order.customer_id}&select=psid`
    );
    const psid = customerData?.[0]?.psid;
    if (!psid) continue;

    // Product name ဆွဲထုတ်မယ်
    const productData = await supabaseQuery(
      "products", "GET", null, `id=eq.${order.product_id}&select=name`
    );
    const productName = productData?.[0]?.name || "Eiree ရေသန့်စက်";

    // ပို့ပြီးသားဆိုရင် skip
    const ctxData = await supabaseQuery(
      "conversation_context", "GET", null, `customer_id=eq.${order.customer_id}&select=preferences`
    );
    const prefs = ctxData?.[0]?.preferences ?? {};
    if (prefs.one_month_check_sent_at) {
      console.log(`[Cron 1-month] Already sent for customer ${order.customer_id}, skipping.`);
      continue;
    }

    // AI Training ID 41 script — male character, သဘာဝကျကျ
    const message =
      `မင်္ဂလာပါခင်ဗျာ။\n\n` +
      `Eiree ရေသန့်စက်လေး တပ်ဆင်ပြီးတာ ၁ လပြည့်သွားပြီမို့ ` +
      `ရေအရသာနဲ့ ဝန်ဆောင်မှုပိုင်း အဆင်ပြေရဲ့လား သိပါရစေခင်ဗျာ။ 😊\n\n` +
      `မိသားစု ကျေနပ်မှုရှိတယ်ဆိုရင် မိတ်ဆွေတွေကို Eiree စက်လေး ညွှန်းပေးပါနော်။ ` +
      `ညွှန်းပေးလို့ ဝယ်ယူဖြစ်သွားခဲ့ရင် နောက်တစ်ကြိမ် Filter လဲချိန်မှာ ` +
      `Filter တစ်စုံ အခမဲ့ (FOC) လဲလှယ်ပေးသွားမှာပါခင်ဗျာ။ 🎁✨`;

    const sent = await sendFacebookMessage(psid, message);

    if (sent) {
      const sentAt = new Date().toISOString();
      await updateContextPreferences(order.customer_id, {
        purchased_product: productName,
        purchased_product_id: order.product_id,
        confirmed_at: order.confirmed_at,
        one_month_check_sent_at: sentAt,
      });
      // conversations table ထဲ တကယ်ပို့လိုက်တဲ့ message text ကိုသွင်းမယ်
      // Dashboard မှာ Messenger မှာပို့ထားသလိုပဲ မြင်ရမယ်
      await logBotMessage(order.customer_id, message);
      console.log(`[Cron 1-month] Sent to PSID: ${psid} — ${productName}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 6-MONTH CHECK — Filter Replacement Reminder
// ═══════════════════════════════════════════════════════════════
async function processSixMonthChecks(): Promise<void> {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 181);
  const to = new Date(now);
  to.setDate(to.getDate() - 179);

  const orders = await supabaseQuery(
    "orders", "GET", null,
    `status=eq.confirmed&confirmed_at=gte.${from.toISOString()}&confirmed_at=lte.${to.toISOString()}&select=id,customer_id,product_id,confirmed_at`
  );

  if (!orders || orders.length === 0) {
    console.log("[Cron 6-month] No customers to remind today.");
    return;
  }

  for (const order of orders) {
    const customerData = await supabaseQuery(
      "customers", "GET", null, `id=eq.${order.customer_id}&select=psid`
    );
    const psid = customerData?.[0]?.psid;
    if (!psid) continue;

    const productData = await supabaseQuery(
      "products", "GET", null, `id=eq.${order.product_id}&select=name`
    );
    const productName = productData?.[0]?.name || "Eiree ရေသန့်စက်";

    // ပို့ပြီးသားဆိုရင် skip
    const ctxData = await supabaseQuery(
      "conversation_context", "GET", null, `customer_id=eq.${order.customer_id}&select=preferences`
    );
    const prefs = ctxData?.[0]?.preferences ?? {};
    if (prefs.filter_reminder_sent_at) {
      console.log(`[Cron 6-month] Already sent for customer ${order.customer_id}, skipping.`);
      continue;
    }

    // Client ID 42 script — male character, သဘာဝကျကျ
    const message =
      `မင်္ဂလာပါခင်ဗျာ။\n\n` +
      `Eiree စက်လေး သုံးလာတာ ၆ လပြည့်တော့မှာဖြစ်လို့ ` +
      `ရေထွက်အားနဲ့ သန့်စင်မှုအဆင့် မကျသွားအောင် ` +
      `Carbon Filter လဲလှယ်ပေးဖို့ အချိန်တန်ပါပြီခင်ဗျာ။ 💧\n\n` +
      `Filter အသစ်လဲလှယ်မည်ဆိုပါက အိမ်အရောက် Delivery အခမဲ့ ပို့ပေးပါတယ်ခင်ဗျာ။`;

    const sent = await sendFacebookMessage(psid, message);

    if (sent) {
      const sentAt = new Date().toISOString();
      await updateContextPreferences(order.customer_id, {
        purchased_product: productName,
        purchased_product_id: order.product_id,
        confirmed_at: order.confirmed_at,
        filter_reminder_sent_at: sentAt,
      });
      // conversations table ထဲ တကယ်ပို့လိုက်တဲ့ message text ကိုသွင်းမယ်
      await logBotMessage(order.customer_id, message);
      console.log(`[Cron 6-month] Sent to PSID: ${psid} — ${productName}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Unauthorized access ကာကွယ်ဖို့
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[Cron] check-filters started at", new Date().toISOString());

  try {
    await processOneMonthChecks();
    await processSixMonthChecks();

    console.log("[Cron] check-filters completed successfully.");
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("[Cron] Unexpected error:", err);
    return res.status(500).json({ success: false, error: String(err) });
  }
}