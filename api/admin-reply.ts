import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

// ═══════════════════════════════════════════════════════════════
// ADMIN REPLY API
// Dashboard ကနေ Admin reply လုပ်တာကို Facebook Messenger ဆီ ပို့
// POST /api/admin-reply
// Body: { customer_id, message, admin_id }
// ═══════════════════════════════════════════════════════════════

const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — Lovable dashboard ကနေ call လုပ်ခွင့်ပေး
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { customer_id, message, admin_id } = req.body;

    // Validation
    if (!customer_id || !message?.trim()) {
      return res.status(400).json({ error: "customer_id and message are required" });
    }

    // Customer ရဲ့ PSID ယူ
    const customers = await supabaseQuery(
      "customers", "GET", null,
      `id=eq.${customer_id}&select=psid,bot_paused`
    );

    if (!customers || customers.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customers[0];
    const psid = customer.psid;

    if (!psid) {
      return res.status(400).json({ error: "Customer PSID not found" });
    }

    // Facebook Messenger ဆီ ပို့
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: psid },
        message: { text: message.trim() },
      },
      {
        params: { access_token: FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { "Content-Type": "application/json" },
      }
    );

    // Conversations table မှာ admin message save
    await supabaseQuery("conversations", "POST", {
      customer_id: customer_id,
      message_type: "admin",
      message_text: message.trim(),
      metadata: { admin_id: admin_id || null },
    });

    return res.status(200).json({ success: true, message: "Message sent successfully" });

  } catch (error: any) {
    console.error("Admin reply error:", error?.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to send message",
      detail: error?.response?.data?.error?.message || error.message,
    });
  }
}