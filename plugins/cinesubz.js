const axios = require("axios");
const NodeCache = require("node-cache");
const { cmd } = require("../command"); 

// Cinesubz API Settings
const API_KEY = "25f974dba76310042bcd3c9488eec9093816ef32eb36d34c1b6b875ac9215932"; 
const BASE = "https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz";

// Endpoints
const SEARCH_ENDPOINT = `${BASE}/search`;
const MOVIE_DETAILS_ENDPOINT = `${BASE}/movie-details`;
const TVSHOW_DETAILS_ENDPOINT = `${BASE}/tvshow-details`;
const EPISODE_DETAILS_ENDPOINT = `${BASE}/episode-details`;
const DOWNLOAD_ENDPOINT = `${BASE}/downloadurl`;

module.exports = (conn) => {
  const cache = new NodeCache({ stdTTL: 180 });
  const waitReply = new Map();

  // ─────── SEARCH COMMAND ──────────────────────────────────────────────
  cmd({
    pattern: "cinesubz",
    desc: "Cinesubz චිත්‍රපට / ටීවී සෙවීම",
    react: "🍿",
    category: "Movie",
    filename: __filename
  }, async (client, quoted, msg, { from, q }) => {

    if (!q) return client.sendMessage(from, { text: "භාවිතය: .cinesubz <චිත්‍රපට/ටීවී නම>" }, { quoted: msg });

    try {
      const key = "cinesubz_search_" + q.toLowerCase();
      let data = cache.get(key);

      if (!data) {
        // API Call for Search 
        const r = await axios.get(`${SEARCH_ENDPOINT}?apiKey=${API_KEY}&q=${encodeURIComponent(q)}`, { timeout: 120000 });
        
        if (!r.data?.data?.length) throw new Error("❌ චිත්‍රපට හෝ TV Shows කිසිවක් සොයා ගැනීමට නොහැක.");

        data = r.data.data;
        cache.set(key, data);
      }

      let caption = `*🍿 Cinesubz සෙවුම් ප්‍රතිඵල*\n\n`;
      data.slice(0, 10).forEach((m, i) => { // Top 10 results only
        caption += `${i + 1}. *${m.title}* (${m.year}) ⭐ ${m.rating || 'N/A'}\n\n`;
      });
      caption += `විස්තර ලබා ගැනීමට ඉහත ලැයිස්තුවෙන් අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

      const sent = await client.sendMessage(from, {
        image: { url: data[0].imageSrc || 'https://via.placeholder.com/300x450?text=Cinesubz' },
        caption
      }, { quoted: msg });

      waitReply.set(from, {
        step: "select_movie",
        list: data.slice(0, 10),
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

    const isReply = contextInfo?.stanzaId === selected.msgId;

    if (!isReply) return; 

    const num = parseInt(text.trim());
    if (isNaN(num)) return; 

    await conn.sendMessage(from, { react: { text: "🔍", key: m.key } });

    // ─── STEP 1 : USER SELECTED MOVIE (Get Details) ───────────────
    if (selected.step === "select_movie") {
      const movie = selected.list[num - 1];
      if (!movie) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);

      try {
        const link = movie.link;
        let details;
        let detailsEndpoint;

        // Determine if it's a Movie or TV Show based on the link (Simple heuristic)
        if (link.includes('/tvshows/') || link.includes('-episode-')) {
          detailsEndpoint = link.includes('-episode-') ? EPISODE_DETAILS_ENDPOINT : TVSHOW_DETAILS_ENDPOINT;
        } else {
          detailsEndpoint = MOVIE_DETAILS_ENDPOINT;
        }

        // Get Movie/TV Show Details
        const r = await axios.get(`${detailsEndpoint}?apiKey=${API_KEY}&url=${encodeURIComponent(link)}`, { timeout: 120000 });
        details = r.data;

        if (!details.title) throw new Error("විස්තර ලබා ගැනීමට නොහැක.");

        let detailsCaption = `*🎬 ${details.title || movie.title}*\n\n`;
        detailsCaption += `⭐ *IMDb Rating:* ${details.rating || 'N/A'}\n`;
        detailsCaption += `📅 *Release Year:* ${details.year || 'N/A'}\n`;
        detailsCaption += `🎭 *Genres:* ${(details.genres || []).join(', ') || 'N/A'}\n`;
        detailsCaption += `📜 *Summary:*\n${(details.summary || details.description || movie.summary || 'N/A').substring(0, 300)}...\n\n`;

        // Check for direct download link or episodes
        const hasDownloadLink = details.downloadLink || details.links?.length > 0;
        const hasEpisodes = details.episodes?.length > 0;
        
        // Handling Episodes (If it's a TV Show)
        if (hasEpisodes) {
            detailsCaption += `📺 *Available Episodes:*\n`;
            details.episodes.slice(0, 5).forEach((ep, i) => {
                 detailsCaption += `${i + 1}. ${ep.title}\n`;
            });
            detailsCaption += `\n*Reply with the Episode number* to get its details or download link.`;

            const sent2 = await client.sendMessage(from, {
              image: { url: details.imageSrc || movie.imageSrc || 'https://via.placeholder.com/300x450?text=Cinesubz+Details' },
              caption: detailsCaption
            }, { quoted: m });
            
            // Set the next interaction state to select episode
            waitReply.set(from, {
                step: "select_episode",
                movie,
                episodes: details.episodes,
                msgId: sent2.key.id
            });
            
        // Handling Movie Download Link
        } else if (hasDownloadLink || link.includes('/movies/')) {
            detailsCaption += `📥 *බාගත කිරීමට අංක 1 සමඟින් පිළිතුරු (Reply) දෙන්න.*`;

            const sent2 = await client.sendMessage(from, {
                image: { url: details.imageSrc || movie.imageSrc || 'https://via.placeholder.com/300x450?text=Cinesubz+Details' },
                caption: detailsCaption
            }, { quoted: m });
            
            // Set the next interaction state to confirm download
            waitReply.set(from, {
                step: "confirm_download",
                movie,
                link: link,
                msgId: sent2.key.id
            });
        } else {
            await client.sendMessage(from, { text: detailsCaption + "\n\n❌ බාගත කිරීමේ සබැඳි හෝ Episodes සොයා ගැනීමට නොහැක." }, { quoted: m });
        }
        
        await conn.sendMessage(from, { react: { text: "📜", key: m.key } });

      } catch (err) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        conn.sendMessage(from, { text: "❌ දෝෂය: විස්තර ලබා ගැනීමේදී ගැටළුවක්: " + err.message });
      }
    }
    
    // ─── STEP 2 : USER CONFIRMED DOWNLOAD / SELECTED EPISODE ───────────
    else if (selected.step === "confirm_download") {
        if (num !== 1) { // Only accept '1' for movie download confirmation
             await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
             return conn.sendMessage(from, { text: "❌ බාගත කිරීම ආරම්භ කිරීමට අංක *1* සමඟින් පිළිතුරු දෙන්න." });
        }
        
        const movieLink = selected.link;
        waitReply.delete(from);

        try {
            // Get Download Links
            const dl = await axios.get(`${DOWNLOAD_ENDPOINT}?apiKey=${API_KEY}&url=${encodeURIComponent(movieLink)}`, { timeout: 120000 });
            
            if (!dl.data?.links?.length) {
              await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
              return conn.sendMessage(from, { text: "❌ බාගත කිරීමේ සබැඳි සොයා ගැනීමට නොහැක." });
            }
            
            const downloadLinks = dl.data.links;

            let caption = `*🎬 ${selected.movie.title}*\n\nබාගත කිරීමේ ගුණාත්මකභාවය (Quality) තෝරන්න:\n\n`;
            downloadLinks.forEach((l, i) => {
              caption += `${i + 1}. *${l.quality}* - ${l.size}\n\n`;
            });
            caption += `බාගත කිරීම ආරම්භ කිරීමට අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

            const sent3 = await conn.sendMessage(from, {
                caption
            }, { quoted: m });

            // Set the next interaction state for quality selection
            waitReply.set(from, {
                step: "select_quality",
                movie: selected.movie,
                links: downloadLinks,
                msgId: sent3.key.id
            });

            await conn.sendMessage(from, { react: { text: "📥", key: m.key } });

        } catch (err) {
            await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
            conn.sendMessage(from, { text: "❌ දෝෂය: සබැඳි ලබා ගැනීමේදී ගැටළුවක්: " + err.message });
        }
    }
    
    // ─── STEP 2 (Alternate) : USER SELECTED EPISODE ────────────────────
    else if (selected.step === "select_episode") {
      const episode = selected.episodes[num - 1];
      if (!episode) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);

      // Treat episode link as the download link for Step 3
      // Go directly to the download process for the selected episode
      try {
          // Get Download Links for the Episode
          const dl = await axios.get(`${DOWNLOAD_ENDPOINT}?apiKey=${API_KEY}&url=${encodeURIComponent(episode.link)}`, { timeout: 120000 });
          
          if (!dl.data?.links?.length) {
              await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
              return conn.sendMessage(from, { text: "❌ Episode එක සඳහා බාගත කිරීමේ සබැඳි සොයා ගැනීමට නොහැක." });
          }
          
          const downloadLinks = dl.data.links;

          let caption = `*📺 ${selected.movie.title} - ${episode.title}*\n\nබාගත කිරීමේ ගුණාත්මකභාවය තෝරන්න:\n\n`;
          downloadLinks.forEach((l, i) => {
            caption += `${i + 1}. *${l.quality}* - ${l.size}\n\n`;
          });
          caption += `බාගත කිරීම ආරම්භ කිරීමට අංකයක් සමඟින් පිළිතුරු (Reply) දෙන්න.`;

          const sent3 = await conn.sendMessage(from, {
              caption
          }, { quoted: m });

          // Set the next interaction state for quality selection
          waitReply.set(from, {
              step: "select_quality",
              movie: selected.movie, // Retain the main movie info
              links: downloadLinks,
              msgId: sent3.key.id
          });

          await conn.sendMessage(from, { react: { text: "📥", key: m.key } });

      } catch (err) {
            await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
            conn.sendMessage(from, { text: "❌ දෝෂය: Episode සබැඳි ලබා ගැනීමේදී ගැටළුවක්: " + err.message });
      }
    }


    // ─── STEP 3 : USER SELECTED QUALITY (Final Download) ──────────────
    else if (selected.step === "select_quality") {
      const link = selected.links[num - 1];
      if (!link) {
        await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
        return conn.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." });
      }

      waitReply.delete(from);
      
      const downloadURL = link.url;
      const GB = sizeToGB(link.size);

      // Auto handle large file (2.5GB limit)
      if (GB > 2.5) { 
        await conn.sendMessage(from, { react: { text: "⚠️", key: m.key } });
        return conn.sendMessage(from, {
          text: `⚠️ ගොනුව WhatsApp හරහා යැවීමට විශාල වැඩිය. (Size: ${link.size})\n\nසෘජු බාගත කිරීමේ සබැඳිය (Direct Download link):\n${downloadURL}`
        });
      }

      try {
        await conn.sendMessage(from, { react: { text: "⏳", key: m.key } }); 

        // Send the movie file as a document
        await conn.sendMessage(from, {
          document: { url: downloadURL },
          mimetype: "video/mp4", 
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


// ─────── SIZE PARSER ─────────────────────────────────────────────────
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
