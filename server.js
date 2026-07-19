// DesiCart OTP backend — sends and verifies real one-time codes.
// Phone numbers go through Twilio Verify (real SMS). Email addresses
// go through Resend, an email API that sends over normal HTTPS — unlike
// raw SMTP, this isn't blocked by hosts like Render's free tier that
// restrict outbound SMTP ports.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const twilio = require("twilio");

const app = express();
app.use(cors());
app.use(app.use(express.json({ limit: "8mb" }));express.json());

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
  RESEND_API_KEY,
  PORT = 3000,
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
  console.warn("Warning: Twilio environment variables are missing.");
}
if (!RESEND_API_KEY) {
  console.warn("Warning: RESEND_API_KEY is missing.");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

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

app.get("/", (req, res) => res.send("DesiCart OTP backend is running."));

let orders = [];
let orderIdCounter = 1000;
const dasherRegistry = {};

app.get("/orders", (req, res) => {
  res.json({ orders });
});

app.post("/orders", (req, res) => {
  const { custName, custPhone, custEmail, storeId, address, items, subtotal, deliveryFee, tip, total } = req.body;
  if (!custName || !storeId || !items || !items.length) {
    return res.status(400).json({ error: "custName, storeId, and items are required" });
  }
  orderIdCounter += 1;
  const order = {
    id: orderIdCounter,
    custName,
    custPhone: custPhone || null,
    custEmail: custEmail || null,
    storeId,
    address: address || null,
    items,
    subtotal: subtotal || 0,
    deliveryFee: deliveryFee || 0,
    tip: tip || 0,
    total: total || 0,
    status: "placed",
    placedAt: Date.now(),
    dasherName: null,
    dasherPhone: null,
    dasherPhoto: null,
    dasherVehicle: null,
  };
  orders.push(order);
  res.status(201).json({ order });
});

app.post("/orders/:id/accept", (req, res) => {
  const id = Number(req.params.id);
  const { dasherName, dasherPhone, dasherPhoto, dasherVehicle } = req.body;
  const order = orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "placed") return res.status(409).json({ error: "Order already accepted" });

  order.status = "assigned";
  order.dasherName = dasherName;
  order.dasherPhone = dasherPhone || null;
  order.dasherPhoto = dasherPhoto || null;
  order.dasherVehicle = dasherVehicle || null;
  res.json({ order });
});

app.post("/orders/:id/advance", (req, res) => {
  const id = Number(req.params.id);
  const order = orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const next = { assigned: "picked_up", picked_up: "on_the_way", on_the_way: "delivered" }[order.status];
  if (!next) return res.status(409).json({ error: `Cannot advance an order that is ${order.status}` });

  order.status = next;
  res.json({ order });
});

app.get("/dashers", (req, res) => {
  res.json({ dashers: Object.values(dasherRegistry) });
});

app.post("/dashers", (req, res) => {
  const { name, phone, email, vehicleMake, vehiclePlate, licenseNumber, photoUri } = req.body;
  if (!name || !phone || !email) {
    return res.status(400).json({ error: "name, phone, and email are required" });
  }

  const emailLower = email.trim().toLowerCase();
  const licenseUpper = (licenseNumber || "").trim().toUpperCase();
  for (const [existingPhone, d] of Object.entries(dasherRegistry)) {
    if (existingPhone === phone) continue;
    if (d.email && d.email.trim().toLowerCase() === emailLower) {
      return res.status(409).json({ error: "email", message: "This email is already registered to another dasher account." });
    }
    if (licenseUpper && d.licenseNumber && d.licenseNumber.trim().toUpperCase() === licenseUpper) {
      return res.status(409).json({ error: "license", message: "This license number is already registered to another dasher account." });
    }
  }

  const profile = { name, phone, email, vehicleMake, vehiclePlate, licenseNumber, photoUri: photoUri || null };
  dasherRegistry[phone] = profile;
  res.status(201).json({ dasher: profile });
});

app.listen(PORT, () => console.log(`DesiCart OTP backend listening on port ${PORT}`));
