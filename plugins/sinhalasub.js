/*

SinhalaSub Bot – FULL DETAIL + ERROR FIXED + TV/Movie Support
*/


const l = console.log;
const config = require('../config');
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/search?';
const MOVIE_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/infodl?';
const TV_DL_API   = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/tv/dl?';

const cache = new NodeCache({ stdTTL: 60 });

function fixPixelDrain(url) {
if (!url.includes("/u/")) return url;
const id = url.split("/u/")[1];
return https://pixeldrain.com/api/file/${id}?download;
}

cmd({
pattern: 'sinhalasub',
react: '🎬',
desc: 'Download Sinhala Sub Movies',
category: 'download',
filename: __filename
}, async (bot, msg, ctx, { from, q }) => {

if (!q) {  
    await bot.sendMessage(from, {  
        text: "Usage:\n.sinhalasub Avatar\n.sinhalasub Breaking Bad"  
    }, { quoted: msg });  
    return;  
}  

try {  
    const key = "search_" + q.toLowerCase();  
    let data = cache.get(key);  

    if (!data) {  
        const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;  
        const api = await axios.get(url);  
        const list = api.data?.data || [];  

        if (!list.length) throw new Error("❌ No results found.");  

        data = list.map((it, i) => ({  
            n: i + 1,  
            title: it.Title || it.title,  
            link: it.Link || it.link,  
            image: it.Img || it.image  
        }));  

        cache.set(key, data);  
    }  

    let txt = "*🎬 SEARCH RESULTS*\n\n";  
    for (const r of data) txt += `${r.n}. ${r.title}\n`;  
    txt += "\nReply with Number";  

    const searchMsg = await bot.sendMessage(from, {  
        image: { url: data[0].image },  
        caption: txt  
    }, { quoted: msg });  

    const state = new Map();  

    const handler = async ({ messages }) => {  
        const m = messages?.[0];  
        const text = m?.message?.extendedTextMessage?.text?.trim();  
        const quotedId = m?.message?.extendedTextMessage?.contextInfo?.stanzaId;  
        if (!text || !quotedId) return;  

        // ----- SELECT MOVIE -----  
        if (quotedId === searchMsg.key.id) {  
            const pick = data.find(x => x.n === parseInt(text));  
            if (!pick) {  
                await bot.sendMessage(from, { text: "❌ Invalid number." }, { quoted: m });  
                return;  
            }  

            const isTV = pick.link.includes("/episodes/");  
            const infoURL = (isTV ? TV_DL_API : MOVIE_DL_API) +   
                            `q=${encodeURIComponent(pick.link)}&apiKey=${API_KEY}`;  

            let info;  
            try {  
                info = await axios.get(infoURL);  
                info = info.data;  
            } catch {  
                await bot.sendMessage(from, { text: "❌ Failed to load movie info." }, { quoted: m });  
                return;  
            }  

            const apiData = info.data || {};  

            const full = {  
                title: apiData.title || pick.title,  
                imdb: apiData.imdb || apiData.rating || "N/A",  
                year: apiData.year || apiData.releaseYear || "N/A",  
                genre: apiData.genre || apiData.genres || "N/A",  
                plot: apiData.plot || apiData.description || apiData.story || "N/A",  
                image: apiData.image || pick.image  
            };  

            let details = `*🎬 ${full.title}*\n\n`;  

            if (full.imdb !== "N/A") details += `⭐ IMDb: ${full.imdb}\n`;  
            if (full.year !== "N/A") details += `📅 Year: ${full.year}\n`;  
            if (full.genre !== "N/A") details += `🎭 Genre: ${full.genre}\n`;  
            if (full.plot !== "N/A")  details += `\n📝 *Plot:* ${full.plot}\n`;  

            const infoMsg = await bot.sendMessage(from, {  
                image: { url: full.image },  
                caption: details  
            }, { quoted: m });  

            // Prepare quality links  
            let links = [];  

            if (isTV) {  
                links = apiData.episodes || [];  
            } else {  
                links = apiData.downloadLinks || [];  
            }  

            const qList = links.map((x, i) => ({  
                n: i + 1,  
                quality: x.quality || x.q,  
                size: x.size || "Unknown",  
                link: x.finalDownloadUrl || x.link,  
                episode: x.episode  
            }));  

            let qTxt = "*📥 Choose Quality*\n\n";  
            for (const q of qList) qTxt += `${q.n}. ${q.quality} • ${q.size}\n`;  

            const qMsg = await bot.sendMessage(from, {  
                caption: qTxt,  
                image: { url: full.image }  
            });  

            state.set(qMsg.key.id, { qList, pick, isTV });  
            return;  
        }  

        // ----- QUALITY SELECT -----  
        if (state.has(quotedId)) {  
            const { qList, pick } = state.get(quotedId);  

            const chosen = qList.find(x => x.n === parseInt(text));  
            if (!chosen) {  
                await bot.sendMessage(from, { text: "❌ Wrong Quality." }, { quoted: m });  
                return;  
            }  

            const buffer = await axios.get(  
                fixPixelDrain(chosen.link),  
                { responseType: "arraybuffer" }  
            ).then(r => r.data);  

            await bot.sendMessage(from, {  
                document: buffer,  
                mimetype: "video/mp4",  
                fileName: `${pick.title} - ${chosen.quality}.mp4`,  
                caption: `🎬 ${pick.title}\n📥 ${chosen.quality}`  
            }, { quoted: m });  

            await bot.sendMessage(from, { react: { text: "✅", key: m.key } });  
        }  
    };  

    bot.ev.on("messages.upsert", handler);  

} catch (e) {  
    await bot.sendMessage(from, { text: "❌ Error: " + e.message }, { quoted: msg });  
}

});

මේ කොමාන්ඩ් එක replace කරන්න
