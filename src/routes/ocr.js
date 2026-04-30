const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { sendServerError } = require('../utils/responses');
const { geminiApiKey } = require('../config/env');

const router = express.Router();

router.post('/ocr-weight', requireLogin, async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: 'ไม่มีรูปภาพ' });
    }

    if (!geminiApiKey) {
      return res.status(500).json({ error: 'ไม่ได้ตั้งค่า GEMINI_API_KEY' });
    }

    const prompt = `Look at this weighing scale display image. Read the numeric weight value shown on the screen.\nReply with ONLY the number, for example: 12.5 or 150 or 3.20\nDo NOT add units, text, or explanation. If you cannot read the number clearly, reply: null`;

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 32 },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiApiKey}`;

    const gRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!gRes.ok) {
      const detail = await gRes.text();
      console.error('Gemini error:', detail);
      return res.status(502).json({ error: 'Gemini API error', detail });
    }

    const gData = await gRes.json();
    const rawText = gData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'null';
    const match = rawText.match(/\d+\.?\d*/);
    const weight = match ? parseFloat(match[0]) : null;

    return res.json({ weight, raw: rawText });
  } catch (err) {
    return sendServerError(res, err);
  }
});

module.exports = router;
