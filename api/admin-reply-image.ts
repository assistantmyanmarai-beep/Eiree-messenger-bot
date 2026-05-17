import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT VARIABLES
// ═══════════════════════════════════════════════════════════════
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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
  } catch (error: any) {
    console.error(`Supabase ${method} ${table} error:`, error?.response?.data || error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM ERROR NOTIFY
// ═══════════════════════════════════════════════════════════════
async function notifySystemError(msg: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `System Error\n\n${msg}`,
    });
  } catch (e: any) {
    console.error("System Telegram error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ADMIN REPLY IMAGE HANDLER
// Dashboard ကနေ image ပို့တဲ့အခါ ဒီ endpoint ကို call လုပ်မယ်
// POST /api/admin-reply-image
// Body: { customer_id, image_url, admin_id }
//
// လုပ်ဆောင်တာ:
// ① Customer ရဲ့ PSID ယူမယ်
// ② Conversations table ထဲ save မယ်
// ③ Facebook Messenger ကို image ပို့မယ်
// ④ Bot pause လုပ်မယ် (30min auto-resume)
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { customer_id, image_url, admin_id } = req.body || {};

  if (!customer_id || !image_url) {
    return res.status(400).json({ error: "customer_id and image_url are required" });
  }

  try {
    // ① Customer ရဲ့ PSID ယူမယ်
    const customers = await supabaseQuery(
      "customers", "GET", null,
      `id=eq.${customer_id}&select=psid`
    );
    const psid = customers?.[0]?.psid;

    if (!psid) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // ② Conversations table ထဲ save မယ်
    await supabaseQuery("conversations", "POST", {
      customer_id,
      message_type: "admin",
      message_text: image_url,
      metadata: {
        source: "dashboard_image",
        admin_id: admin_id || null,
      },
    });

    // ③ Facebook Messenger ကို image ပို့မယ်
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: psid },
        message: {
          attachment: {
            type: "image",
            payload: { url: image_url, is_reusable: false },
          },
        },
      },
      {
        params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { "Content-Type": "application/json" },
      }
    );

    // ④ Bot pause လုပ်မယ် — Admin reply ပြီးတာနဲ့ bot ရပ်ရမယ်
    await supabaseQuery(
      "customers", "PATCH",
      { bot_paused: true, paused_at: new Date().toISOString() },
      `id=eq.${customer_id}`
    );

    console.log(`Admin image sent to customer ${customer_id} (psid: ${psid})`);
    return res.status(200).json({ success: true });

  } catch (e: any) {
    console.error("handleAdminReplyImage error:", e);
    await notifySystemError(`Admin Reply Image Error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
}