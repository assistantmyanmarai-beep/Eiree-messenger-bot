# 🌊 EIREE Myanmar — AI Sales Agent & Admin Dashboard

> **EIREE Water Purifier** အတွက် Facebook Messenger AI Sales Bot နဲ့ Web-based Admin Dashboard တည်ဆောက်ထားတဲ့ Integrated System

---

## 📋 Project Overview

ဒီ Project ရဲ့ ရည်ရွယ်ချက်က **ရေသန့်စက် အရောင်း process တစ်ခုလုံးကို Automate** လုပ်ဖို့ပဲဗျ။

| Component | ရည်ရွယ်ချက် |
|-----------|------------|
| **Messenger Bot** | Customer တွေနဲ့ AI ဖြင့် အလိုအလျောက် စကားပြောပြီး Order ကောက်တယ် |
| **Admin Dashboard** | Owner/Client က Products, Orders, Conversations တွေ Manage လုပ်တယ် |
| **AI Training** | Client ကိုယ်တိုင် Bot ကို Customize လုပ်နိုင်တယ် (Tone, Style, Product Knowledge) |

### Key Players
- **Ko Ray** — Developer/Owner (Supabase, Vercel, API Keys Manage လုပ်တယ်)
- **Aung Myat Theinn** — Client (Dashboard သုံးပြီး Products Update, AI Training လုပ်တယ်)
- **Customers** — Facebook Messenger ကနေ Bot နဲ့ စကားပြောတဲ့ End Users

---

## 🛠 Tech Stack

```
┌─────────────────────────────────────────────────────┐
│                    Tech Stack                        │
├──────────────────┬──────────────────────────────────┤
│ Frontend         │ Lovable (React + Vite)            │
│ Backend/Webhook  │ Vercel Serverless Functions       │
│ Database         │ Supabase (PostgreSQL + RLS)       │
│ AI Brain         │ OpenRouter → Gemini 2.5 Flash     │
│ Notifications    │ Telegram Bot API                  │
│ Deployment       │ GitHub → Vercel (Auto Deploy)     │
│ Media Storage    │ Supabase Storage                  │
└──────────────────┴──────────────────────────────────┘
```

---

## 🏗 System Architecture

### Flow 1 — Customer Message → Bot Reply

```
Customer က Messenger မှာ စာပို့တယ်
          │
          ▼
Facebook Server → POST /api/webhook (Vercel)
          │
          ▼
┌─────────────────────────────────────┐
│         webhook.ts (Brain)          │
│                                     │
│  1. Echo Check (Admin reply မဟုတ်?)  │
│  2. Deduplication Check              │
│  3. Bot Pause Check (30min resume)   │
│  4. Customer get/create (Supabase)   │
│  5. Conversation History ယူ          │
│  6. Products ယူ                      │
│  7. AI Training Instructions ယူ      │
│  8. OpenRouter (Gemini) ကို ခေါ်      │
│  9. AI JSON Response parse           │
│ 10. Action Handle (Order/Notify)     │
│ 11. Conversation Save                │
│ 12. Facebook ဆီ Reply ပို့            │
└─────────────────────────────────────┘
          │
          ▼
Customer ဆီ Reply ရောက်တယ်
```

### Flow 2 — Admin Dashboard Reply

```
Admin က Dashboard မှာ Reply ရိုက်တယ်
          │
          ▼
POST /api/admin-reply (Vercel)
          │
          ▼
Facebook Graph API → Customer ဆီ ပို့တယ်
          │
          ▼ (Messenger Echo Event)
POST /api/webhook ← Facebook က echo ပြန်ပို့တယ်
          │
          ▼
Echo Handler:
  - conversations table ထဲ "admin" type နဲ့ save
  - bot_paused = true + paused_at = timestamp
  - 30 မိနစ်ကြာရင် Bot အလိုလို resume
```

### Flow 3 — AI Training

```
Client → Dashboard → AI Training Page မှာ Instruction ထည့်
          │
          ▼
ai_training_config table (is_active=true)
          │
          ▼
Bot ဖြေတိုင်း → active instructions ယူ → System Prompt ထဲ inject
          │
          ▼
Bot က Client ညွှန်ကြားချက်အတိုင်း လိုက်နာပြီး ဖြေတယ်
```

### Flow 4 — Order Collection

```
Customer: "မှာချင်တယ်"
          │
          ▼
AI: action = "start_order" → collecting_order = true (context save)
          │
          ▼
AI: နာမည်၊ ဖုန်းနံပါတ်၊ လိပ်စာ တစ်ခုချင်း ကောက်တယ်
          │
          ▼
AI: action = "save_order" (3 ခုစလုံးရပြီ)
          │
          ├──→ orders table ထဲ save
          ├──→ Stock auto-deduct
          ├──→ Owner Telegram notification
          └──→ Dashboard notification
```

---

## 📁 Folder & File Structure

