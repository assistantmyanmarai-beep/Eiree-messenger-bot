-- ═══════════════════════════════════════════════════════════════
-- EIREE Myanmar — Complete Supabase Schema
-- Last Updated: 2026-05-14
-- Project: EIREE Water Purifier — Messenger Bot + Admin Dashboard
-- ═══════════════════════════════════════════════════════════════
-- 
-- အသုံးပြုနည်း:
-- Supabase Dashboard → SQL Editor မှာ ဒီ file တစ်ခုလုံး paste လုပ်ပြီး Run နှိပ်ပါ
-- Tables တွေ၊ RLS Policies တွေ၊ Triggers တွေ အကုန် အလိုလို create ဖြစ်သွားမယ်
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ═══════════════════════════════════════════════════════════════
-- TABLE 1: profiles
-- Dashboard သုံးတဲ့ Admin/Owner users တွေရဲ့ profile
-- auth.users နဲ့ ချိတ်ဆက်ထားတယ် (Supabase Auth)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'viewer',         -- 'owner' | 'admin' | 'viewer'
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- New user register တိုင်း profile အလိုလို create ဖြစ်အောင် trigger
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ═══════════════════════════════════════════════════════════════
-- TABLE 2: user_roles
-- Role definitions — owner, admin, viewer
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_name TEXT UNIQUE NOT NULL,     -- 'owner' | 'admin' | 'viewer'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO user_roles (role_name, description) VALUES
  ('owner', 'Full access — Ko Ray (Developer/Owner)'),
  ('admin', 'Dashboard access — Client (Aung Myat Theinn)'),
  ('viewer', 'Read-only access')
