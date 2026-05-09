import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Privacy Policy - EIREE Messenger Bot</title>
        <style>
            body { font-family: sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: auto; color: #333; }
            h1 { color: #2c3e50; }
            h2 { color: #34495e; margin-top: 30px; }
            .language-switch { margin-bottom: 20px; font-weight: bold; }
        </style>
    </head>
    <body>
        <h1>Privacy Policy / ကိုယ်ရေးအချက်အလက် ထိန်းသိမ်းမှု မူဝါဒ</h1>
        
        <div class="language-switch">English / မြန်မာ</div>

        <section>
            <h2>English</h2>
            <p>This Privacy Policy describes how the EIREE Messenger Bot collects and uses your information.</p>
            <h3>1. Information Collection</h3>
            <p>We collect messages you send to the bot and your public profile information provided by Facebook (such as your name and PSID) to provide customer service and process orders.</p>
            <h3>2. Use of Information</h3>
            <p>The information is used solely for:</p>
            <ul>
                <li>Responding to your inquiries about our products.</li>
                <li>Processing and managing your orders.</li>
                <li>Improving our customer service.</li>
            </ul>
            <h3>3. Data Sharing</h3>
            <p>We do not share your personal data with third parties, except as necessary to fulfill your orders (e.g., delivery services) or as required by law.</p>
            <h3>4. Data Security</h3>
            <p>We implement reasonable security measures to protect your information from unauthorized access.</p>
        </section>

        <hr>

        <section>
            <h2>မြန်မာဘာသာ</h2>
            <p>ဤမူဝါဒသည် EIREE Messenger Bot မှ သင်၏ အချက်အလက်များကို မည်သို့ စုဆောင်းအသုံးပြုသည်ကို ဖော်ပြပါသည်။</p>
            <h3>၁။ အချက်အလက် စုဆောင်းခြင်း</h3>
            <p>ကျွန်ုပ်တို့သည် လူကြီးမင်းထံမှ ပေးပို့သော မက်ဆေ့ချ်များနှင့် Facebook မှ ပေးထားသော အများပြည်သူသိရှိနိုင်သော အချက်အလက်များ (ဥပမာ - အမည်နှင့် PSID) ကို ဝန်ဆောင်မှုပေးရန်နှင့် အော်ဒါများ လက်ခံဆောင်ရွက်ပေးရန်အတွက် စုဆောင်းပါသည်။</p>
            <h3>၂။ အချက်အလက် အသုံးပြုခြင်း</h3>
            <p>စုဆောင်းရရှိသော အချက်အလက်များကို အောက်ပါကိစ္စရပ်များအတွက်သာ အသုံးပြုပါသည် -</p>
            <ul>
                <li>လူကြီးမင်း၏ မေးမြန်းချက်များကို ပြန်လည်ဖြေကြားရန်။</li>
                <li>အော်ဒါများကို လက်ခံဆောင်ရွက်ပေးရန်။</li>
                <li>ကျွန်ုပ်တို့၏ ဝန်ဆောင်မှုများကို ပိုမိုကောင်းမွန်အောင် ပြုလုပ်ရန်။</li>
            </ul>
            <h3>၃။ အချက်အလက် မျှဝေခြင်း</h3>
            <p>လူကြီးမင်း၏ ကိုယ်ရေးအချက်အလက်များကို ပြင်ပအဖွဲ့အစည်းများထံ မျှဝေခြင်း မပြုပါ။ (အော်ဒါပို့ဆောင်ရေး ဝန်ဆောင်မှုများကဲ့သို့ မဖြစ်မနေ လိုအပ်သော ကိစ္စရပ်များမှလွဲ၍)</p>
            <h3>၄။ အချက်အလက် လုံခြုံရေး</h3>
            <p>ကျွန်ုပ်တို့သည် လူကြီးမင်း၏ အချက်အလက်များကို ခွင့်ပြုချက်မရှိဘဲ ဝင်ရောက်ကြည့်ရှုခြင်းမှ ကာကွယ်ရန် လုံခြုံရေး အစီအမံများကို ကျင့်သုံးပါသည်။</p>
        </section>

        <footer>
            <p>&copy; ${new Date().getFullYear()} EIREE Water Purifiers. All rights reserved.</p>
        </footer>
    </body>
    </html>
  `;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
