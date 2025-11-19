/*
 * SinhalaSub Baiscopes Bot – FULL DETAIL + REPLY FIX + PAGINATION
 */

const l = console.log;
const config = require('../config'); 
const { cmd } = require('../command');
const axios = require('axios');

const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes/search?';
const INFO_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes/infodl?';

function fixPixelDrain(url) {
    if (!url.includes("/u/")) return url;
    const id = url.split("/u/")[1];
    return `https://pixeldrain.com/api/file/${id}?download`;
}

cmd({
    pattern: 'baiscopes',
    react: '🎬',
    desc: 'Download Sinhala Sub Movies from Baiscopes',
    category: 'download',
    filename: __filename
}, async (bot, msg, ctx, { from, q, sender }) => {

    if (!q) {
        await bot.sendMessage(from, {
            text: "Usage:\n.baiscopes movie name"
        }, { quoted: msg });
        return;
    }

    try {
        const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;
        const api = await axios.get(url);
        const list = api.data?.data || [];

        if (!list.length) throw new Error("❌ No results found.");

        // pagination setup
        const pageSize = 20;
        let page = 0;
        const totalPages = Math.ceil(list.length / pageSize);

        const getPage = (p) => list.slice(p * pageSize, (p + 1) * pageSize);

        // send first page
        const sendPage = async (p) => {
            const pageData = getPage(p);
            let txt = `*🎬 SEARCH RESULTS* (Page ${p + 1}/${totalPages})\n\n`;
            for (const r of pageData) txt += `${r.index}. ${r.title}\n`;
            if (p < totalPages - 1) txt += `\n➡ Reply "next" for next page.`;
            txt += `\n\nReply with Number`;

            return await bot.sendMessage(from, {
                image: { url: pageData[0].imageUrl },
                caption: txt
            }, { quoted: msg });
        };

        const searchMsg = await sendPage(page);

        // state per user + searchMsg
        const state = new Map();
        state.set(sender + searchMsg.key.id, { list, page, searchMsg });

        // message listener
        bot.ev.on("messages.upsert", async ({ messages }) => {
            const m = messages?.[0];
            const userId = m.key?.remoteJid || sender;
            const text = m.message?.extendedTextMessage?.text || m.message?.conversation;
            const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;

            if (!text || !quotedId) return;

            const userState = state.get(userId + quotedId);
            if (!userState) return;

            const { list, searchMsg } = userState;
            let page = userState.page;

            // handle next page
            if (text.toLowerCase() === 'next') {
                if ((page + 1) >= totalPages) {
                    await bot.sendMessage(from, { text: "❌ No more pages." }, { quoted: m });
                    return;
                }
                page += 1;
                userState.page = page;
                await sendPage(page);
                return;
            }

            // handle number select
            const pickedIndex = parseInt(text);
            const pick = list.find(x => x.index === pickedIndex);
            if (!pick) {
                await bot.sendMessage(from, { text: "❌ Invalid number." }, { quoted: m });
                return;
            }

            // fetch movie info + download links
            const infoUrl = `${INFO_DL_API}q=${encodeURIComponent(pick.link)}&apiKey=${API_KEY}`;
            let info;
            try {
                info = await axios.get(infoUrl);
                info = info.data?.data;
            } catch {
                await bot.sendMessage(from, { text: "❌ Failed to fetch movie info." }, { quoted: m });
                return;
            }

            const mi = info.movieInfo;
            const dl = info.downloadLinks || [];

            let details = `*🎬 ${mi.title}*\n\n`;
            if (mi.releaseDate) details += `📅 Release Date: ${mi.releaseDate}\n`;
            if (mi.country) details += `🌍 Country: ${mi.country}\n`;
            if (mi.runtime) details += `⏱ Runtime: ${mi.runtime}\n`;
            if (mi.genres && mi.genres.length) details += `🎭 Genres: ${mi.genres.join(', ')}\n`;
            if (mi.ratingValue) details += `⭐ IMDb: ${mi.ratingValue}\n`;
            if (mi.summary) details += `\n📝 Summary: ${mi.summary}\n`;

            // send movie info
            await bot.sendMessage(from, {
                image: { url: mi.posterUrl },
                caption: details
            }, { quoted: m });

            // send download links
            let qTxt = "*📥 Download Links*\n\n";
            dl.forEach((d, i) => {
                qTxt += `${i + 1}. ${d.quality || 'HD'} • ${d.size || ''}\n${d.directLinkUrl}\n\n`;
            });

            await bot.sendMessage(from, { text: qTxt }, { quoted: m });
        });

    } catch (e) {
        await bot.sendMessage(from, { text: "❌ Error: " + e.message }, { quoted: msg });
    }
});