ON CONFLICT (role_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
-- TABLE 3: team_members
-- Dashboard ကို access လုပ်ခွင့်ရှိသော team members
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS team_members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 4: permissions
-- Role-Based Access Control (RBAC)
-- Dashboard features တစ်ခုချင်းစီ ကို ဘယ် role က access ရမလဲ
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  can_manage_products BOOLEAN DEFAULT FALSE,
  can_manage_orders BOOLEAN DEFAULT FALSE,
  can_view_conversations BOOLEAN DEFAULT FALSE,
  can_reply_customers BOOLEAN DEFAULT FALSE,
  can_train_ai BOOLEAN DEFAULT FALSE,
  can_manage_team BOOLEAN DEFAULT FALSE,
  can_pause_bot BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 5: customers
-- Facebook Messenger ကနေ Bot နဲ့ စကားပြောတဲ့ customers
-- PSID = Facebook Page-Scoped ID (unique per customer per page)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  psid TEXT UNIQUE NOT NULL,          -- Facebook Page-Scoped ID
  display_name TEXT,                  -- Admin ကနေ manually rename လုပ်ထားတဲ့ နာမည်
  messenger_name TEXT,                -- Facebook profile name (API ကနေ ယူတာ)
  first_name TEXT,
  last_name TEXT,
  profile_pic_url TEXT,               -- Facebook profile photo URL
  gender_salutation TEXT,             -- 'အကို' | 'အမ' | '' (AI detect လုပ်တာ)
  delivery_address TEXT,              -- နောက်ဆုံး order မှာ သုံးခဲ့တဲ့ လိပ်စာ
  bot_paused BOOLEAN DEFAULT FALSE,   -- TRUE = Bot ရပ်ထားတယ် (Admin mode)
  paused_at TIMESTAMPTZ DEFAULT NULL, -- Pause စတဲ့ အချိန် (30min auto-resume အတွက်)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 6: products
-- EIREE Water Purifier products တွေ
-- Dashboard ကနေ Admin က manage လုပ်နိုင်တယ်
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,                 -- Product နာမည်
  price_mmk NUMERIC NOT NULL,         -- ဈေးနှုန်း (Myanmar Kyat)
  stock_quantity INTEGER DEFAULT 0,   -- Stock အရေအတွက်
  description TEXT,                   -- Product ဖော်ပြချက်
  image_url TEXT,                     -- Product ဓာတ်ပုံ URL (Supabase Storage)
  video_url TEXT,                     -- Product video URL (optional)
  filter_precision TEXT,              -- စစ်ကြိုးအတိမ်အနက် (ဥပမာ 0.01μm)
  flow_rate TEXT,                     -- ရေစီးနှုန်း
  filter_stages TEXT,                 -- Filter အဆင့်အရေအတွက်
  installation_type TEXT,             -- Wall mounted / Under Sink
  is_active BOOLEAN DEFAULT TRUE,     -- FALSE = Dashboard မှာ မပြတော့ဘူး
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 7: orders
-- Customer တွေရဲ့ Order records
-- Bot က AI ဖြင့် collect လုပ်ပြီး save သွားတာ
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,            -- Customer အမည် (Bot က collect လုပ်တာ)
  phone_number TEXT NOT NULL,         -- ဖုန်းနံပါတ်
  delivery_address TEXT NOT NULL,     -- ပို့ဆောင်မည့် လိပ်စာ
  quantity INTEGER DEFAULT 1,
  total_price_mmk NUMERIC,
  status TEXT DEFAULT 'pending',      -- 'pending' | 'confirmed' | 'delivered' | 'cancelled' | 'preorder'
  notes TEXT,                         -- Admin မှတ်ချက်
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 8: conversations
-- Bot နဲ့ Customer ကြားရှိ message history တစ်ခုလုံး
-- message_type: 'customer' | 'bot' | 'admin'
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,         -- 'customer' | 'bot' | 'admin'
  message_text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',        -- Extra info (source: 'messenger_echo' စသည်)
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 9: conversation_context
-- Customer တစ်ယောက်ချင်းစီရဲ့ Order flow state
-- Bot က Order ကောက်နေချိန် context မပျောက်အောင် သိမ်းတာ
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversation_context (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  preferences JSONB DEFAULT '{}',
  -- preferences ထဲမှာ ပါတဲ့ fields:
  -- {
  --   "address": "အကို/အမ",           ← gender salutation
  --   "collecting_order": false,       ← Order ကောက်နေဆဲလား
  --   "pending_product": "product name",
  --   "pending_product_id": 1,
  --   "is_preorder": false,
  --   "has_active_order": false
  -- }
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 10: ai_training_config
-- Dashboard ကနေ Client ထည့်တဲ့ AI instructions
-- is_active=true တွေကိုပဲ Bot က system prompt ထဲ inject လုပ်မယ်
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_training_config (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_prompt TEXT,                 -- Instruction category/title
  prompt_content TEXT,                -- Instruction အသေးစိတ်
  content TEXT,                       -- Dashboard မှာ save လုပ်တဲ့ main content
  is_active BOOLEAN DEFAULT TRUE,     -- FALSE = Bot က ignore လုပ်မယ်
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 11: owner_notifications
-- Dashboard notification center
-- Bot က အရေးကြီးတဲ့ events တွေဖြစ်တိုင်း ဒီမှာ record သိမ်းမယ်
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS owner_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_type TEXT NOT NULL,    -- 'new_order' | 'human_support_needed' | 'non_text_message'
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- TABLE 12: processed_messages
-- Message deduplication — Facebook က တစ်ခါတစ်ရံ same message ၂ ခါ ပို့တယ်
-- ဒီ table မှာ processed message IDs သိမ်းထားပြီး duplicate ကာကွယ်တယ်
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS processed_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id TEXT UNIQUE NOT NULL,    -- Facebook message mid
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7 ရက်ကျော်တဲ့ processed messages တွေ အလိုလို ဖျက်မယ် (storage ချွေတာဖို့)
CREATE INDEX IF NOT EXISTS idx_processed_messages_created 
  ON processed_messages(created_at);


-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Dashboard users တွေ data ကို secure ဖြစ်အောင် ကာကွယ်တယ်
-- webhook.ts က service_role key သုံးတာကြောင့် RLS bypass ဖြစ်တယ်
-- ═══════════════════════════════════════════════════════════════

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read customers" ON customers;
CREATE POLICY "Allow authenticated read customers" ON customers
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow authenticated update customers" ON customers;
CREATE POLICY "Allow authenticated update customers" ON customers
  FOR UPDATE TO authenticated USING (true);

-- products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all products" ON products;
CREATE POLICY "Allow authenticated all products" ON products
  FOR ALL TO authenticated USING (true);

-- orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all orders" ON orders;
CREATE POLICY "Allow authenticated all orders" ON orders
  FOR ALL TO authenticated USING (true);

-- conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all conversations" ON conversations;
CREATE POLICY "Allow authenticated all conversations" ON conversations
  FOR ALL TO authenticated USING (true);

-- conversation_context
ALTER TABLE conversation_context ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all conversation_context" ON conversation_context;
CREATE POLICY "Allow authenticated all conversation_context" ON conversation_context
  FOR ALL TO authenticated USING (true);

-- ai_training_config
ALTER TABLE ai_training_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all ai_training_config" ON ai_training_config;
CREATE POLICY "Allow authenticated all ai_training_config" ON ai_training_config
  FOR ALL TO authenticated USING (true);

-- owner_notifications
ALTER TABLE owner_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all owner_notifications" ON owner_notifications;
CREATE POLICY "Allow authenticated all owner_notifications" ON owner_notifications
  FOR ALL TO authenticated USING (true);

-- permissions
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all permissions" ON permissions;
CREATE POLICY "Allow authenticated all permissions" ON permissions
  FOR ALL TO authenticated USING (true);

-- team_members
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated all team_members" ON team_members;
CREATE POLICY "Allow authenticated all team_members" ON team_members
  FOR ALL TO authenticated USING (true);

-- processed_messages (service role only — no RLS needed)
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;

-- user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read user_roles" ON user_roles;
CREATE POLICY "Allow authenticated read user_roles" ON user_roles
  FOR SELECT TO authenticated USING (true);


-- ═══════════════════════════════════════════════════════════════
-- INDEXES (Performance အတွက်)
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_customers_psid ON customers(psid);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_owner_notifications_is_read ON owner_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_ai_training_config_is_active ON ai_training_config(is_active);

-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════
