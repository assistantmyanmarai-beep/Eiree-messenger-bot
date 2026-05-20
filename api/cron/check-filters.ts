import { createClient } from "@supabase/supabase-js";

// ─── Supabase Client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Facebook Message Sender ───────────────────────────────────────────────────
async function sendFacebookMessage(
  psid: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.FACEBOOK_PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          message: { text },
          // POST_PURCHASE_UPDATE — ဝယ်ပြီးသား customer ကို proactive message ပို့ဖို့ Message Tag သုံးတယ်
          messaging_type: "MESSAGE_TAG",
          tag: "POST_PURCHASE_UPDATE",
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      console.error(`[Cron] Facebook send failed for PSID ${psid}:`, err);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Cron] Facebook send error for PSID ${psid}:`, err);
    return false;
  }
}

// ─── conversation_context preferences update ──────────────────────────────────
async function updateContextPreferences(
  customerId: string,
  updates: Record<string, unknown>
): Promise<void> {
  // လက်ရှိ preferences ဆွဲထုတ်မယ်
  const { data: existing } = await supabase
    .from("conversation_context")
    .select("preferences")
    .eq("customer_id", customerId)
    .single();

  const currentPrefs = existing?.preferences ?? {};
  const newPrefs = { ...currentPrefs, ...updates };

  await supabase
    .from("conversation_context")
    .upsert({ customer_id: customerId, preferences: newPrefs, updated_at: new Date().toISOString() });
}

// ─── conversations table ထဲ bot log သွင်းမယ် ─────────────────────────────────
async function logBotMessage(
  customerId: string,
  messageText: string
): Promise<void> {
  await supabase.from("conversations").insert({
    customer_id: customerId,
    message_type: "bot",
    message_text: messageText,
    metadata: { source: "cron_job" },
    created_at: new Date().toISOString(),
  });
}

// ─── 1-Month Check ────────────────────────────────────────────────────────────
async function processOneMonthChecks(): Promise<void> {
  const now = new Date();
  // 1 လပြည့်တဲ့ range — 30 days ±1 day tolerance
  const from = new Date(now);
  from.setDate(from.getDate() - 31);
  const to = new Date(now);
  to.setDate(to.getDate() - 29);

  // confirmed orders ထဲက 1 လပြည့်တာ ဆွဲထုတ်မယ်
  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id,
      customer_id,
      full_name,
      product_id,
      confirmed_at,
      customers!inner(psid),
      products!inner(name)
    `)
    .eq("status", "confirmed")
    .gte("confirmed_at", from.toISOString())
    .lte("confirmed_at", to.toISOString());

  if (error) {
    console.error("[Cron 1-month] Query error:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[Cron 1-month] No customers to follow up today.");
    return;
  }

  for (const order of orders) {
    const psid = (order.customers as { psid: string }).psid;
    const productName = (order.products as { name: string }).name;

    // ပို့ပြီးသားဆိုရင် skip — conversation_context check
    const { data: ctx } = await supabase
      .from("conversation_context")
      .select("preferences")
      .eq("customer_id", order.customer_id)
      .single();

    const prefs = ctx?.preferences ?? {};
    if (prefs.one_month_check_sent_at) {
      console.log(`[Cron 1-month] Already sent for customer ${order.customer_id}, skipping.`);
      continue;
    }

    // AI Training ID 41 script — male character, သဘာဝကျကျ
    // Gender မသေချာတဲ့အတွက် အကို/အမ မခေါ်ဘဲ ရိုးရိုး message သာ ပို့မယ်
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

      // conversation_context update — AI က ဒီ customer ကို 1 လပြည့် message ပို့ပြီးတာ သိမယ်
      await updateContextPreferences(order.customer_id, {
        purchased_product: productName,
        purchased_product_id: order.product_id,
        confirmed_at: order.confirmed_at,
        one_month_check_sent_at: sentAt,
      });

      // conversations log — AI က Cron က ဘာပို့သွားတယ်ဆိုတာ context ထဲ မြင်နိုင်မယ်
      await logBotMessage(
        order.customer_id,
        `[Cron Auto-Message] ၁ လပြည့် satisfaction check နဲ့ referral program message ပို့ပြီး။ Product: ${productName}`
      );

      console.log(`[Cron 1-month] Sent to PSID: ${psid} — ${productName}`);
    }
  }
}

// ─── 6-Month Check ────────────────────────────────────────────────────────────
async function processSixMonthChecks(): Promise<void> {
  const now = new Date();
  // 6 လပြည့်တဲ့ range — 180 days ±1 day tolerance
  const from = new Date(now);
  from.setDate(from.getDate() - 181);
  const to = new Date(now);
  to.setDate(to.getDate() - 179);

  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id,
      customer_id,
      full_name,
      product_id,
      confirmed_at,
      customers!inner(psid),
      products!inner(name)
    `)
    .eq("status", "confirmed")
    .gte("confirmed_at", from.toISOString())
    .lte("confirmed_at", to.toISOString());

  if (error) {
    console.error("[Cron 6-month] Query error:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[Cron 6-month] No customers to remind today.");
    return;
  }

  for (const order of orders) {
    const psid = (order.customers as { psid: string }).psid;
    const productName = (order.products as { name: string }).name;

    // ပို့ပြီးသားဆိုရင် skip
    const { data: ctx } = await supabase
      .from("conversation_context")
      .select("preferences")
      .eq("customer_id", order.customer_id)
      .single();

    const prefs = ctx?.preferences ?? {};
    if (prefs.filter_reminder_sent_at) {
      console.log(`[Cron 6-month] Already sent for customer ${order.customer_id}, skipping.`);
      continue;
    }

    // Client ID 42 script အခြေခံ — male character, သဘာဝကျကျ
    // Gender မသေချာတဲ့အတွက် အကို/အမ မခေါ်ဘဲ ရိုးရိုး message သာ ပို့မယ်
    const message =
      `မင်္ဂလာပါခင်ဗျာ။\n\n` +
      `Eiree စက်လေး သုံးလာတာ ၆ လပြည့်တော့မှာဖြစ်လို့ ` +
      `ရေထွက်အားနဲ့ သန့်စင်မှုအဆင့် မကျသွားအောင် ` +
      `Carbon Filter လဲလှယ်ပေးဖို့ အချိန်တန်ပါပြီခင်ဗျာ။ 💧\n\n` +
      `Filter အသစ်လဲလှယ်မည်ဆိုပါက အိမ်အရောက် Delivery အခမဲ့ ပို့ပေးပါတယ်ခင်ဗျာ။`;

    const sent = await sendFacebookMessage(psid, message);

    if (sent) {
      const sentAt = new Date().toISOString();

      // conversation_context update
      await updateContextPreferences(order.customer_id, {
        purchased_product: productName,
        purchased_product_id: order.product_id,
        confirmed_at: order.confirmed_at,
        filter_reminder_sent_at: sentAt,
      });

      // conversations log
      await logBotMessage(
        order.customer_id,
        `[Cron Auto-Message] ၆ လပြည့် Carbon Filter လဲဖို့ reminder ပို့ပြီး။ Product: ${productName}`
      );

      console.log(`[Cron 6-month] Sent to PSID: ${psid} — ${productName}`);
    }
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  // Vercel Cron က CRON_SECRET နဲ့ verify လုပ်တယ် — unauthorized access ကာကွယ်ဖို့
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  console.log("[Cron] check-filters started at", new Date().toISOString());

  try {
    await processOneMonthChecks();
    await processSixMonthChecks();

    console.log("[Cron] check-filters completed successfully.");
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Cron] Unexpected error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}