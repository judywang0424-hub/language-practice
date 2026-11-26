English Practice — static build (no server needed).
Upload everything in this folder to any HTTPS static host (GitHub Pages / Netlify / Cloudflare Pages).
Open index.html over HTTPS in Chrome on Android; allow the microphone when asked.
Analysis uses the built-in offline rule engine (engine/analyzer.js). Progress and weekly recaps stay in the phone browser.
💬 对话 uses the built-in reply library (dialogue.js) unless an AI key is saved in 对话 → AI 设置 (stored only in that phone's localStorage).
Rebuild from the project with: scripts/build_static.sh
