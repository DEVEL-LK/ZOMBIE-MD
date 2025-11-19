const l = console.log;
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes/search?';
const INFO_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes/infodl?';

const cache = new NodeCache({ stdTTL: 60 });

cmd({
    pattern: 'baiscopes',
    react: '🎬',
    desc: 'Search & Download Movies/TV from Baiscopes',
    category: 'download',
    filename: __filename
}, async (bot, msg, ctx, { from, q }) => {

    if (!q) {
        await bot.sendMessage(from, { text: "Usage: .baiscopes Avengers" }, { quoted: msg });
        return;
    }

    try {
        const pageSize = 20;
        const key = `bai_${q.toLowerCase()}`;
        let data = cache.get(key) || { results: [], page: 1 };

        if (!data.results.length) {
            const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;
            const res = await axios.get(url, { timeout: 10000 });
            const list = res.data?.data || [];
            if (!list.length) throw new Error("❌ No results found.");

            data.results = list.map((it, i) => ({
                n: i + 1,
                title: it.title,
                sinhalaTitle: it.sinhalaTitle,
                link: it.link,
                image: it.imageUrl,
                rating: it.rating || 'N/A',
                year: it.year || 'N/A',
                summary: it.summary || 'N/A'
            }));

            cache.set(key, data);
        }

        const currentPage = data.page;
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        const pageResults = data.results.slice(start, end);

        let txt = `*🎬 Baiscopes Search Results (Page ${currentPage})*\n\n`;
        pageResults.forEach(r => txt += `${r.n}. ${r.title}\n`);
        if (data.results.length > end) txt += `\nReply 21 → Next Page`;
        txt += "\n\nReply with Number to get details & download links.";

        const searchMsg = await bot.sendMessage(from, {
            image: { url: pageResults[0].image },
            caption: txt
        }, { quoted: msg });

        const state = new Map();

        const handler = async ({ messages }) => {
            const m = messages?.[0];
            const text = m?.message?.extendedTextMessage?.text?.trim();
            const quotedId = m?.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (!text || !quotedId) return;

            // Next Page
            if (text === "21" && quotedId === searchMsg.key.id) {
                data.page += 1;
                cache.set(key, data);
                await bot.sendMessage(from, { text: `📄 Loading Page ${data.page}...` }, { quoted: m });
                bot.ev.off("messages.upsert", handler);
                return;
            }

            // Movie Select
            if (quotedId === searchMsg.key.id) {
                const pick = data.results.find(x => x.n === parseInt(text));
                if (!pick) {
                    await bot.sendMessage(from, { text: "❌ Invalid number." }, { quoted: m });
                    return;
                }

                const infoURL = `${INFO_DL_API}q=${encodeURIComponent(pick.link)}&apiKey=${API_KEY}`;
                let info;
                try { info = await axios.get(infoURL, { timeout: 10000 }); } 
                catch { await bot.sendMessage(from, { text: "❌ Failed to load movie info." }, { quoted: m }); return; }

                const d = info.data.data;
                const mInfo = d.movieInfo || {};
                const dlLinks = d.downloadLinks || [];

                let details = `*🎬 ${mInfo.title || pick.title}*\n`;
                details += `📅 Release: ${mInfo.releaseDate || 'N/A'}\n`;
                details += `🌎 Country: ${mInfo.country || 'N/A'}\n`;
                details += `⏱ Runtime: ${mInfo.runtime || 'N/A'}\n`;
                details += `⭐ Rating: ${mInfo.ratingValue || 'N/A'} (${mInfo.ratingCount || 0} votes)\n`;
                if (mInfo.genres) details += `🎭 Genres: ${mInfo.genres.join(", ")}\n`;
                details += `\n📝 Summary: ${pick.summary}\n`;

                const infoMsg = await bot.sendMessage(from, {
                    image: { url: mInfo.posterUrl || pick.image },
                    caption: details
                }, { quoted: m });

                if (dlLinks.length) {
                    let dlTxt = "*📥 Download Links*\n\n";
                    dlLinks.forEach((x, i) => {
                        dlTxt += `${i+1}. ${x.quality || 'N/A'} • ${x.size || 'N/A'}\n`;
                    });

                    const dlMsg = await bot.sendMessage(from, { text: dlTxt }, { quoted: infoMsg });
                    state.set(dlMsg.key.id, { dlLinks, pick });
                }

                return;
            }

            // Download Select
            if (state.has(quotedId)) {
                const { dlLinks, pick } = state.get(quotedId);
                const chosen = dlLinks[parseInt(text)-1];
                if (!chosen) { await bot.sendMessage(from, { text: "❌ Wrong selection." }, { quoted: m }); return; }

                await bot.sendMessage(from, { text: `🔗 Download here: ${chosen.directLinkUrl || chosen.linkUrl}` }, { quoted: m });
            }
        };

        bot.ev.on("messages.upsert", handler);

    } catch (e) {
        await bot.sendMessage(from, { text: "❌ Error: " + e.message }, { quoted: msg });
    }
});
