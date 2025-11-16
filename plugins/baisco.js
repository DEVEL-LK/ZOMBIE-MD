const axios = require("axios");
const NodeCache = require("node-cache");
const { cmd } = require("../command"); // ඔබගේ බොට් framework එකේ command ක්‍රියාකාරීත්වය උපකල්පනය කර ඇත.

// Baiscopes API Settings (ඔබ ලබා දුන් දත්ත)
const API_KEY = "c56182a993f60b4f49cf97ab09886d17"; // ඔබගේ සත්‍ය API යතුර
const SEARCH_BASE = "https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes/search";
const INFODL_BASE = "https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes/infodl";

module.exports = (conn) => {
  // Cache for storing search results
  const cache = new NodeCache({ stdTTL: 180 });
  // Map to store user's current interaction state (from JID -> {state})
  const waitReply = new Map();

  // ─────── SEARCH COMMAND ──────────────────────────────────────────────
  cmd({
    pattern: "baiscopes",
    desc: "Baiscopes Movies / TV සෙවීම",
    react: "🍿",
    category: "Movie",
    filename: __filename
  }, async (client, quoted, msg, { from, q }) => {

    if (!q) return client.sendMessage(from, { text: "භාවිතය: .baiscopes <චිත්‍රපට නම>" }, { quoted: msg });

    try {
      const key = "baiscopes_" + q.toLowerCase();
      let data = cache.get(key);

      if (!data) {
        // API Call for Search (Baiscopes Search Endpoint)
        const r = await axios.get(`${SEARCH_BASE}?apiKey=${API_KEY}&q=${encodeURIComponent(q)}`, { timeout: 120000 });
        
        // API ප්‍රතිඵලයේ "data" array එක පරීක්ෂා කිරීම
        if (!r.data?.data?.length) throw new Error("❌ චිත්‍රපට කිසිවක් සොයා ගැනීමට නොහැක. වෙනත් නමක් උත්සාහ කරන්න.");

        data = r.data.data;
        cache.set(key, data);
      }

      let caption = `*🍿 Baiscopes සෙවුම් ප්‍රතිඵල*\n\n`;
      data.slice(0, 10).forEach((m, i) => { // Top 10 results only
        caption += `${i + 1}. *${m.title}* (${m.year}) ⭐ ${m.rating}\n\n`;
      });
      caption += `තොරතුරු ලබා ගැනීමට ඉහත ලැයිස්තුවෙන් අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

      // Send the search results message, using the first result's imageUrl
      const sent = await client.sendMessage(from, {
        image: { url: data[0].imageUrl || 'https://via.placeholder.com/300x450?text=Baiscopes+Movie' }, // Added a fallback image
        caption
      }, { quoted: msg });

      // Store the interaction state
      waitReply.set(from, {
        step: "select_movie",
        list: data.slice(0, 10), // Store top 10 for selection
        msgId: sent.key.id
      });

    } catch (e) {
      return client.sendMessage(from, { text: "❌ සෙවුම් දෝෂය: " + e.message }, { quoted: msg });
    }
  });


  // ─────── GLOBAL REPLY DETECTOR ───────────────────────────────────────
  conn.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const contextInfo = m.message?.extendedTextMessage?.contextInfo;
    const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

    const selected = waitReply.get(from);
    if (!selected) return;

    // Check if the message is a reply to the correct message ID
    const isReply = contextInfo?.stanzaId === selected.msgId;

    if (!isReply) return; 

    const num = parseInt(text.trim());
    if (isNaN(num)) return; 

    await conn.sendMessage(from, { react: { text: "🔍", key: m.key } });

    // ─── STEP 1 : USER SELECTED MOVIE (Reply with Index) ───────────────
    if (selected.step === "select_movie") {
      const movie = selected.list[num - 1];
      if (!movie) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි. කරුණාකර ලැයිස්තුවෙන් නිවැරදි අංකයක් දෙන්න." });
      }

      waitReply.delete(from);

      try {
        // API Call for Info/Download Links (Baiscopes InfoDL Endpoint)
        // Note: The API uses 'q' for the full URL of the movie.
        const dl = await axios.get(`${INFODL_BASE}?apiKey=${API_KEY}&q=${encodeURIComponent(movie.link)}`, { timeout: 120000 });
        
        // API ප්‍රතිඵලයේ "downloadLinks" array එක පරීක්ෂා කිරීම
        if (!dl.data?.data?.downloadLinks?.length) {
          await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
          return conn.sendMessage(from, { text: "❌ බාගත කිරීමේ සබැඳි (Download links) සොයා ගැනීමට නොහැක." });
        }
        
        const downloadLinks = dl.data.data.downloadLinks;

        let caption = `*🎬 ${movie.title}*\n\nබාගත කිරීමේ ගුණාත්මකභාවය (Quality) තෝරන්න:\n\n`;
        downloadLinks.forEach((l, i) => {
          caption += `${i + 1}. *${l.quality}* - ${l.size}\n\n`;
        });
        caption += `බාගත කිරීමේ සබැඳිය ලබා ගැනීමට අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

        const sent2 = await conn.sendMessage(from, {
          image: { url: movie.imageUrl || 'https://via.placeholder.com/300x450?text=Baiscopes+Movie' },
          caption
        }, { quoted: m });

        // Set the next interaction state for quality selection
        waitReply.set(from, {
          step: "select_quality",
          movie,
          links: downloadLinks,
          msgId: sent2.key.id
        });

        await conn.sendMessage(from, { react: { text: "🍿", key: m.key } });

      } catch (err) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        conn.sendMessage(from, { text: "❌ දෝෂය: සබැඳි ලබා ගැනීමේදී ගැටළුවක්: " + err.message });
      }
    }

    // ─── STEP 2 : USER SELECTED QUALITY (Reply with Index) ──────────────
    else if (selected.step === "select_quality") {
      const link = selected.links[num - 1];
      if (!link) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);
      
      const downloadURL = link.directLinkUrl; // Direct link URL from the API result
      const GB = sizeToGB(link.size);

      // Auto handle large file (Using 2.5GB as a safety margin)
      if (GB > 2.5) { 
        await conn.sendMessage(from, { react: { text: "⚠️", key: m.key } });
        return conn.sendMessage(from, {
          text: `⚠️ ගොනුව WhatsApp හරහා යැවීමට විශාල වැඩිය. (Size: ${link.size})\n\nසෘජු බාගත කිරීමේ සබැඳිය (Direct Download link):\n${downloadURL}`
        });
      }

      try {
        await conn.sendMessage(from, { react: { text: "⏳", key: m.key } }); // Reacting to show download is in progress

        // Send the movie file as a document using the directLinkUrl
        await conn.sendMessage(from, {
          document: { url: downloadURL },
          mimetype: "video/mp4", // Most movies are video/mp4
          fileName: `${selected.movie.title} ${link.quality}.mp4`,
          caption: `🎬 ${selected.movie.title}\nQuality: ${link.quality}\nSize: ${link.size}\n\nබාගත කිරීම සාර්ථකයි! ✅`
        });

        await conn.sendMessage(from, { react: { text: "✅", key: m.key } });

      } catch (err) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        conn.sendMessage(from, {
          text: `❌ යැවීම අසාර්ථක විය. (Error: ${err.message})\n\nසෘජු බාගත කිරීමේ සබැඳිය (Direct link):\n${downloadURL}`
        });
      }
    }
  });

};


// ─────── SIZE PARSER (MB/GB වලින් GB වලට හරවයි) ──────────────────────
function sizeToGB(str) {
  if (!str) return 0;
  let s = str.toUpperCase().replace(",", ".");
  const match = s.match(/(\d+\.?\d*)\s*(GB|MB)/);

  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (unit === "GB") return value;
  if (unit === "MB") return value / 1024;

  return 0;
}
