/*
 * NOTE: The original variable/function names are placeholders.
 * Actual names (like 'l' for console.log) are preserved where clear.
 * The string array lookup (_0x2ae8a6(xxx)) is replaced with the actual string.
 */

const l = console.log;
const config = require('../config'); // Loads configuration
const { cmd } = require('../command'); // Bot command framework
const axios = require('axios'); // HTTP client for API calls
const NodeCache = new require('node-cache'); // Cache for search results

// --- REPLACED API CONFIGURATION (Using Cineru API) ---
const API_KEY = '25f974dba76310042bcd3c9488eec9093816ef32eb36d34c1b6b875ac9215932'; // New API Key from your request
const BASE_URL = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cineru/';

const SEARCH_API = `${BASE_URL}search?`;
// The movie and TV APIs share the same structure but use different endpoints, hence the different names here:
const MOVIE_DL_API = `${BASE_URL}movie?`; // Used for Movie and Episode DL (based on your request structure)
const TV_DL_API = `${BASE_URL}tvshow?`; // Used for TV Show Detail (based on your request structure)
// -----------------------------

// Cache search results for 60 seconds (stdTTL: 0x3c)
const searchCache = new NodeCache({ 'stdTTL': 60, 'checkperiod': 120 });
const BRAND = config.MOVIE_FOOTER; // Likely a brand/footer string

