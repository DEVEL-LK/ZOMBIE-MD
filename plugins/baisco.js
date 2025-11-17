const l = console.log;
const config = require('../config'); // Bot configuration (assuming you have this)
const { cmd } = require('../command'); // Command framework (assuming you have this)
const axios = require('axios'); // HTTP client
const NodeCache = require('node-cache'); // Cache

// --- BAISCOPES API CONFIGURATION ---
const API_KEY = "c56182a993f60b4f49cf97ab09886d17";
const BASE_URL = "https://sadaslk-apis.vercel.app/api/v1/movie/baiscopes";

const SEARCH_ENDPOINT = `${BASE_URL}/search`;
const DETAILS_ENDPOINT = `${BASE_URL}/infodl`;
// ----------------------------------

// Cache search results for 300 seconds (5 minutes)
const searchCache = new NodeCache({ 'stdTTL': 300, 'checkperiod': 60 });
const stateMap = new Map(); // Map to hold interactive session data

// ───── SIZE PARSER ─────────────────────────────
/**
 * Converts size string (e.g., "1.2 GB") to gigabytes.
 * Default size is 3GB if size is unknown (to avoid sending huge files).
 * @param {string} str - Size string.
 * @returns {number} Size in GB.
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
 * Helper function to send Quality selection message
 */
async function sendQualityOptions(bot, from, m, details) {
    // API response download structure is often different, adapting to Baiscopes-style
    const downloadOptions = details.links.filter(opt => opt.link); 
    
    if (downloadOptions.length === 0) {
        return bot.sendMessage(from, { text: "❌ මෙම චිත්‍රපටය සඳහා Download විකල්ප නොමැත." });
    }

    let qualityCaption = `*📥 ${details.title || details.movieName}*\n\n`;
    downloadOptions.slice(0, 5).forEach((opt, i) => {
        // Assuming quality and size are available in the link object
        qualityCaption += `${i + 1}. *${opt.quality || 'N/A'}* (${opt.size || 'N/A'})\n`;
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
    'pattern': 'baiscopes',
    'react': '🍿',
    'desc': 'Search and download Movies/TV Series from Baiscopes',
    'category': 'download',
    'filename': __filename
}, async (bot, message, context, { from, q: searchQuery }) => {
    // 1. Handle No Search Query
    if (!searchQuery) {
        await bot.sendMessage(from, {
            'text': '*💡 භාවිතය: .baiscopes <Movie Name>*\n\n📝 උදාහරණ: .baiscopes Interstellar'
        }, { 'quoted': message });
        return;
    }

    try {
        const cacheKey = 'baiscopes_search_' + searchQuery.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        // 2. Search Logic (API Call & Caching)
        if (!apiData) {
            await bot.sendMessage(from, { 'text': '🔍 සෙවීම ආරම්භ කරයි...' }, { 'quoted': message });
            
            // Baiscopes Search API call
            const searchUrl = `${SEARCH_ENDPOINT}?api=${API_KEY}&q=${encodeURIComponent(searchQuery)}`;
            
            const response = await axios.get(searchUrl, { 'timeout': 120000 });
            apiData = response.data;
            
            // Ensure data exists and is an array (API structure might vary)
            if (!apiData?.status || apiData.status !== 200 || !apiData.data?.length) {
                throw new Error('❌ කිසිවක් සොයාගත නොහැක.');
            }
            searchCache.set(cacheKey, apiData);
        }

        // 3. Format Search Results for Display
        const results = apiData.data.slice(0, 10).map((item, index) => ({
            'n': index + 1, 
            'title': item.movieName || item.title, 
            'year': item.year || 'N/A', 
            'link': item.link, // Crucial for next step (Details link)
            'image': item.image || 'https://via.placeholder.com/300x450'
        }));

        let replyText = '*🍿 Baiscopes සෙවුම් ප්‍රතිඵල*\n\n';
        for (const item of results) {
            replyText += `🎬 *${item.n}. ${item.title}* (${item.year})\n\n`;
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
            msgId: sentMessage.key.id // Crucial for reply matching
        });

    } catch (error) {
        l(error);
        await bot.sendMessage(from, { 'text': '❌ සෙවීමේ දෝෂය: ' + (error.response?.data?.message || error.message) }, { 'quoted': message });
    }
});


// ───── REPLY HANDLER DEFINITION (Interactive Listener) ─────────────
cmd({
    'pattern': '', 
    'desc': 'Baiscopes interactive session handler',
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

    // --- STEP 1: SELECT MOVIE (Get Details) ---
    if (selected.step === "select_movie") {
        const movie = selected.list[num - 1];
        if (!movie) return bot.sendMessage(from, { text: "❌ වලංගු නොවන අංකයකි." }, { quoted: m });
        
        try {
            await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });
            stateMap.delete(from); // Clear state before time-consuming API call

            // API Call for details (using the link from the search result)
            const detailsUrl = `${DETAILS_ENDPOINT}?api=${API_KEY}&link=${encodeURIComponent(movie.link)}`;
            
            const r = await axios.get(detailsUrl, { timeout: 120000 });
            const details = r.data.data; // Assuming details are under r.data.data
            
            if (!details?.title && !details?.movieName) throw new Error("විස්තර ලබා ගැනීමට නොහැක.");

            let detailsCaption = `*🎬 ${details.title || details.movieName}*\n\n`;
            detailsCaption += `📅 Release: ${details.year || movie.year || 'N/A'}\n`;
            detailsCaption += `📜 Summary:\n${(details.summary || "N/A").substring(0, 350)}...\n\n`;
            detailsCaption += `⬇️ Download Quality තෝරන්න:\n`;

            // --- PROCEED TO DOWNLOAD QUALITY ---
            if (!details.links?.length) throw new Error("Download විකල්ප නොමැත.");
            await sendQualityOptions(bot, from, m, details);
            
        } catch (err) {
            l(err); 
            // If an error occurs, send an error message instead of remaining silent
            return bot.sendMessage(from, { text: "❌ විස්තර ලබා ගැනීමේ දෝෂයකි: " + (err.message || "API Timeout") }, { quoted: m });
        }
    }

    // --- STEP 2: SELECT QUALITY AND DOWNLOAD ---
    else if (selected.step === "select_quality") {
        const qualityOption = selected.downloadOptions[num - 1];
        if (!qualityOption) return bot.sendMessage(from, { text: "❌ වලංගු නොවන Quality අංකයකි." }, { quoted: m });
        stateMap.delete(from);

        const sizeGB = sizeToGB(qualityOption.size);
        const finalUrl = qualityOption.link; // Baiscopes API provides the direct final link

        if (sizeGB > 2) {
            // If file is too large, send the direct link for browser download
            return bot.sendMessage(from, { text: `⚠️ ගොනුව විශාල වැඩිය (>${sizeGB.toFixed(2)} GB). \n\nඔබට පහත සබැඳිය browser එකකින් විවෘත කර බාගත කළ හැක:\n${finalUrl}` }, { quoted: m });
        }

        try {
            await bot.sendMessage(from, { react: { text: "📥", key: m.key } });
            
            // --- SEND FILE ---
            const title = selected.details.title || selected.details.movieName || 'Movie';
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
            // If sending file fails, send the direct link instead
            return bot.sendMessage(from, { text: `❌ ගොනුව යැවීමේ දෝෂයකි. (Error: ${err.message}). ඔබට Link එක browser එකකින් භාවිතා කළ හැක:\n\n${finalUrl}` }, { quoted: m });
        }
    }
});

