-- Eiree Messenger Bot - Supabase Schema
-- This schema defines all tables needed for the Facebook Messenger AI Sales Agent bot

-- 1. Customers table - stores Facebook PSID and customer info
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  psid VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone_number VARCHAR(20),
  email VARCHAR(255),
  delivery_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_customers_psid ON customers(psid);

-- 2. Products table - stores Eiree water purifier products
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price_mmk DECIMAL(10, 2) NOT NULL,
  type VARCHAR(100),
  housing_material VARCHAR(100),
  filter_precision VARCHAR(50),
  flow_rate VARCHAR(100),
  filter_stages VARCHAR(255),
  installation_type VARCHAR(100),
  image_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_is_active ON products(is_active);

-- 3. Conversations table - stores conversation history per customer
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  message_type VARCHAR(50) NOT NULL, -- 'customer' or 'bot'
  message_text TEXT NOT NULL,
  metadata JSONB, -- Store additional info like product_mentioned, intent, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversations_customer_id ON conversations(customer_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);

-- 4. Orders table - stores customer orders
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  delivery_address TEXT NOT NULL,
  quantity INT DEFAULT 1,
  total_price_mmk DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'processing', 'delivered', 'cancelled'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_product_id ON orders(product_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- 5. Owner notifications log - tracks notifications sent to owner
CREATE TABLE IF NOT EXISTS owner_notifications (
  id BIGSERIAL PRIMARY KEY,
  notification_type VARCHAR(50) NOT NULL, -- 'purchase_interest', 'order_placed', 'customer_inquiry'
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_owner_notifications_sent_at ON owner_notifications(sent_at);
CREATE INDEX idx_owner_notifications_read_at ON owner_notifications(read_at);

-- 6. Conversation context table - stores AI context for better memory
CREATE TABLE IF NOT EXISTS conversation_context (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  products_mentioned JSONB, -- Array of product SKUs mentioned
  purchase_intent_level VARCHAR(50), -- 'none', 'low', 'medium', 'high'
  objections_raised JSONB, -- Array of objections mentioned
  preferences JSONB, -- Customer preferences and interests
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversation_context_customer_id ON conversation_context(customer_id);

-- Insert the 4 Eiree products
INSERT INTO products (sku, name, description, price_mmk, type, housing_material, filter_precision, flow_rate, filter_stages, installation_type, is_active)
VALUES
  (
    'YL-UF-H502-90L',
    '5 Stage UF Drinking Water Purifier (SS304)',
    'Premium kitchen under-sink water purifier with 304 Stainless Steel housing. Features 5-stage filtration: PP Filter, Carbon Filter, Resin Unit, UF Membrane, Post Carbon. Perfect for drinking water with 0.01μm filter precision.',
    610000,
    '5 Stage UF Drinking Water Purifier',
    '304 Stainless Steel',
    '0.01μm',
    '≤90L/H',
    '5 stages: PP-CTO-Resin-UF-T33',
    'Wall mounted/Under Sink',
    TRUE
  ),
  (
    'YLUF3+3',
    '6 Stage UF Drinking Water Purifier (ABS)',
    'Advanced kitchen under-sink water purifier with ABS housing. Features 6-stage filtration with dual PP filters for superior purification. 0.01μm filter precision ensures 100% bacteria filtration.',
    450000,
    '6 Stage UF Drinking Water Purifier',
    'ABS',
    '0.01μm',
    '≤90L/H',
    '6 stages: 2*PP+UDF+CTO+UF+T33',
    'Wall mounted/Under Sink',
    TRUE
  ),
  (
    'YL-UF-159-PVDF-2000L',
    'Whole House UF Water Filter (PVDF)',
    'Whole-house water filtration system with washable PVDF membranes. Handles high flow rates for entire home water needs. 304 Stainless Steel construction with 0.01μm filter precision.',
    430000,
    'Whole House UF Water Filter',
    '304 Stainless Steel',
    '0.01μm',
    '≤1000-20000L/H',
    'PVDF membrane with washable design',
    'Wall mounted/Under Sink',
    TRUE
  ),
  (
    'Transparent-UF-500L',
    'Shower/Washing/Toilet Transparent UF Filter',
    'Transparent fiberglass housing for shower, washing, and toilet water filtration. Washable PVDF membranes for long-lasting use. Monitor water quality visually through transparent housing.',
    220000,
    'Shower/Washing/Toilet Filter',
    'Transparent Fibre Glass',
    '0.01μm',
    '500L/H',
    'PVDF membrane with thread design',
    'Wall mounted/Under Sink',
    TRUE
  );

-- Add RLS (Row Level Security) policies if needed
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_context ENABLE ROW LEVEL SECURITY;