```
eiree-messenger-bot/
│
├── api/                          # Vercel Serverless Functions
│   ├── webhook.ts                # ⭐ Main Brain — Facebook Webhook Handler
│   │                             #    Customer messages, Echo events, AI responses
│   │                             #    Order flow, Notifications, Bot pause logic
│   │
│   ├── admin-reply.ts            # Dashboard → Facebook Messenger reply endpoint
│   │                             #    Admin က Dashboard ကနေ Customer ကို ပြန်ဖြေတယ်
│   │
│   └── privacy.ts                # Facebook App Review အတွက် Privacy Policy endpoint
│
├── src/                          # Lovable Dashboard (React)
│   ├── pages/
│   │   ├── Dashboard.tsx         # Overview — Stats, Recent Activities
│   │   ├── Orders.tsx            # Order management, Status updates
│   │   ├── Conversations.tsx     # Chat history, Bot pause/resume, Admin reply
│   │   ├── Products.tsx          # Product listings (price, stock, images)
│   │   ├── AITraining.tsx        # AI instruction management
│   │   └── TeamUsers.tsx         # Team member management
│   │
│   └── lib/
│       └── supabase.ts           # Supabase client initialization
│
├── SUPABASE_SCHEMA.sql           # ⭐ Complete Database Schema
│                                 #    Tables, RLS Policies, Indexes, Triggers
│                                 #    New project setup အတွက် ဒီ file run ရုံပဲ
│
├── vercel.json                   # Vercel configuration
├── package.json                  # Dependencies
└── README.md                     # ဒီ file
```

---

## 🗄 Database Schema

### Tables Overview

| Table | တာဝန် |
|-------|------|
| `profiles` | Dashboard Admin/Owner users |
| `user_roles` | Role definitions (owner/admin/viewer) |
| `team_members` | Dashboard access members |
| `permissions` | Feature-level access control (RBAC) |
| `customers` | Facebook Messenger customers (PSID based) |
| `products` | Water purifier product listings |
| `orders` | Customer orders (Bot က collect လုပ်တာ) |
| `conversations` | Bot/Admin/Customer message history |
| `conversation_context` | Per-customer order flow state |
| `ai_training_config` | Client ထည့်တဲ့ AI instructions |
| `owner_notifications` | Dashboard notification center |
| `processed_messages` | Message deduplication (duplicate prevention) |

### Key Relationships

```
customers (1) ──── (many) conversations
customers (1) ──── (1) conversation_context
customers (1) ──── (many) orders
orders (many) ──── (1) products
profiles (1) ──── (1) permissions
profiles (1) ──── (1) team_members
```

---

## 🔐 Environment Variables

Vercel Dashboard → Settings → Environment Variables မှာ သတ်မှတ်ရမည်

| Variable | ဘာအတွက် | Required |
|----------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Database full access key (RLS bypass) | ✅ |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Facebook Page ကနေ message ပို့ဖို့ | ✅ |
| `FACEBOOK_WEBHOOK_VERIFY_TOKEN` | Webhook verification (custom string) | ✅ |
| `OPENROUTER_API_KEY` | AI (Gemini 2.5 Flash) access | ✅ |
| `OWNER_TELEGRAM_BOT_TOKEN` | Client notification Telegram bot | ✅ |
| `OWNER_TELEGRAM_CHAT_ID` | Client Telegram chat ID | ✅ |
| `TELEGRAM_BOT_TOKEN` | Developer system error notification bot | ✅ |
| `TELEGRAM_CHAT_ID` | Developer Telegram chat ID | ✅ |

> ⚠️ **SUPABASE_SERVICE_ROLE_KEY** က Secret key ဖြစ်တယ် — GitHub ထဲ push မလုပ်ပါနဲ့

---

## ✨ Key Features

### 1. AI-Driven Order Flow
Bot က customer နဲ့ natural conversation လုပ်ရင်း Order information (နာမည်၊ ဖုန်း၊ လိပ်စာ) ကို collect လုပ်တယ်။ 3 ခုစလုံးရမှ Order confirm ဖြစ်ပြီး Database ထဲ save တယ်။

### 2. Smart Bot Pause System
- **Dashboard Pause** — Admin က manually pause/resume လုပ်နိုင်တယ်
- **Auto Pause** — Admin က Messenger ကနေ ဖြေတိုင်း Bot အလိုလို pause ဖြစ်တယ်
- **Auto Resume** — 30 မိနစ်ကြာရင် Bot ပြန် active ဖြစ်တယ်
- **Per-customer** — Customer A pause ဖြစ်နေရင်လည်း Customer B ကို Bot ဆက်ဖြေတယ်

### 3. Message Echo Tracking
Admin က Messenger App ကနေ ဖြေတဲ့ reply တွေကို conversations table ထဲ "admin" type နဲ့ သိမ်းတယ် — Dashboard မှာ full conversation history မြင်ရတယ်။

