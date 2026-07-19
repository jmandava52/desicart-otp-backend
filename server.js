require("dotenv").config();
const express = require("express");
const cors = require("cors");
const twilio = require("twilio");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
  RESEND_API_KEY,
  DATABASE_URL,
  PORT = 3000,
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
  console.warn("Warning: Twilio environment variables are missing.");
}
if (!RESEND_API_KEY) {
  console.warn("Warning: RESEND_API_KEY is missing.");
}
if (!DATABASE_URL) {
  console.warn("Warning: DATABASE_URL is missing — orders and dasher accounts won't work until .env is filled in.");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function ensureSchema() {
  if (!DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      cust_name TEXT NOT NULL,
      cust_phone TEXT,
      cust_email TEXT,
      store_id TEXT NOT NULL,
      address JSONB,
      items JSONB NOT NULL,
      subtotal NUMERIC DEFAULT 0,
      delivery_fee NUMERIC DEFAULT 0,
      tip NUMERIC DEFAULT 0,
      total NUMERIC DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'placed',
      placed_at BIGINT NOT NULL,
      dasher_name TEXT,
      dasher_phone TEXT,
      dasher_photo TEXT,
      dasher_vehicle TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashers (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      vehicle_make TEXT,
      vehicle_plate TEXT,
      license_number TEXT,
      photo_uri TEXT
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS dashers_email_unique ON dashers (LOWER(email));
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS dashers_license_unique ON dashers (LOWER(license_number))
    WHERE license_number IS NOT NULL AND license_number <> '';
  `);
}

function mapOrderRow(row) {
  return {
    id: row.id,
    custName: row.cust_name,
    custPhone: row.cust_phone,
    custEmail: row.cust_email,
    storeId: row.store_id,
    address: row.address,
    items: row.items,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    tip: Number(row.tip),
    total: Number(row.total),
    status: row.status,
    placedAt: Number(row.placed_at),
    dasherName: row.dasher_name,
    dasherPhone: row.dasher_phone,
    dasherPhoto: row.dasher_photo,
    dasherVehicle: row.dasher_vehicle,
  };
}

function mapDasherRow(row) {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    vehicleMake: row.vehicle_make,
    vehiclePlate: row.vehicle_plate,
    licenseNumber: row.license_number,
    photoUri: row.photo_uri,
  };
}

function toE164(phone) {
  const digits = phone.replace(/[^0-9]/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

const emailCodes = new Map();
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmailCode(email) {
  const code = generateCode();
  emailCodes.set(email, { code, expiresAt: Date.now() + EMAIL_CODE_TTL_MS });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "DesiCart <otp@agriitsolutions.org>",
      to: [email],
      subject: "Your DesiCart verification code",
      html: `<p>Your DesiCart verification code is:</p><h2 style="letter-spacing:4px;">${code}</h2><p>It expires in 10 minutes.</p>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend error (${res.status}): ${detail}`);
  }
}

function checkEmailCode(email, code) {
  const entry = emailCodes.get(email);
  if (!entry) return false;
  const valid = entry.code === code && Date.now() < entry.expiresAt;
  if (valid) emailCodes.delete(email);
  return valid;
}

app.post("/send-otp", async (req, res) => {
  try {
    const { phone, email } = req.body;
    if (phone) {
      const verification = await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({ to: toE164(phone), channel: "sms" });
      return res.json({ status: verification.status, channel: "sms" });
    }
    if (email) {
      await sendEmailCode(email.trim());
      return res.json({ status: "pending", channel: "email" });
    }
    res.status(400).json({ error: "A phone number or email is required" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to send code" });
  }
});

app.post("/verify-otp", async (req, res) => {
  try {
    const { phone, email, code } = req.body;
    if (!code) return res.status(400).json({ error: "A code is required" });

    if (phone) {
      const check = await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: toE164(phone), code });
      return res.json({ approved: check.status === "approved", status: check.status });
    }
    if (email) {
      const approved = checkEmailCode(email.trim(), code);
      return res.json({ approved, status: approved ? "approved" : "rejected" });
    }
    res.status(400).json({ error: "A phone number or email is required" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to verify code" });
  }
});

app.get("/", (req, res) => res.send("DesiCart backend is running."));

app.get("/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY id ASC");
    res.json({ orders: result.rows.map(mapOrderRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load orders" });
  }
});

app.post("/orders", async (req, res) => {
  try {
    const { custName, custPhone, custEmail, storeId, address, items, subtotal, deliveryFee, tip, total } = req.body;
    if (!custName || !storeId || !items || !items.length) {
      return res.status(400).json({ error: "custName, storeId, and items are required" });
    }
    const result = await pool.query(
      `INSERT INTO orders
        (cust_name, cust_phone, cust_email, store_id, address, items, subtotal, delivery_fee, tip, total, status, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'placed',$11)
       RETURNING *`,
      [
        custName,
        custPhone || null,
        custEmail || null,
        storeId,
        address ? JSON.stringify(address) : null,
        JSON.stringify(items),
        subtotal || 0,
        deliveryFee || 0,
        tip || 0,
        total || 0,
        Date.now(),
      ]
    );
    res.status(201).json({ order: mapOrderRow(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});

app.post("/orders/:id/accept", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { dasherName, dasherPhone, dasherPhoto, dasherVehicle } = req.body;

    const result = await pool.query(
      `UPDATE orders SET status='assigned', dasher_name=$1, dasher_phone=$2, dasher_photo=$3, dasher_vehicle=$4
       WHERE id=$5 AND status='placed'
       RETURNING *`,
      [dasherName, dasherPhone || null, dasherPhoto || null, dasherVehicle || null, id]
    );

    if (result.rows.length) {
      return res.json({ order: mapOrderRow(result.rows[0]) });
    }

    const existing = await pool.query("SELECT id, status FROM orders WHERE id=$1", [id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Order not found" });
    return res.status(409).json({ error: "Order already accepted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not accept order" });
  }
});

app.post("/orders/:id/advance", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await pool.query("SELECT status FROM orders WHERE id=$1", [id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Order not found" });

    const current = existing.rows[0].status;
    const next = { assigned: "picked_up", picked_up: "on_the_way", on_the_way: "delivered" }[current];
    if (!next) return res.status(409).json({ error: `Cannot advance an order that is ${current}` });

    const result = await pool.query(
      "UPDATE orders SET status=$1 WHERE id=$2 AND status=$3 RETURNING *",
      [next, id, current]
    );
    if (!result.rows.length) return res.status(409).json({ error: "Order status changed, please refresh" });
    res.json({ order: mapOrderRow(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update order" });
  }
});

app.get("/dashers", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM dashers ORDER BY phone ASC");
    res.json({ dashers: result.rows.map(mapDasherRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load dashers" });
  }
});

app.post("/dashers", async (req, res) => {
  try {
    const { name, phone, email, vehicleMake, vehiclePlate, licenseNumber, photoUri } = req.body;
    if (!name || !phone || !email) {
      return res.status(400).json({ error: "name, phone, and email are required" });
    }

    const result = await pool.query(
      `INSERT INTO dashers (phone, name, email, vehicle_make, vehicle_plate, license_number, photo_uri)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (phone) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         vehicle_make = EXCLUDED.vehicle_make,
         vehicle_plate = EXCLUDED.vehicle_plate,
         license_number = EXCLUDED.license_number,
         photo_uri = EXCLUDED.photo_uri
       RETURNING *`,
      [phone, name, email, vehicleMake || null, vehiclePlate || null, licenseNumber || null, photoUri || null]
    );
    res.status(201).json({ dasher: mapDasherRow(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      const constraint = err.constraint || "";
      if (constraint.includes("email")) {
        return res.status(409).json({ error: "email", message: "This email is already registered to another dasher account." });
      }
      if (constraint.includes("license")) {
        return res.status(409).json({ error: "license", message: "This license number is already registered to another dasher account." });
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not save dasher profile" });
  }
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`DesiCart backend listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to set up database tables:", err.message);
    app.listen(PORT, () => console.log(`DesiCart backend listening on port ${PORT} (database setup failed)`));
  });
