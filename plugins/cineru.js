const l = console.log;
const config = require('../config'); // Bot configuration
const { cmd } = require('../command'); // Command framework
const axios = require('axios'); // HTTP client
const NodeCache = require('node-cache'); // Cache

// --- CINERU API CONFIGURATION ---
const API_KEY = "25f974dba76310042bcd3c9488eec9093816ef32eb36d34c1b6b875ac9215932"; // නව API යතුර
const BASE_URL = "https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cineru"; // නව Base URL

const SEARCH_ENDPOINT = `${BASE_URL}/search`;
const MOVIE_DETAILS_ENDPOINT = `${BASE_URL}/movie-details`;
const TVSHOW_DETAILS_ENDPOINT = `${BASE_URL}/tvshow-details`;
const EPISODE_DETAILS_ENDPOINT = `${BASE_URL}/episode-details`;
const DOWNLOAD_ENDPOINT = `${BASE_URL}/downloadurl`; // Final download URL fetcher
// ----------------------------------

// Cache search results for 180 seconds
const searchCache = new NodeCache({ 'stdTTL': 180, 'checkperiod': 60 });
const stateMap = new Map(); // Map to hold interactive session data

// ───── SIZE PARSER ─────────────────────────────
/**
 * Converts size string (e.g., "1.2 GB") to gigabytes.
 * Default size limit for sending is 2GB.
 * @param {string} str - Size string.
 * @returns {number} Size in GB or 3 (default if unknown/too large).
 */
function sizeToGB(str) {
    if (!str) return 3;
    let s = str.toUpperCase().replace(",", ".");
    const match = s.match(/(\d+.?\d*)\s*(GB|MB)/);
    if (!match) return 3;
    const value = parseFloat(match[1]);
    const unit = match[2];
    if (unit === "GB") return value;
    if (unit === "MB") return value / 1024;
    return 3;
}

/**
 * Helper function to send quality selection message
 */
async function sendQualityOptions(bot, from, m, details) {
    const downloadOptions = details.download.filter(opt => opt.link);
    if (downloadOptions.length === 0) {
        return bot.sendMessage(from, { text: "❌ මෙම චිත්‍රපටය / කථාංගය සඳහා Download විකල්ප නොමැත." });
    }

    let qualityCaption = `*📥 ${details.title}*\n\n`;
    downloadOptions.slice(0, 5).forEach((opt, i) => {
        qualityCaption += `${i + 1}. *${opt.quality}* (${opt.size || 'N/A'})\n`;
    });
    qualityCaption += `\nඔබට අවශ්‍ය Quality එකේ අංකය Reply කරන්න.\n(අවලංගු කිරීමට 'off' යොදන්න.)`;

    const sent = await bot.sendMessage(from, {
        image: { url: details.imageSrc || 'https://via.placeholder.com/300x450' },
        caption: qualityCaption
    }, { quoted: m });

    stateMap.set(from, { step: "select_quality", details: details, downloadOptions, msgId: sent.key.id });
}


// ───── MAIN COMMAND DEFINITION (Search) ─────────────────────────────
cmd({
    'pattern': 'cineru',
    'react': '🎬',
    'desc': 'Search and download Movies/TV Series from Cineru',
    'category': 'download',
    'filename': __filename
}, async (bot, message, context, { from, q: searchQuery }) => {
    // 1. Handle No Search Query
    if (!searchQuery) {
        await bot.sendMessage(from, {
            'text': '*💡 භාවිතය: .cineru <Movie/TV-Show Name>*\n\n📝 උදාහරණ: .cineru Money Heist'
        }, { 'quoted': message });
        return;
    }

    try {
        const cacheKey = 'cineru_search_' + searchQuery.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        // 2. Search Logic (API Call & Caching)
        if (!apiData) {
            await bot.sendMessage(from, { 'text': '🔍 සෙවීම ආරම්භ කරයි...' }, { 'quoted': message });
            
            // Cineru Search API call (using apiKey query parameter)
            const searchUrl = `${SEARCH_ENDPOINT}?apiKey=${API_KEY}&q=${encodeURIComponent(searchQuery)}`;
            
            const response = await axios.get(searchUrl, { 'timeout': 120000 });
            apiData = response.data;

            if (!apiData?.data?.length) {
                throw new Error('❌ කිසිවක් සොයාගත නොහැක.');
            }
            searchCache.set(cacheKey, apiData);
        }

        // 3. Format Search Results for Display
        const results = apiData.data.slice(0, 10).map((item, index) => ({
            'n': index + 1, 
            'title': item.title, 
            'rating': item.rating || 'N/A', 
            'year': item.year || 'N/A', 
            'link': item.link, // Crucial for next step
            'image': item.imageSrc || 'https://via.placeholder.com/300x450'
        }));

        let replyText = '*🍿 Cineru සෙවුම් ප්‍රතිඵල*\n\n';
        for (const item of results) {
            replyText += `🎬 *${item.n}. ${item.title}* (${item.year})\n  ⭐ Rating: ${item.rating}\n\n`;
        }
        replyText += 'තෝරාගැනීමට අංකය Reply කරන්න.\n(අවලංගු කිරීමට \'off\' යොදන්න.)';

        // 4. Send Results and Setup Interactive Listener
        const sentMessage = await bot.sendMessage(from, {
            'image': { 'url': results[0].image }, 
            'caption': replyText
        }, { 'quoted': message });

        // Setup the state for the next step (Movie Selection)
        stateMap.set(from, {
            step: "select_movie",
            list: results,
            msgId: sentMessage.key.id
        });

    } catch (error) {
        l(error);
        await bot.sendMessage(from, { 'text': '❌ සෙවීමේ දෝෂය: ' + (error.response?.data?.message || error.message) }, { 'quoted': message });
    }
});