// --- Main Command Definition ---
cmd({
    'pattern': 'sinhalasub',
    'react': '🎬',
    'desc': 'Search and download Movies/TV Series',
    'category': 'download',
    'filename': __filename
}, async (bot, message, context, { from, q: searchQuery }) => {
    // 1. Handle No Search Query
    if (!searchQuery) {
        await bot.sendMessage(from, {
            'text': '*💡 Type Your Movie ㋡*\n\n📋 Usage: .sinhalasub <search term>\n📝 Example: .sinhalasub Breaking Bad\n\n' + '*🎬 Movie / TV Series Search*'
        }, { 'quoted': message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        // 2. Search Logic (API Call & Caching)
        if (!apiData) {
            const searchUrl = `${SEARCH_API}query=${encodeURIComponent(searchQuery)}&apiKey=${API_KEY}`;
            
            let retries = 3;
            while (retries--) {
                try {
                    const response = await axios.get(searchUrl, { 'timeout': 10000 }); // 10s timeout
                    apiData = response.data;
                    break;
                } catch (error) {
                    if (!retries) throw new Error('❌ Fetch failed.');
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
                }
            }

            // FIX 1: Search API Response Check: Use 'results' instead of 'data' for Cineru API
            if (!apiData?.status || !apiData?.results?.length) {
                throw new Error('No results found.');
            }
            searchCache.set(cacheKey, apiData);
        }

        // 3. Format Search Results for Display
        // FIX 2: Search API Data Mapping: Use 'apiData.results' and correct field names
        const results = apiData.results.map((item, index) => ({
            'n': index + 1, 
            'title': item.title, 
            'imdb': item.rating || 'N/A', 
            'year': item.year || 'N/A', 
            'link': item.url, // Cineru uses 'url'
            'image': item.image // Cineru uses 'image'
        }));

        let replyText = '*🎬 SEARCH RESULTS*\n\n';
        for (const item of results) {
            replyText += `🎬 *${item.n}. ${item.title}*\n  ⭐ Rating: ${item.imdb}\n  📅 Year: ${item.year}\n\n`;
        }
        replyText += '🔢 Select number 🪀';

        // 4. Send Results and Setup Interactive Listener
        const sentMessage = await bot.sendMessage(from, {
            'image': { 'url': results[0].image }, // Use first result's thumbnail
            'caption': replyText
        }, { 'quoted': message });

        const stateMap = new Map();

        // Listener for user's selection (reply to the message)
        const selectionHandler = async ({ messages }) => {
            const incomingMessage = messages?.[0];
            if (!incomingMessage?.message?.extendedTextMessage) return;

            const text = incomingMessage.message.extendedTextMessage.text.trim();
            const quotedId = incomingMessage.message.extendedTextMessage.contextInfo?.stanzaId;
            
            if (text.toLowerCase() === 'off') {
                bot.ev.off('messages.upsert', selectionHandler);
                stateMap.clear();
                await bot.sendMessage(from, { 'text': 'OK.' }, { 'quoted': incomingMessage });
                return;
            }

            if (quotedId === sentMessage.key.id) {
                // --- Movie Selection (First Stage) ---
                const selectedFilm = results.find(item => item.n === parseInt(text));

                if (!selectedFilm) {
                    await bot.sendMessage(from, { 'text': '❌ Invalid number.' }, { 'quoted': incomingMessage });
                    return;
                }
                
                // Determine which API endpoint to use
                // The Cineru API uses the same 'movie' endpoint for both single movies and individual episodes. 
                // We will default to MOVIE_DL_API for the download links, as the TV_DL_API is usually for season lists.
                const dlBaseUrl = MOVIE_DL_API; 
                const downloadUrl = `${dlBaseUrl}url=${encodeURIComponent(selectedFilm.link)}&apiKey=${API_KEY}`;

                let downloadData;
                let retries = 3;
                while (retries--) {
                    try {
                        downloadData = (await axios.get(downloadUrl, { 'timeout': 10000 })).data;
                        if (!downloadData.status) throw new Error();
                        break;
                    } catch(e) {
                        l('Download API error:', e.message); // Log the error for debugging
                        if (!retries) {
                            await bot.sendMessage(from, { 'text': '❌ Error: Failed to retrieve data' }, { 'quoted': incomingMessage });
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                let downloadLinks = [];
                let thumbnailUrl = selectedFilm.image;
                
                // FIX 3: Cineru Movie/Episode DL Response Structure
                if (downloadData.data && Array.isArray(downloadData.data.downloadLinks)) {
                    downloadLinks = downloadData.data.downloadLinks;
                    thumbnailUrl = downloadData.data.image || selectedFilm.image; 
                } else if (downloadData.data && Array.isArray(downloadData.data.episodes)) {
                     // Fallback for TV Show detail page which might contain episode links (though TV_DL_API is usually better)
                     // Since we used MOVIE_DL_API for detail, if it's a TV link, it might return episode details or season details. 
                     // We stick to the 'downloadLinks' structure for simplicity, assuming the Cineru API returns them in the detail response for the given URL.
                     // If the search result was a link to an individual episode, downloadLinks will be populated above.
                     // If it's a TV show main link, this part needs more robust logic (e.g., fetching TV_DL_API then asking for season/episode).
                     // For now, let's assume the initial link is directly to a downloadable entity or the downloadLinks are present.
                    await bot.sendMessage(from, { 'text': '⚠️ Selected item is a TV series main page. Please search for individual episodes to get direct links.' }, { 'quoted': incomingMessage });
                    return;
                } else {
                    await bot.sendMessage(from, { 'text': '❌ Could not parse download data from the API response.' }, { 'quoted': incomingMessage });
                    return;
                }


                // 6. Filter & Format Available Quality Options
                const picks = [];
                const availableQualities = {};
                
                // *** Filter Logic: Uses 'url' for the direct link (as per the Cineru API structure) ***
                for (let i = 0; i < downloadLinks.length; i++) {
                    const link = downloadLinks[i];
                    
                    const quality = link.quality;
                    const size = link.size || 'N/A';
                    const directLink = link.url; // Cineru uses 'url' for the direct download link
                    
                    const isDirectDownload = directLink && true; 
                    
                    if (isDirectDownload) {
                        const qKey = quality.toUpperCase().replace(/\s/g, ''); 
                        let priority = 0;
                        if (qKey.includes('1080P') || qKey.includes('FHD')) priority = 3;
                        else if (qKey.includes('720P') || qKey.includes('HD')) priority = 2;
                        else if (qKey.includes('480P') || qKey.includes('SD')) priority = 1;

                        if (!availableQualities[qKey] || availableQualities[qKey].priority < priority) {
                            availableQualities[qKey] = { quality, size, direct_download: directLink, priority };
                        }
                    }
                }
                
                const sortedPicks = Object.values(availableQualities)
                    .sort((a, b) => b.priority - a.priority) 
                    .slice(0, 5); 

                for (let i = 0; i < sortedPicks.length; i++) {
                    picks.push({ 'n': i + 1, ...sortedPicks[i] });
                }

                // Check if any links were successfully parsed
                if (!picks.length) {
                    await bot.sendMessage(from, { 'text': '❌ No usable download links found in the API response data.' }, { 'quoted': incomingMessage });
                    return;
                }

                let qualityReply = `*🎬 ${selectedFilm.title}*\n\n📥 Choose Quality:\n\n`;
                for (const pick of picks) {
                    qualityReply += `${pick.n}. *${pick.quality}* • ${pick.size})\n`;
                }
                qualityReply += '\n*~https://whatsapp.com/channel/0029Vb5xFPHGE56jTnm4ZD2k~*';

                // 7. Send Quality Selection Message
                const qualityMessage = await bot.sendMessage(from, {
                    'image': { 'url': thumbnailUrl },
                    'caption': qualityReply
                }, { 'quoted': incomingMessage });

                // Store film and quality options for the next step
                stateMap.set(qualityMessage.key.id, { 'film': selectedFilm, 'picks': picks });
                return;
            }

            // --- Quality Selection (Second Stage) ---
            if (stateMap.has(quotedId)) {
                const { film, picks } = stateMap.get(quotedId);
                const selectedQuality = picks.find(item => item.n === parseInt(text));

                if (!selectedQuality) {
                    await bot.sendMessage(from, { 'text': '❌ Wrong quality.' }, { 'quoted': incomingMessage });
                    return;
                }

                // 8. Size Check (Limit downloads to 2GB or less)
                const sizeLower = selectedQuality.size ? selectedQuality.size.toLowerCase() : '0mb';
                
                let sizeInGB = 3; 
                if (sizeLower.includes('gb')) {
                    sizeInGB = parseFloat(sizeLower) || 3;
                } else if (sizeLower.includes('mb')) {
                    sizeInGB = (parseFloat(sizeLower) || 0) / 1024;
                }
                
                if (sizeInGB > 2) { 
                    await bot.sendMessage(from, { 'text': `⚠️ Too large (${selectedQuality.size}). Direct link:\n` + selectedQuality.direct_download }, { 'quoted': incomingMessage });
                    return;
                }

                // 9. Prepare and Send File
                const safeTitle = film.title.replace(/[\\/:*?"<>|]/g, '');
                const fileName = `🎥 ${safeTitle}.${selectedQuality.quality || 'DL'}.mp4`;

                try {
                    await bot.sendMessage(from, {
                        'document': { 'url': selectedQuality.direct_download },
                        'mimetype': 'video/mp4',
                        'fileName': fileName,
                        'caption': `*🎬 ${film.title}*\n*📊 Quality: ${selectedQuality.quality} • Size: ${selectedQuality.size || 'N/A'}\n\n${config.MOVIE_FOOTER}`
                    }, { 'quoted': incomingMessage });
                    await bot.sendMessage(from, { 'react': { 'text': '✅', 'key': incomingMessage.key } });
                } catch(e) {
                     l('File send error:', e.message); // Log the error for debugging
                    // If download fails, send the direct URL to the user
                    await bot.sendMessage(from, { 'text': '❌ Failed to send file. Direct link:\n' + selectedQuality.direct_download }, { 'quoted': incomingMessage });
                }
            }
        };
        
        // Start listening for the user's reply
        bot.ev.on('messages.upsert', selectionHandler);

    } catch (error) {
        l(error);
        await bot.sendMessage(from, { 'text': '❌ Error: ' + error.message }, { 'quoted': message });
    }
});