### 4. AI Training System
Client က Dashboard ထဲမှာ Bot ရဲ့ tone, style, product knowledge တွေကို natural language နဲ့ ညွှန်ကြားနိုင်တယ်။ is_active=true ဖြစ်တဲ့ instructions တွေကိုပဲ Bot က system prompt ထဲ inject လုပ်တယ်။

### 5. Stock Management
Order confirm တိုင်း stock_quantity အလိုလို လျော့ကျတယ်။ Stock မရှိရင် Pre-order flow ကို automatically switch ဖြစ်တယ်။

### 6. Gender Detection
Customer နာမည်ကနေ AI က gender ခန့်မှန်းပြီး "အကို" / "အမ" ဆိုပြီး personalized address လုပ်တယ်။

### 7. Duplicate Message Prevention
Facebook က တစ်ခါတစ်ရံ same message ကို 2 ခါ ပို့တတတ်တယ်။ `processed_messages` table ဖြင့် duplicate တွေကို catch ပြီး 1 ခါပဲ process လုပ်တယ်။

### 8. Telegram Notifications
| Event | ပို့တဲ့နေရာ |
|-------|-----------|
| New Order | Owner Telegram |
| Human Support Needed | Owner Telegram + Dashboard |
| System Error | Developer Telegram |
| Non-text Message | Owner Telegram + Dashboard |

---

## 🐛 Debugging Guide

### Error တွေ ဘယ်မှာ ကြည့်ရမလဲ

**1. Vercel Logs** (Real-time)
```
Vercel Dashboard → Project → Logs → Live
```
Bot ကို message တစ်ခုပို့ပြီး log ထဲမှာ ဘာပြနေလဲ ကြည့်ပါ

**2. Telegram System Errors** (Developer)
```
Bot errors တွေ Telegram ထဲ အလိုလို ရောက်လာမယ်
Format: 🔴 System Error — [error details]
```

**3. Supabase Table Editor**
```
conversations table → Customer ID filter → message history ကြည့်
customers table → bot_paused, paused_at စစ်
```

### Common Issues & Fixes

| ပြဿနာ | ဖြေရှင်းချက် |
|--------|------------|
| Bot မဖြေဘူး | customers table မှာ bot_paused=true လားစစ်ပါ |
| Order save မဖြစ်ဘူး | conversations table မှာ "save_order" action ပါလားစစ်ပါ |
| Telegram notification မလာဘူး | Vercel env vars စစ်ပါ |
| Dashboard data မပြဘူး | Supabase RLS policies စစ်ပါ |
| Echo မအလုပ်မလုပ်ဘူး | Facebook Developer Console → message_echoes subscribed ဖြစ်လားစစ်ပါ |

---

## 📈 Maintenance

### Daily Checks
- Vercel Logs မှာ error ရှိမရှိ စစ်ပါ
- Telegram notification တွေ စစ်ပါ
- Dashboard Orders page မှာ pending orders ကြည့်ပါ

### Weekly Checks
- Supabase → processed_messages table size စစ်ပါ (7 ရက်ကျော်တာတွေ ဖျက်နိုင်တယ်)
- AI Training instructions update လိုမလိုစစ်ပါ
- Product stock quantities update လုပ်ပါ

---

## 🚀 New Client Setup Guide

ဒီ Project ကို Template အဖြစ် Client အသစ်တစ်ယောက်အတွက် copy လုပ်ချင်ရင်

**အဆင့် ၁ — Supabase**
```
1. Supabase Project အသစ် create
2. SUPABASE_SCHEMA.sql ကို SQL Editor မှာ run
3. SUPABASE_URL နဲ့ SUPABASE_SERVICE_ROLE_KEY ယူ
```

**အဆင့် ၂ — Facebook**
```
1. Facebook App အသစ် create
2. Messenger API setup
3. Webhook URL: https://[your-vercel-url]/api/webhook
4. Subscribe: messages, messaging_postbacks, message_echoes
5. PAGE_ACCESS_TOKEN ယူ
```

**အဆင့် ၃ — Telegram**
```
1. @BotFather ကနေ Bot ၂ ခု create (Owner + Developer)
2. Chat IDs ယူ
```

**အဆင့် ၄ — Vercel**
```
1. GitHub repo fork/clone
2. Vercel ကို import
3. Environment Variables အားလုံး set
4. Deploy
```

**အဆင့် ၅ — Lovable Dashboard**
```
1. Lovable project create
2. Supabase connect
3. Client URL customize
```

---

## 👥 Project Info

| | |
|---|---|
| **Client** | Swan Yee Pyae Trading Co., Ltd |
| **Product** | EIREE Water Purifier |
| **Developer** | Ko Ray |
| **Dashboard User** | Aung Myat Theinn |
| **Bot Model** | Google Gemini 2.5 Flash (via OpenRouter) |
| **Last Updated** | 2026-05-14 |

---

*ဒီ README ကို ဖတ်ပြီး Project DNA တစ်ခုလုံး နားလည်သွားပြီဆိုရင် — 🎉*