// ───── REPLY HANDLER DEFINITION (Reply Listener) ─────────────
cmd({
    'pattern': '', 
    'desc': 'Cineru interactive session handler',
    'doNotAdd': true 
}, async (bot, m, context) => {
    
    const from = m.key.remoteJid;
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
    
    const selected = stateMap.get(from);

    // 1. Only proceed if an active session exists
    if (!selected) return;
    
    // 2. REPLY CHECK: Must be a reply and the ID must match the stored message ID
    if (!ctx?.quotedMessage) return; 

    // Use stanzaId (the ID of the message being replied to)
    const quotedMessageId = ctx.stanzaId; 
    
    if (quotedMessageId !== selected.msgId) {
        return; 
    }
    // ---------------------------------------------------

    // Check for "off" command to clear session
    if (text.toLowerCase() === 'off') {
        stateMap.delete(from);
        return bot.sendMessage(from, { text: 'OK. සෙවුම අවලංගු කරන ලදී.' }, { quoted: m });
    }

    const num = parseInt(text);
    if (isNaN(num)) return; // Ignore non-numeric replies

    // --- STEP 1: SELECT MOVIE / TV SHOW ---
    if (selected.step === "select_movie") {
        const movie = selected.list[num - 1];
        if (!movie) return bot.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." }, { quoted: m });
        
        try {
            await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });
            stateMap.delete(from); // Clear state after successful reaction

            const link = movie.link;
            let detailsEndpoint;
            let isTvshow = link.includes('/tvshows/');
            
            if (isTvshow) {
                detailsEndpoint = TVSHOW_DETAILS_ENDPOINT;
            } else {
                detailsEndpoint = MOVIE_DETAILS_ENDPOINT;
            }

            // API Call for details
            const url = `${detailsEndpoint}?apiKey=${API_KEY}&url=${encodeURIComponent(link)}`;
            const r = await axios.get(url, { timeout: 120000 });
            const details = r.data;
            if (!details.title) throw new Error("විස්තර ලබා ගැනීමට නොහැක.");

            let detailsCaption = `*🎬 ${details.title}*\n\n`;
            detailsCaption += `⭐ IMDb Rating: ${details.rating || 'N/A'}\n`;
            detailsCaption += `📅 Release: ${details.year || movie.year || 'N/A'}\n`;
            detailsCaption += `🎭 Genres: ${(details.genres || []).join(', ') || 'N/A'}\n\n`;
            detailsCaption += `📜 Summary:\n${(details.summary || details.description || movie.summary || "N/A").substring(0, 350)}...\n\n`;

            const hasEpisodes = isTvshow && details.episodes?.length > 0;
            
            if (hasEpisodes) {
                // --- TV SHOW: SELECT EPISODE ---
                detailsCaption += `📺 *Available Episodes:*\n`;
                details.episodes.slice(0, 5).forEach((ep, i) => {
                    detailsCaption += `${i + 1}. ${ep.title}\n`;
                });
                detailsCaption += `\nEpisode එකක් තේරීමට අංකය Reply කරන්න.\n(අවලංගු කිරීමට 'off' යොදන්න.)`;
                const sent2 = await bot.sendMessage(from, { image: { url: details.imageSrc || movie.image }, caption: detailsCaption }, { quoted: m });
                stateMap.set(from, { step: "select_episode", details, episodes: details.episodes.slice(0, 5), msgId: sent2.key.id });
            } else {
                // --- MOVIE: PROCEED TO DOWNLOAD QUALITY ---
                if (!details.download?.length) throw new Error("Download විකල්ප නොමැත.");
                await sendQualityOptions(bot, from, m, details);
            }
        } catch (err) {
            l(err); 
            return bot.sendMessage(from, { text: "❌ විස්තර ලබා ගැනීමේ දෝෂයකි: " + (err.message || "API Timeout") }, { quoted: m });
        }
    }

    // --- STEP 2: SELECT EPISODE (For TV Shows) ---
    else if (selected.step === "select_episode") {
        const episode = selected.episodes[num - 1];
        if (!episode) return bot.sendMessage(from, { text: "❌ වලංගු නොවන Episode අංකයකි." }, { quoted: m });
        stateMap.delete(from);

        try {
            await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });
            // Get episode details to find download options
            const url = `${EPISODE_DETAILS_ENDPOINT}?apiKey=${API_KEY}&url=${encodeURIComponent(episode.link)}`;
            const r = await axios.get(url, { timeout: 120000 });
            const details = r.data;
            if (!details.download?.length) throw new Error("Download විස්තර ලබා ගැනීමට නොහැක.");

            // Add TV show title back for cleaner message/filename
            details.title = selected.details.title + " - " + episode.title; 

            // Proceed to quality selection
            await sendQualityOptions(bot, from, m, details);
            
        } catch (err) {
            l(err);
            return bot.sendMessage(from, { text: "❌ Episode Details දෝෂය: " + (err.message || "API Timeout") }, { quoted: m });
        }
    }

    // --- STEP 3: SELECT QUALITY AND DOWNLOAD ---
    else if (selected.step === "select_quality") {
        const qualityOption = selected.downloadOptions[num - 1];
        if (!qualityOption) return bot.sendMessage(from, { text: "❌ වලංගු නොවන Quality අංකයකි." }, { quoted: m });
        stateMap.delete(from);

        const sizeGB = sizeToGB(qualityOption.size);
        const finalUrlLink = qualityOption.link;

        // Size Limit is 2GB for direct sending
        if (sizeGB > 2) { 
            // If file is too large, send the intermediate link for browser download
            return bot.sendMessage(from, { text: `⚠️ ගොනුව විශාල වැඩිය (>${sizeGB.toFixed(2)} GB). \n\nඔබට පහත සබැඳිය browser එකකින් විවෘත කර බාගත කළ හැක:\n${finalUrlLink}` }, { quoted: m });
        }

        try {
            await bot.sendMessage(from, { react: { text: "📥", key: m.key } });
            
            // --- FETCH FINAL DOWNLOAD URL (API requirement) ---
            const url = `${DOWNLOAD_ENDPOINT}?apiKey=${API_KEY}&url=${encodeURIComponent(finalUrlLink)}`;
            const r = await axios.get(url, { timeout: 120000 });
            const finalUrl = r.data.url; // Final download link

            if (!finalUrl) throw new Error("Download Link එක ලබා ගැනීමට නොහැක.");
            
            // --- SEND FILE ---
            const title = selected.details.title || 'Movie/Episode';
            const quality = qualityOption.quality || 'N/A';
            const size = qualityOption.size || 'N/A';
            
            const caption = `*✅ සාර්ථකයි*\n\n🎬 Title: ${title}\n📊 Quality: ${quality} (${size})\n\n${config.MOVIE_FOOTER || ''}`;
            const fileName = `${title.replace(/[^a-zA-Z0-9\s]/g, '_')}_${quality}.mp4`;

            await bot.sendMessage(from, {
                document: { url: finalUrl },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption: caption
            }, { quoted: m });

        } catch (err) {
            l(err);
            // If final download fails, send the intermediate link
            return bot.sendMessage(from, { text: `❌ ගොනුව යැවීමේ දෝෂයකි. (Error: ${err.message}). ඔබට Link එක browser එකකින් භාවිතා කළ හැක:\n\n${finalUrlLink}` }, { quoted: m });
        }
    }
});
