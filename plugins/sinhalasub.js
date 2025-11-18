// --- Imports and Initialization ---

const log = console.log;
const config = require('../config');
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = new (require('node-cache'))({ 'stdTTL': 60, 'checkperiod': 120 });

// --- API Configuration ---
const API_BASE = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/';
const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = `${API_BASE}search?apiKey=${API_KEY}&q=`; // Search API
const DOWNLOAD_API = `${API_BASE}infodl?apiKey=${API_KEY}&q=`; // Movie/Info DL API

const BRAND = '' + config.MOVIE_FOOTER;
const downloadOptionsMap = new Map();


// --- Command Definition ---

cmd({
    pattern: 'sinhalasub',
    react: '🎬',
    desc: 'Search and download Movies/TV Series',
    category: 'download',
    filename: __filename
}, async (
    conn,           
    message,        
    match,          
    { from, q: searchQuery } 
) => {
    if (!searchQuery) {
        await conn.sendMessage(from, {
            text: '*🎬 Movie / TV Series Search*\n\n' +
                  '*💡 Type Your Movie ㋡*\n' +
                  '📝 Example: .sinhalasub Breaking Bad\n\n' +
                  '📋 Usage: .sinhalasub <search term>\n'
        }, { quoted: message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase().trim();
        let searchData = searchCache.get(cacheKey);

        if (!searchData) {
            const apiUrl = SEARCH_API + encodeURIComponent(searchQuery); 
            let retries = 3;
            while (retries--) {
                try {
                    const response = await axios.get(apiUrl, { 'timeout': 10000 });
                    searchData = response.data;
                    break;
                } catch (error) {
                    if (!retries) throw new Error('Failed to retrieve data');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!searchData || !searchData.data || searchData.data.length === 0) { 
                throw new Error('No results found.');
            }

            searchCache.set(cacheKey, searchData);
        }

        // 3. Process and display results
        
        // [--- STEP 1: LOGGING THE DATA ---]
        // Console එකේ පෙන්වීමට, data array එකේ පළමු item එක log කරන්න.
        if (searchData.data[0]) {
            log('API Result Item Example (Check these fields!):', searchData.data[0]);
        }
        
        // [--- STEP 2: FIELD MAPPING ---]
        // title, imdb, year සඳහා නිවැරදි names ඔබ මෙහි යාවත්කාලීන කළ යුතුය.
        const searchResults = searchData.data.map((item, index) => ({
            n: index + 1,
            // (1) ඔබ log එකේ දුටු නිවැරදි නම මෙහි දමන්න.
            title: item.m_name || item.movie_title || item.name || item.title || 'N/A', 
            // (2) ඔබ log එකේ දුටු නිවැරදි නම මෙහි දමන්න.
            imdb: item.m_rating || item.imdb_rating || item.rating || item.imdb || 'N/A',      
            // (3) ඔබ log එකේ දුටු නිවැරදි නම මෙහි දමන්න.
            year: item.m_year || item.release_year || item.year || item.date || 'N/A',       
            link: item.link || item.url, 
            image: item.image || item.thumbnail 
        }));
        // [----------------------------------]

        let responseText = '*🎬 SEARCH RESULTS*\n\n';
        for (const result of searchResults) {
            responseText += `${result.n}. *${result.title}* • ⭐ IMDB: ${result.imdb} • 📅 Year: ${result.year}\n\n`;
        }
        responseText += '🔢 Select number 🪀';

        let messageOptions = { caption: responseText };
        let searchMessage;

        if (searchResults[0] && searchResults[0].image) {
            messageOptions.image = { url: searchResults[0].image };
        }
        
        try {
            searchMessage = await conn.sendMessage(from, messageOptions, { quoted: message });
        } catch (e) {
            log('Image Send Error, sending as text', e);
            searchMessage = await conn.sendMessage(from, { text: responseText }, { quoted: message });
        }

        // 4. Set up listener for follow-up message (Movie Selection)
        const messageHandler = async ({ messages: newMessages }) => {
            // ... (Message handling code is the same)
            // ... (Skipping the rest of the function for brevity)
            
            // --- First follow-up: Movie Selection ---
            if (quotedMessageId === searchMessage.key.id) {
                // ... (Validation code)
                
                // Link validity check added before encode
                const targetLink = selectedFilm.link.startsWith('http') ? selectedFilm.link : selectedFilm.link || 'Error';
                const downloadApiUrl = DOWNLOAD_API + encodeURIComponent(targetLink);
                // ... (Download API call logic)

                // ... (Quality selection logic)
            }
            // ... (Second follow-up: Quality Selection logic)
            
        };
        
        // Attach the message handler to the 'messages.upsert' event
        conn.ev.on('messages.upsert', messageHandler);

    } catch (error) {
        log('error', error);
        await conn.sendMessage(from, { text: '❌ Error: ' + error.message }, { quoted: message });
    }
});
