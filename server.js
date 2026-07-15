// DesiCart OTP backend — sends and verifies real one-time codes.
// Phone numbers go through Twilio Verify (real SMS). Email addresses
// go through your own Gmail account via SMTP.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const twilio = require("twilio");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  PORT = 3000,
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
  console.warn(
    "Warning: Twilio environment variables are missing — phone (SMS) codes won't work until .env is filled in."
  );
}
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.warn(
    "Warning: Gmail environment variables are missing — email codes won't work until .env is filled in."
  );
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const mailer = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  family: 4,
  connectionTimeout: 15000,
});

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
  await mailer.sendMail({
    from: `DesiCart <${GMAIL_USER}>`,
    to: email,
    subject: "Your DesiCart verification code",
    text: `Your DesiCart verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your DesiCart verification code is:</p><h2 style="letter-spacing:4px;">${code}</h2><p>It expires in 10 minutes.</p>`,
  });
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

app.listen(PORT, () => console.log(`DesiCart OTP backend listening on port ${PORT}`));
