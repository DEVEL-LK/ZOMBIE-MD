const axios = require("axios");
const NodeCache = require("node-cache");
const { cmd } = require("../command");
const config = require("../config");

const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/search?';
const MOVIE_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/infodl?';
const TV_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/tv/dl?';

const searchCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const BRAND = "" + config.MOVIE_FOOTER;

cmd(
  {
    pattern: "sinhalasub",
    react: "🎬",
    desc: "Search and download Movies/TV Series",
    category: "Movies",
    filename: __filename,
  },
  async (client, m, args, { from, q }) => {
    if (!q) {
      await client.sendMessage(
        from,
        {
          text:
            "🎬 *Movie / TV Series Search*\n\n📋 Usage: `.sinhalasub <movie>`\n📝 Example: `.sinhalasub Breaking Bad`",
        },
        { quoted: m }
      );
      return;
    }

    try {
      const cacheKey = "sinhalasub:" + q.toLowerCase();
      let searchData = searchCache.get(cacheKey);

      // === Search API ===
      if (!searchData) {
        const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;
        let res = await axios.get(url);
        searchData = res.data;

        if (!searchData?.data?.length)
          throw new Error("❌ No results found.");

        searchCache.set(cacheKey, searchData);
      }

      const movies = searchData.data.map((m, i) => ({
        n: i + 1,
        title: m.title,
        year: m.year,
        type: m.type,
        rating: m.rating,
        link: m.link,
        image: m.image,
      }));

      // === Search Result List ===
      let caption = "*🎬 SEARCH RESULTS*\n\n";
      for (const mv of movies) {
        caption += `🎥 *${mv.n}. ${mv.title}*\n📅 ${mv.year} | ⭐ ${mv.rating}\n\n`;
      }
      caption += "🔢 *Reply with number* to continue.";

      const listMsg = await client.sendMessage(
        from,
        { image: { url: movies[0].image }, caption },
        { quoted: m }
      );

      const downloadMap = new Map();

      // === Wait for Reply ===
      const handleReply = async ({ messages }) => {
        const msg = messages?.[0];
        if (!msg?.message?.extendedTextMessage) return;

        const text = msg.message.extendedTextMessage.text.trim();
        const replyTo = msg.message.extendedTextMessage.contextInfo?.stanzaId;

        // Stop command
        if (text.toLowerCase() === "off") {
          client.ev.off("messages.upsert", handleReply);
          await client.sendMessage(from, { text: "🛑 Stopped." });
          return;
        }

        // === Movie number selected ===
        if (replyTo === listMsg.key.id) {
          const selected = movies.find((m) => m.n === parseInt(text));
          if (!selected) {
            await client.sendMessage(from, { text: "❌ Invalid reply." }, { quoted: msg });
            return;
          }

          // === Select API based on type ===
          const downAPI =
            selected.type === "MOVIE"
              ? `${MOVIE_DL_API}url=${encodeURIComponent(selected.link)}&apiKey=${API_KEY}`
              : `${TV_DL_API}url=${encodeURIComponent(selected.link)}&apiKey=${API_KEY}`;

          let info = await axios.get(downAPI).then((r) => r.data);

          if (!info?.download_links) {
            await client.sendMessage(from, { text: "❌ No links." }, { quoted: msg });
            return;
          }

          // === Extract Download Links (includes Pixeldrain) ===
          const qlist = info.download_links.map((x, i) => ({
            n: i + 1,
            quality: x.quality,
            size: x.size,
            direct: x.direct_download,
            pxd: x.pixeldrain, // <-- Pixeldrain Added
          }));

          let qualityTxt = `🎬 *${selected.title}*\n\n📥 Select Quality:\n\n`;
          for (const ql of qlist)
            qualityTxt += `${ql.n}. *${ql.quality}* (${ql.size})\n`;

          const qualMsg = await client.sendMessage(
            from,
            { image: { url: info.image }, caption: qualityTxt },
            { quoted: msg }
          );

          downloadMap.set(qualMsg.key.id, {
            film: selected,
            picks: qlist,
          });

          return;
        }

        // === Quality Selected ===
        if (downloadMap.has(replyTo)) {
          const { film, picks } = downloadMap.get(replyTo);
          const pick = picks.find((x) => x.n === parseInt(text));

          if (!pick) {
            await client.sendMessage(from, { text: "❌ Wrong number." }, { quoted: msg });
            return;
          }

          const finalLink = pick.direct || pick.pxd; // Pixeldrain fallback

          if (!finalLink) {
            await client.sendMessage(from, { text: "❌ No valid links." }, { quoted: msg });
            return;
          }

          const safe = film.title.replace(/[\\/:*?"<>|]/g, "");
          const fileName = `🎬 ${safe} (${pick.quality}).mp4`;

          try {
            await client.sendMessage(
              from,
              {
                document: { url: finalLink },
                mimetype: "video/mp4",
                fileName,
                caption: `🎬 *${film.title}*\n📊 ${pick.quality} | ${pick.size}\n\n${BRAND}`,
              },
              { quoted: msg }
            );
          } catch {
            await client.sendMessage(
              from,
              {
                text: `❌ Upload failed.\n🔗 Direct Link:\n${finalLink}`,
              },
              { quoted: msg }
            );
          }
        }
      };

      client.ev.on("messages.upsert", handleReply);
    } catch (err) {
      await client.sendMessage(
        from,
        { text: `❌ Error: ${err.message}` },
        { quoted: m }
      );
    }
  }
);
