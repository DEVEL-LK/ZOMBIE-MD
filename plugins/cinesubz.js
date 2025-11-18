const l = console.log;
const config = require('../config'); 
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

const API_KEY = '25f974dba76310042bcd3c9488eec9093816ef32eb36d34c1b6b875ac9215932';
const SEARCH_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/search';
const MOVIE_DETAIL_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/movie-details';
const TV_DETAIL_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/tvshow-details';
const DOWNLOAD_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/downloadurl';

const searchCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const BRAND = config.MOVIE_FOOTER;

cmd({
    pattern: 'cinesubz',
    react: '🎬',
    desc: 'Search and download Movies/TV Series',
    category: 'download',
    filename: __filename
}, async (bot, message, context, { from, q }) => {
    if (!q) {
        await bot.sendMessage(from, { text: '*💡 Usage: .sinhalasub <search term>*' }, { quoted: message });
        return;
    }

    try {
        const cacheKey = 'film_' + q.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        if (!apiData) {
            const url = `${SEARCH_API}?apiKey=${API_KEY}&q=${encodeURIComponent(q)}`;
            let retries = 5;
            while (retries--) {
                try {
                    apiData = (await axios.get(url, { timeout: 30000 })).data;
                    if (!apiData || !apiData.status || !apiData.data?.length) throw new Error('No results.');
                    searchCache.set(cacheKey, apiData);
                    break;
                } catch (err) {
                    if (!retries) throw new Error('❌ Search failed. Try again later.');
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }

        // Log API response for debugging
        l('Search API response:', apiData);

        const results = apiData.data.map((item, i) => ({
            n: i + 1,
            title: item.title || item.Title,
            year: item.year || 'N/A',
            imdb: item.imdb || 'N/A',
            link: item.url || item.Link,
            image: item.image || item.Img
        }));

        let replyText = '*🎬 SEARCH RESULTS*\n\n';
        results.forEach(item => replyText += `🎬 *${item.n}. ${item.title}*\n⭐ Rating: ${item.imdb}\n📅 Year: ${item.year}\n\n`);
        replyText += '🔢 Select number 🪀';

        const sentMessage = await bot.sendMessage(from, { image: { url: results[0].image }, caption: replyText }, { quoted: message });
        const stateMap = new Map();

        const handler = async ({ messages }) => {
            const msg = messages?.[0];
            if (!msg?.message?.extendedTextMessage) return;
            const text = msg.message.extendedTextMessage.text.trim();
            const quotedId = msg.message.extendedTextMessage.contextInfo?.stanzaId;

            if (text.toLowerCase() === 'off') {
                bot.ev.off('messages.upsert', handler);
                stateMap.clear();
                await bot.sendMessage(from, { text: 'OK.' }, { quoted: msg });
                return;
            }

            if (quotedId === sentMessage.key.id) {
                const film = results.find(f => f.n === parseInt(text));
                if (!film) return bot.sendMessage(from, { text: '❌ Invalid number.' }, { quoted: msg });

                const isTv = film.link.includes('/tv/') || film.link.includes('/episodes/');
                const detailApi = isTv ? TV_DETAIL_API : MOVIE_DETAIL_API;
                let infoData;

                try {
                    infoData = (await axios.get(`${detailApi}?apiKey=${API_KEY}&url=${encodeURIComponent(film.link)}`, { timeout: 30000 })).data.data;
                } catch { infoData = null; }

                let thumb = film.image;
                if (infoData) {
                    thumb = infoData.image || film.image;
                    let infoText = `*🎬 ${infoData.title || film.title}*\n📝 Tagline: ${infoData.tagline || 'N/A'}\n📅 Release: ${infoData.releaseDate || 'N/A'}\n⏱ Runtime: ${infoData.runtime || 'N/A'}\n⭐ Rating: ${infoData.ratingValue || 'N/A'}\n🎭 Genres: ${(infoData.genres||[]).join(', ') || 'N/A'}\n\n🔢 Select quality`;
                    await bot.sendMessage(from, { image: { url: thumb }, caption: infoText }, { quoted: msg });
                }

                // Download links
                let dlData;
                let retries = 5;
                while (retries--) {
                    try {
                        dlData = (await axios.get(`${DOWNLOAD_API}?apiKey=${API_KEY}&url=${encodeURIComponent(film.link)}`, { timeout: 30000 })).data;
                        if (!dlData.status || !dlData.data?.downloadLinks?.length) throw new Error('No download links found.');
                        break;
                    } catch {
                        if (!retries) {
                            await bot.sendMessage(from, { text: '❌ Download data failed. Try again later.' }, { quoted: msg });
                            return;
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                const links = dlData.data.downloadLinks || [];
                const picks = [];
                const qMap = {};

                links.forEach(l => {
                    const key = l.quality.toUpperCase().replace(/\s/g,'');
                    let priority = key.includes('1080')||key.includes('FHD')?3:key.includes('720')||key.includes('HD')?2:1;
                    if (!qMap[key] || qMap[key].priority < priority) qMap[key] = { ...l, priority };
                });

                Object.values(qMap).sort((a,b)=>b.priority-a.priority).slice(0,5).forEach((l,i)=> picks.push({ n:i+1, ...l }));

                let qualityText = `*🎬 ${film.title}*\n\n📥 Choose Quality:\n\n`;
                picks.forEach(p => qualityText += `${p.n}. *${p.quality}* • ${p.size || 'N/A'})\n`);
                const qMsg = await bot.sendMessage(from, { image: { url: thumb }, caption: qualityText }, { quoted: msg });
                stateMap.set(qMsg.key.id, { film, picks });
            }

            if (stateMap.has(quotedId)) {
                const { film, picks } = stateMap.get(quotedId);
                const sel = picks.find(p=>p.n===parseInt(text));
                if (!sel) return bot.sendMessage(from, { text: '❌ Wrong quality.' }, { quoted: msg });

                const sizeLower = sel.size?.toLowerCase()||'0mb';
                let sizeGB = sizeLower.includes('gb')?parseFloat(sizeLower):sizeLower.includes('mb')?(parseFloat(sizeLower)/1024):3;
                if (sizeGB>2) return bot.sendMessage(from, { text:`⚠️ Too large (${sel.size}). Direct link:\n${sel.link}` }, { quoted: msg });

                const fileName = `🎥 ${film.title.replace(/[\\/:*?"<>|]/g,'')}.${sel.quality||'DL'}.mp4`;
                try {
                    const buf = await axios.get(sel.link, { responseType:'arraybuffer', timeout:60000 }).then(r=>r.data);
                    await bot.sendMessage(from, { document: buf, mimetype:'video/mp4', fileName, caption:`*🎬 ${film.title}*\n*📊 Quality: ${sel.quality} • Size: ${sel.size || 'N/A'}\n\n${BRAND}` }, { quoted: msg });
                    await bot.sendMessage(from, { react:{ text:"✅", key: msg.key } });
                } catch {
                    await bot.sendMessage(from, { text: `❌ Failed. Direct link:\n${sel.link}` }, { quoted: msg });
                }
            }
        };

        bot.ev.on('messages.upsert', handler);

    } catch (e) {
        l(e);
        await bot.sendMessage(from, { text: '❌ Error: '+ e.message }, { quoted: message });
    }
});
