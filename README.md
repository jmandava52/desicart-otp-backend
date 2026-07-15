# DesiCart OTP Backend

A tiny server that sends and verifies real one-time codes for the
DesiCart app — SMS via Twilio, email via your own Gmail account.

## Why you need this

Phones and apps can't send SMS or email directly — only a server with
provider credentials can. This backend is that server: two small
endpoints, `/send-otp` and `/verify-otp`, that route to Twilio (phone)
or Gmail (email) depending on which one you send.

## Cost

- **SMS (Twilio):** free trial credit when you sign up, then about
  **$0.05 per verification**. No monthly fee.
- **Email (Gmail):** completely free — it's your existing Gmail account.
- **Hosting this server:** free on Render.com's free tier.

You can set up just one of these (phone or email) or both — whichever
you configure in `.env` is what becomes available.

## 1. Set up SMS via Twilio (optional, skip if you only want email)

1. Go to https://www.twilio.com/try-twilio and sign up.
2. In the Twilio Console, go to **Verify → Services** and click **Create new Service**.
   Name it anything (e.g. "DesiCart").
3. Copy the **Service SID** (starts with `VA...`).
4. From the Console dashboard, copy your **Account SID** and **Auth Token**.

## 2. Set up email via Gmail (optional, skip if you only want SMS)

1. Turn on **2-Step Verification** on the Gmail account you want to send
   from: go to https://myaccount.google.com/security and turn it on.
2. Create an **App Password**: go to https://myaccount.google.com/apppasswords,
   name it something like "DesiCart OTP," and click Create.
3. Copy the 16-character password Google shows you (spaces don't matter,
   you can keep or remove them).

## 3. Configure this project

```
cd desicart-otp-backend
cp .env.example .env
```

Open `.env` and fill in whichever section(s) you set up above —
the Twilio values, the Gmail values, or both.

## 4. Run it locally to test

```
npm install
npm start
```

You should see `DesiCart OTP backend listening on port 3000`.

**Test SMS** (replace with your real phone number):
```
curl -X POST http://localhost:3000/send-otp -H "Content-Type: application/json" -d '{"phone":"6165551234"}'
```
You should receive a real text message. Then check it:
```
curl -X POST http://localhost:3000/verify-otp -H "Content-Type: application/json" -d '{"phone":"6165551234","code":"123456"}'
```
(replace `123456` with the code you actually received)

**Test email** (replace with a real email address you can check):
```
curl -X POST http://localhost:3000/send-otp -H "Content-Type: application/json" -d '{"email":"you@example.com"}'
```
Check your inbox (and spam folder, the first few times) for the code, then:
```
curl -X POST http://localhost:3000/verify-otp -H "Content-Type: application/json" -d '{"email":"you@example.com","code":"123456"}'
```

## 5. Deploy it so your phone can reach it

Your phone can't reach `localhost` on your computer, so deploy this
somewhere public. **Render.com** has a free tier that works well:

1. Push this folder to a GitHub repo.
2. On Render.com, click **New → Web Service**, connect the repo.
3. Set the **Build Command** to `npm install` and **Start Command** to `npm start`.
4. Under **Environment**, add the same variables from your `.env` file.
5. Deploy. Render gives you a URL like `https://desicart-otp-backend.onrender.com`.

(Render's free tier sleeps after inactivity and takes ~30 seconds to
wake up on the first request — fine for testing, worth upgrading before
real customers depend on it.)

## 6. Connect the app to this backend

In the DesiCart app project, open `src/config.js` and set:
```js
export const API_BASE_URL = "https://your-actual-render-url.onrender.com";
export const OTP_DEMO_MODE = false;
```

Rebuild/reload the app — OTP screens will now send and check real codes.

## A note on scale

The email codes are currently stored in the server's memory, which
resets on restart and doesn't work across multiple server instances.
That's completely fine for getting started and for moderate traffic —
if DesiCart grows to the point of running multiple server instances
behind a load balancer, move that storage into Redis or a database
table instead.
